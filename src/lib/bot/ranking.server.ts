// Smart symbol selection: score a universe of USDT-perps and auto-enable
// the top N for symbols flagged auto_managed. Manual picks are sticky.
import { binance, getCredsForUser } from "@/lib/binance/client.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAtrPct } from "@/lib/binance/grid.server";
import { botLog } from "@/lib/bot/log.server";

// Static universe — top liquid USDT perps. Could be made dynamic later.
const UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT",
  "LTCUSDT", "BCHUSDT", "ETCUSDT", "TRXUSDT", "DOTUSDT",
];

// Sweet-spot ATR% band for grid trading: enough movement to fill, not
// so much we get repeatedly stopped out.
const ATR_LOW = 0.4;
const ATR_HIGH = 2.0;

interface Score {
  symbol: string;
  atrPct: number | null;
  realizedPerHour: number;
  fillCount: number;
  score: number;
}

export async function rankAndApplyAutoSelect(userId: string, maxSymbols: number) {
  const { data: cfgRow } = await supabaseAdmin
    .from("bot_config")
    .select("testnet")
    .eq("user_id", userId)
    .maybeSingle();
  const testnet = cfgRow?.testnet ?? true;
  const creds = await getCredsForUser(userId, testnet);

  // Realized P&L per hour over last 24h, per symbol
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: trades } = await supabaseAdmin
    .from("trades")
    .select("symbol,realized_pnl,commission")
    .eq("user_id", userId)
    .gte("filled_at", since);
  const perfBySym = new Map<string, { pnl: number; n: number }>();
  for (const t of trades ?? []) {
    const prev = perfBySym.get(t.symbol) ?? { pnl: 0, n: 0 };
    prev.pnl += Number(t.realized_pnl) - Number(t.commission ?? 0);
    prev.n += 1;
    perfBySym.set(t.symbol, prev);
  }

  const scores: Score[] = [];
  await Promise.all(
    UNIVERSE.map(async (symbol) => {
      try {
        const atrPct = await getAtrPct(creds, symbol, "1h", 14);
        const perf = perfBySym.get(symbol) ?? { pnl: 0, n: 0 };
        const realizedPerHour = perf.pnl / 24;
        // ATR fit: 1 at center of band, 0 outside it.
        let atrFit = 0;
        if (atrPct != null) {
          if (atrPct >= ATR_LOW && atrPct <= ATR_HIGH) {
            const mid = (ATR_LOW + ATR_HIGH) / 2;
            atrFit = 1 - Math.abs(atrPct - mid) / (ATR_HIGH - mid);
          }
        }
        const score = atrFit * 1.0 + Math.max(-1, Math.min(1, realizedPerHour / 5)) * 0.5;
        scores.push({ symbol, atrPct, realizedPerHour, fillCount: perf.n, score });
      } catch {
        scores.push({ symbol, atrPct: null, realizedPerHour: 0, fillCount: 0, score: 0 });
      }
    }),
  );

  scores.sort((a, b) => b.score - a.score);
  const winners = new Set(scores.slice(0, maxSymbols).map((s) => s.symbol));

  // Only touch auto_managed rows. Ensure rows exist for top winners.
  for (const s of scores.slice(0, maxSymbols)) {
    const { data: existing } = await supabaseAdmin
      .from("symbol_config")
      .select("symbol,enabled,auto_managed")
      .eq("user_id", userId)
      .eq("symbol", s.symbol)
      .maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("symbol_config").insert({
        user_id: userId,
        symbol: s.symbol,
        enabled: true,
        auto_managed: true,
        grid_levels: 5,
        grid_spacing_pct: 0.5,
        order_size_usdt: 20,
        leverage: 5,
      });
    } else if (existing.auto_managed && !existing.enabled) {
      await supabaseAdmin
        .from("symbol_config")
        .update({ enabled: true, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("symbol", s.symbol);
    }
  }

  // Disable auto_managed symbols not in the winners set.
  const { data: managed } = await supabaseAdmin
    .from("symbol_config")
    .select("symbol,enabled")
    .eq("user_id", userId)
    .eq("auto_managed", true);
  for (const m of managed ?? []) {
    if (!winners.has(m.symbol) && m.enabled) {
      await supabaseAdmin
        .from("symbol_config")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("symbol", m.symbol);
    }
  }

  await botLog(
    userId,
    "info",
    `Auto-select: kept ${[...winners].join(", ")} (top ${maxSymbols} by ATR-fit + realized/hr)`,
  );

  return scores.slice(0, maxSymbols);
}
