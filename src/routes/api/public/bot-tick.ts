import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { binance, formatBinanceError, getCredsForUser, isBinanceAuthError, isBinanceNetworkBlock, type BinanceCreds } from "@/lib/binance/client.server";
import { reconcileSymbol, evictWorstPositionIfOverCap } from "@/lib/binance/grid.server";
import { botLog } from "@/lib/bot/log.server";
import { learnFromTrades } from "@/lib/bot/learn.server";
import { rankAndApplyAutoSelect } from "@/lib/bot/ranking.server";


async function pauseBot(userId: string, message: string) {
  await supabaseAdmin
    .from("bot_config")
    .update({ is_running: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  await botLog(userId, "error", `Bot paused: ${message}`);
}


export const Route = createFileRoute("/api/public/bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BOT_TICK_SECRET;
        const provided =
          request.headers.get("x-bot-tick-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          request.headers.get("apikey") ??
          "";

        const matches = (expected?: string) => {
          if (!expected) return false;
          const a = Buffer.from(provided);
          const b = Buffer.from(expected);
          return a.length === b.length && timingSafeEqual(a, b);
        };

        if (!matches(secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Every user with a running bot
        const { data: configs } = await supabaseAdmin
          .from("bot_config")
          .select("user_id,testnet,max_total_notional_usdt,auto_select_enabled,auto_select_max_symbols,drawdown_pause_pct,news_pause_enabled,news_pause_window_min,news_currencies")
          .eq("is_running", true);

        let okCount = 0;
        let errCount = 0;

        for (const cfg of configs ?? []) {
          try {
            let creds: BinanceCreds;
            try {
              creds = await getCredsForUser(cfg.user_id, cfg.testnet);
            } catch (e) {
              await pauseBot(cfg.user_id, (e as Error).message);
              errCount++;
              continue;
            }
            let acct: any = null;
            try {
              acct = await binance.account(creds);
            } catch (e) {
              if (cfg.testnet && isBinanceNetworkBlock(e)) {
                await botLog(cfg.user_id, "warn", "Demo account snapshot unavailable from this runtime; continuing tick without pausing.");
              } else {
                const msg = isBinanceAuthError(e)
                  ? formatBinanceError(e, cfg.testnet)
                  : (e as Error).message;
                if (isBinanceAuthError(e)) await pauseBot(cfg.user_id, msg);
                else await botLog(cfg.user_id, "error", msg);
                errCount++;
                continue;
              }
            }

            // Drawdown circuit-breaker: pause if 24h realized + unrealized
            // is below -drawdown_pause_pct of wallet.
            try {
              if (!acct) throw new Error("account snapshot unavailable");
              const wallet = parseFloat(acct?.totalWalletBalance ?? "0") || 0;
              const upnl = parseFloat(acct?.totalUnrealizedProfit ?? "0") || 0;
              const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
              const { data: trs } = await supabaseAdmin
                .from("trades")
                .select("realized_pnl,commission")
                .eq("user_id", cfg.user_id)
                .gte("filled_at", since);
              const realized = (trs ?? []).reduce(
                (s, t) => s + Number(t.realized_pnl) - Number(t.commission ?? 0),
                0,
              );
              const ddPct = Number((cfg as any).drawdown_pause_pct ?? 3.0);
              const totalPct = wallet > 0 ? ((realized + upnl) / wallet) * 100 : 0;
              if (ddPct > 0 && totalPct <= -ddPct) {
                await pauseBot(
                  cfg.user_id,
                  `Drawdown circuit-breaker: 24h P&L ${totalPct.toFixed(2)}% <= -${ddPct}% of wallet (${wallet.toFixed(2)} USDT). Stopping.`,
                );
                errCount++;
                continue;
              }
            } catch (e) {
              await botLog(cfg.user_id, "warn", `drawdown check: ${(e as Error).message}`);
            }

            // News blackout: skip new grid placements ±window around high-impact events.
            let newsBlackout = false;
            if ((cfg as any).news_pause_enabled !== false) {
              try {
                const { getBlackout } = await import("@/lib/bot/news.server");
                const currencies = String((cfg as any).news_currencies ?? "USD")
                  .split(",").map((s) => s.trim()).filter(Boolean);
                const bo = await getBlackout({
                  windowMinutes: Number((cfg as any).news_pause_window_min ?? 30),
                  currencies,
                });
                if (bo.active && bo.event) {
                  newsBlackout = true;
                  await botLog(
                    cfg.user_id,
                    "warn",
                    `News blackout: ${bo.event.country} ${bo.event.title} in ${bo.event.minutesUntil}m — skipping grid entries`,
                  );
                }
              } catch (e) {
                await botLog(cfg.user_id, "warn", `news: ${(e as Error).message}`);
              }
            }

            // Auto-select top symbols (only when toggled on).
            if ((cfg as any).auto_select_enabled) {
              try {
                await rankAndApplyAutoSelect(
                  cfg.user_id,
                  Number((cfg as any).auto_select_max_symbols ?? 4),
                );
              } catch (e) {
                await botLog(cfg.user_id, "warn", `auto-select: ${(e as Error).message}`);
              }
            }

            // Proactively drain exposure back under the cap.
            try {
              await evictWorstPositionIfOverCap(
                cfg.user_id,
                creds,
                Number(cfg.max_total_notional_usdt ?? 500),
              );
            } catch (e) {
              await botLog(cfg.user_id, "warn", `auto-evict: ${(e as Error).message}`);
            }

            const { data: symbols } = await supabaseAdmin
              .from("symbol_config")
              .select("*")
              .eq("user_id", cfg.user_id)
              .eq("enabled", true);

            await Promise.allSettled(
              (symbols ?? []).map(async (s) => {
                try {
                  if ((s as any).auto_tune) {
                    try {
                      await learnFromTrades(s as any);
                    } catch (e) {
                      await botLog(cfg.user_id, "warn", `learn: ${(e as Error).message}`, s.symbol);
                    }
                  }
                  await reconcileSymbol(s as any, { newsBlackout });
                } catch (e) {
                  await botLog(cfg.user_id, "error", (e as Error).message, s.symbol);
                }
              }),
            );
            okCount++;
          } catch (e) {
            await botLog(cfg.user_id, "error", `tick: ${(e as Error).message}`);
            errCount++;
          }
        }

        return Response.json({ ok: true, processed: okCount, errors: errCount });
      },
      GET: async () => new Response("Method not allowed", { status: 405 }),
    },
  },
});
