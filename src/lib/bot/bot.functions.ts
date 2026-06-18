import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  binance,
  binanceProxySource,
  formatBinanceError,
  getCredsForUser,
  isBinanceNetworkBlock,
  isBinanceAuthError,
  verifyFuturesCreds,
  type BinanceCreds,
} from "@/lib/binance/client.server";
import { syncFillsForSymbol, getTrendBias, getMarketSession } from "@/lib/binance/grid.server";
import { localBinanceCredsForUser, saveLocalBinanceCreds } from "@/lib/binance/local-creds.server";
import {
  addLocalLog,
  getLocalBotState,
  updateLocalBotConfig,
  updateLocalSymbol,
} from "@/lib/bot/local-bot-store.server";
import {
  ensureLocalBotRunner,
  runLocalBotTick,
  stopLocalBotRunner,
} from "@/lib/bot/local-runner.server";
import { botLog } from "@/lib/bot/log.server";

const FUTURES_TAKER_FEE_RATE = 0.0004;
const FUTURES_MAKER_FEE_RATE = 0.0002;
const VPNHOOD_REPO_URL = "https://github.com/vpnhood/vpnhood";
let publicIpCache: { ip: string | null; expiresAt: number } | null = null;

function hasSupabaseAdminEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function serverPublicIp() {
  if (publicIpCache && publicIpCache.expiresAt > Date.now()) return publicIpCache.ip;
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(2_000),
      headers: { "user-agent": "crypto-caddie-demo/1.0" },
    });
    const json = (await res.json()) as { ip?: string };
    const ip = typeof json.ip === "string" && json.ip.trim() ? json.ip.trim() : null;
    publicIpCache = { ip, expiresAt: Date.now() + 60_000 };
    return ip;
  } catch {
    publicIpCache = { ip: null, expiresAt: Date.now() + 30_000 };
    return null;
  }
}

async function binanceNetworkRouteStatus() {
  const proxySource = binanceProxySource();
  return {
    proxyConfigured: Boolean(proxySource),
    proxySource,
    serverPublicIp: await serverPublicIp(),
    vpnhoodRepoUrl: VPNHOOD_REPO_URL,
  };
}

async function localDashboardFallback(userId: string) {
  const local = getLocalBotState(userId);
  if (local.cfg.is_running) ensureLocalBotRunner(userId);
  const mainnetCreds = localBinanceCredsForUser(userId);
  const credsStatus = {
    mainnet: Boolean(mainnetCreds?.api_key && mainnetCreds?.api_secret),
    testnet: Boolean(mainnetCreds?.testnet_api_key && mainnetCreds?.testnet_api_secret),
  };
  let account: any = null;
  let positions: any[] = [];
  let openOrders: any[] = [];
  let error: string | null = null;
  let realizedToday = 0;
  const trendBias: Record<string, "up" | "down" | "flat" | null> = {};
  const marketSession = getMarketSession();

  if (credsStatus.testnet) {
    try {
      const creds = await getCredsForUser(userId, true);
      const sinceMs = (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
      })();
      const accountUnavailable = (e: unknown) => creds.testnet && isBinanceNetworkBlock(e);
      const [acct, risk, premium, income, liveOrders] = await Promise.all([
        binance.account(creds).catch((e) => {
          if (accountUnavailable(e)) return null;
          throw e;
        }),
        binance.positionRisk(creds).catch((e) => {
          if (accountUnavailable(e)) return [] as any[];
          throw e;
        }),
        binance.premiumIndexAll(creds).catch(() => [] as any[]),
        binance.income(creds, { startTime: sinceMs, limit: 1000 }).catch(() => [] as any[]),
        binance.openOrders(creds).catch(() => [] as any[]),
      ]);

      realizedToday = (income ?? [])
        .filter((r) => ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(r.incomeType))
        .reduce((s, r) => s + Number(r.income || 0), 0);

      const marginBalance = parseFloat(acct?.totalMarginBalance ?? "0") || 0;
      account = acct
        ? {
            totalWalletBalance: acct.totalWalletBalance,
            totalUnrealizedProfit: acct.totalUnrealizedProfit,
            totalMarginBalance: acct.totalMarginBalance,
            availableBalance: acct.availableBalance,
          }
        : null;
      const acctByKey = new Map<string, any>(
        (acct?.positions ?? []).map((p: any) => [`${p.symbol}:${p.positionSide}`, p]),
      );
      const premiumBySym = new Map<string, any>((premium ?? []).map((p) => [p.symbol, p]));
      const symConfigBySymbol = new Map<string, any>(local.symbols.map((s) => [s.symbol, s]));

      await Promise.all(
        local.symbols
          .filter((s) => s.enabled && (s.trend_filter_enabled ?? true))
          .map(async (s) => {
            const mark = parseFloat(premiumBySym.get(s.symbol)?.markPrice ?? "0") || 0;
            if (mark <= 0) {
              trendBias[s.symbol] = null;
              return;
            }
            trendBias[s.symbol] = await getTrendBias(
              creds,
              s.symbol,
              s.trend_interval ?? "1h",
              Math.max(5, Number(s.trend_ema_period ?? 50)),
              mark,
              marketSession.flatThresholdPct,
            );
          }),
      );

      positions = (risk ?? [])
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => {
          const amt = parseFloat(p.positionAmt);
          const entry = parseFloat(p.entryPrice) || 0;
          const premiumMark = parseFloat(premiumBySym.get(p.symbol)?.markPrice ?? "0") || 0;
          const mark = premiumMark > 0 ? premiumMark : parseFloat(p.markPrice) || 0;
          const upnl =
            entry > 0 && mark > 0 ? (mark - entry) * amt : parseFloat(p.unRealizedProfit) || 0;
          const notional = Math.abs(amt * mark) || Math.abs(parseFloat(p.notional ?? "0")) || 0;
          const estCloseFeeUsdt = notional * FUTURES_TAKER_FEE_RATE;
          const estRoundTripFeeUsdt = notional * (FUTURES_TAKER_FEE_RATE + FUTURES_MAKER_FEE_RATE);
          const netUnrealizedAfterCloseFee = upnl - estCloseFeeUsdt;
          const leverage = parseFloat(p.leverage) || 1;
          const initialMargin = leverage > 0 ? notional / leverage : 0;
          const roiPct = initialMargin > 0 ? (upnl / initialMargin) * 100 : 0;
          const netRoiPct =
            initialMargin > 0 ? (netUnrealizedAfterCloseFee / initialMargin) * 100 : 0;
          const acctPos = acctByKey.get(`${p.symbol}:${p.positionSide}`);
          const maintMargin = parseFloat(acctPos?.maintMargin ?? "0") || 0;
          const isolated = p.marginType === "isolated";
          const isolatedWallet = parseFloat(p.isolatedWallet ?? "0") || 0;
          const denom = isolated ? isolatedWallet + upnl : marginBalance;
          const marginRatioPct = denom > 0 ? (maintMargin / denom) * 100 : 0;
          const fundingRate = parseFloat(premiumBySym.get(p.symbol)?.lastFundingRate ?? "0") || 0;
          const estFundingFee = notional * fundingRate * (amt >= 0 ? -1 : 1);
          const nextFundingTime = premiumBySym.get(p.symbol)?.nextFundingTime ?? null;
          const symCfg = symConfigBySymbol.get(p.symbol);
          const spacingPct = Number(symCfg?.grid_spacing_pct ?? 0);
          const tpTargetUsdt = notional * (spacingPct / 100);
          const tpTargetPrice =
            spacingPct > 0 && entry > 0
              ? entry * (1 + ((amt >= 0 ? 1 : -1) * spacingPct) / 100)
              : null;
          return {
            symbol: p.symbol,
            positionAmt: p.positionAmt,
            entryPrice: p.entryPrice,
            breakEvenPrice: p.breakEvenPrice ?? null,
            markPrice: String(mark),
            liquidationPrice: p.liquidationPrice,
            marginRatioPct,
            marginType: p.marginType,
            isolatedMargin: p.isolatedMargin,
            initialMargin,
            unrealizedProfit: String(upnl),
            roiPct,
            estCloseFeeUsdt,
            estRoundTripFeeUsdt,
            netUnrealizedAfterCloseFee,
            netRoiPct,
            leverage: p.leverage,
            notional,
            estFundingFee,
            fundingRate,
            nextFundingTime,
            tpTargetUsdt,
            tpTargetPrice,
          };
        });

      openOrders = (liveOrders ?? [])
        .filter((o: any) => String(o.clientOrderId ?? "").startsWith(`grid_${o.symbol}_`))
        .map((o: any) => ({
          symbol: o.symbol,
          side: o.side,
          price: o.price,
          origQty: o.origQty,
          executedQty: o.executedQty,
          status: o.status,
          orderId: o.orderId,
          clientOrderId: o.clientOrderId,
          notional: Number(o.origQty ?? 0) * Number(o.price ?? 0),
          estMakerFeeUsdt: Number(o.origQty ?? 0) * Number(o.price ?? 0) * FUTURES_MAKER_FEE_RATE,
        }));
    } catch (e) {
      error = formatBinanceError(e, true);
    }
  }

  return {
    cfg: local.cfg,
    symbols: local.symbols,
    account,
    positions,
    openOrders,
    error,
    realizedToday,
    credsStatus,
    trendBias,
    marketSession,
    binanceNetworkRoute: await binanceNetworkRouteStatus(),
  };
}

async function loadCreds(userId: string): Promise<{ creds: BinanceCreds; testnet: boolean }> {
  if (!hasSupabaseAdminEnv()) {
    const testnet = Boolean(getLocalBotState(userId).cfg.testnet ?? true);
    if (!testnet) {
      throw new Error(
        "Local shared mode only supports Binance Futures TESTNET. Switch Testnet mode back on to trade from this link.",
      );
    }
    const creds = await getCredsForUser(userId, testnet);
    return { creds, testnet };
  }

  const { data } = await supabaseAdmin
    .from("bot_config")
    .select("testnet")
    .eq("user_id", userId)
    .maybeSingle();
  const testnet = data?.testnet ?? true;
  const creds = await getCredsForUser(userId, testnet);
  return { creds, testnet };
}

async function pauseBotForCredentialError(userId: string, message: string) {
  await supabaseAdmin
    .from("bot_config")
    .update({ is_running: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  await botLog(userId, "error", `Bot paused: ${message}`);
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    if (!hasSupabaseAdminEnv()) return await localDashboardFallback(userId);

    let { data: cfg } = await supabaseAdmin
      .from("bot_config")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: symbols } = await supabaseAdmin
      .from("symbol_config")
      .select("*")
      .eq("user_id", userId)
      .order("symbol");

    // Indicate whether the user has saved Binance creds (without leaking them).
    const { data: credsRow } = await supabaseAdmin
      .from("user_binance_creds")
      .select("api_key,testnet_api_key")
      .eq("user_id", userId)
      .maybeSingle();
    // Owner can also fall back to env-stored keys — probe getCredsForUser so
    // the UI doesn't show "Set up required" when env keys are present.
    const hasEnvCreds = async (tn: boolean) => {
      try {
        await getCredsForUser(userId, tn);
        return true;
      } catch {
        return false;
      }
    };
    const credsStatus = {
      mainnet: !!credsRow?.api_key || (await hasEnvCreds(false)),
      testnet: !!credsRow?.testnet_api_key || (await hasEnvCreds(true)),
    };

    let account: any = null;
    let positions: any[] = [];
    let openOrders: any[] = [];
    let error: string | null = null;
    let realizedTodayBinance: number | null = null;
    const trendBias: Record<string, "up" | "down" | "flat" | null> = {};
    const marketSession = getMarketSession();
    try {
      const { creds } = await loadCreds(userId);
      const sinceMs = (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
      })();
      const accountUnavailable = (e: unknown) => creds.testnet && isBinanceNetworkBlock(e);
      const [acct, risk, premium, income, liveOrders] = await Promise.all([
        binance.account(creds).catch((e) => {
          if (accountUnavailable(e)) return null;
          throw e;
        }),
        binance.positionRisk(creds).catch((e) => {
          if (accountUnavailable(e)) return [] as any[];
          throw e;
        }),
        binance.premiumIndexAll(creds).catch(() => [] as any[]),
        binance.income(creds, { startTime: sinceMs, limit: 1000 }).catch(() => [] as any[]),
        binance.openOrders(creds).catch(() => [] as any[]),
      ]);
      // Net realized = REALIZED_PNL + COMMISSION (negative) + FUNDING_FEE
      realizedTodayBinance = (income ?? [])
        .filter((r) => ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(r.incomeType))
        .reduce((s, r) => s + Number(r.income || 0), 0);
      const marginBalance = parseFloat(acct?.totalMarginBalance ?? "0") || 0;
      account = acct
        ? {
            totalWalletBalance: acct.totalWalletBalance,
            totalUnrealizedProfit: acct.totalUnrealizedProfit,
            totalMarginBalance: acct.totalMarginBalance,
            availableBalance: acct.availableBalance,
          }
        : null;
      const acctByKey = new Map<string, any>(
        (acct?.positions ?? []).map((p: any) => [`${p.symbol}:${p.positionSide}`, p]),
      );
      const premiumBySym = new Map<string, any>((premium ?? []).map((p) => [p.symbol, p]));
      const symConfigBySymbol = new Map<string, any>((symbols ?? []).map((s) => [s.symbol, s]));

      // Trend bias per enabled symbol (best-effort, parallel; failures → null).
      const enabledForTrend = (symbols ?? []).filter(
        (s: any) => s.enabled && (s.trend_filter_enabled ?? true),
      );
      await Promise.all(
        enabledForTrend.map(async (s: any) => {
          const mark = parseFloat(premiumBySym.get(s.symbol)?.markPrice ?? "0") || 0;
          if (mark <= 0) {
            trendBias[s.symbol] = null;
            return;
          }
          trendBias[s.symbol] = await getTrendBias(
            creds,
            s.symbol,
            s.trend_interval ?? "1h",
            Math.max(5, Number(s.trend_ema_period ?? 50)),
            mark,
            marketSession.flatThresholdPct,
          );
        }),
      );
      positions = (risk ?? [])
        .filter((p: any) => parseFloat(p.positionAmt) !== 0)
        .map((p: any) => {
          const amt = parseFloat(p.positionAmt);
          const entry = parseFloat(p.entryPrice) || 0;
          // Prefer the fresher mark from premiumIndex (updates ~1s) over
          // positionRisk's snapshot which can lag several seconds.
          const premiumMark = parseFloat(premiumBySym.get(p.symbol)?.markPrice ?? "0") || 0;
          const mark = premiumMark > 0 ? premiumMark : parseFloat(p.markPrice) || 0;
          // Recompute uPnL from the fresh mark so the UI matches Binance live.
          const upnl =
            entry > 0 && mark > 0 ? (mark - entry) * amt : parseFloat(p.unRealizedProfit) || 0;
          const notional = Math.abs(amt * mark) || Math.abs(parseFloat(p.notional ?? "0")) || 0;
          const estCloseFeeUsdt = notional * FUTURES_TAKER_FEE_RATE;
          const estRoundTripFeeUsdt = notional * (FUTURES_TAKER_FEE_RATE + FUTURES_MAKER_FEE_RATE);
          const netUnrealizedAfterCloseFee = upnl - estCloseFeeUsdt;
          const leverage = parseFloat(p.leverage) || 1;
          const initialMargin = leverage > 0 ? notional / leverage : 0;
          const roiPct = initialMargin > 0 ? (upnl / initialMargin) * 100 : 0;
          const netRoiPct =
            initialMargin > 0 ? (netUnrealizedAfterCloseFee / initialMargin) * 100 : 0;
          const acctPos = acctByKey.get(`${p.symbol}:${p.positionSide}`);
          const maintMargin = parseFloat(acctPos?.maintMargin ?? "0") || 0;
          const isolated = p.marginType === "isolated";
          const isolatedWallet = parseFloat(p.isolatedWallet ?? "0") || 0;
          const denom = isolated ? isolatedWallet + upnl : marginBalance;
          const marginRatioPct = denom > 0 ? (maintMargin / denom) * 100 : 0;
          const fundingRate = parseFloat(premiumBySym.get(p.symbol)?.lastFundingRate ?? "0") || 0;
          const estFundingFee = notional * fundingRate * (amt >= 0 ? -1 : 1);
          const nextFundingTime = premiumBySym.get(p.symbol)?.nextFundingTime ?? null;
          const symCfg = symConfigBySymbol.get(p.symbol);
          const spacingPct = Number(symCfg?.grid_spacing_pct ?? 0);
          const tpTargetUsdt = notional * (spacingPct / 100);
          const tpTargetPrice =
            spacingPct > 0 && entry > 0
              ? entry * (1 + ((amt >= 0 ? 1 : -1) * spacingPct) / 100)
              : null;
          return {
            symbol: p.symbol,
            positionAmt: p.positionAmt,
            entryPrice: p.entryPrice,
            breakEvenPrice: p.breakEvenPrice ?? null,
            markPrice: String(mark),
            liquidationPrice: p.liquidationPrice,
            marginRatioPct,
            marginType: p.marginType,
            isolatedMargin: p.isolatedMargin,
            initialMargin,
            unrealizedProfit: String(upnl),
            roiPct,
            estCloseFeeUsdt,
            estRoundTripFeeUsdt,
            netUnrealizedAfterCloseFee,
            netRoiPct,
            leverage: p.leverage,
            notional,
            estFundingFee,
            fundingRate,
            nextFundingTime,
            tpTargetUsdt,
            tpTargetPrice,
          };
        });
      openOrders = (liveOrders ?? [])
        .filter((o: any) => String(o.clientOrderId ?? "").startsWith(`grid_${o.symbol}_`))
        .map((o: any) => ({
          symbol: o.symbol,
          side: o.side,
          price: o.price,
          origQty: o.origQty,
          executedQty: o.executedQty,
          status: o.status,
          orderId: o.orderId,
          clientOrderId: o.clientOrderId,
          notional: Number(o.origQty ?? 0) * Number(o.price ?? 0),
          estMakerFeeUsdt: Number(o.origQty ?? 0) * Number(o.price ?? 0) * FUTURES_MAKER_FEE_RATE,
        }));
    } catch (e) {
      const message = formatBinanceError(e, cfg?.testnet ?? true);
      if (cfg?.is_running && isBinanceAuthError(e)) {
        await pauseBotForCredentialError(userId, message);
        cfg = { ...cfg, is_running: false };
      }
      error = message;
    }

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { data: todayTrades } = await supabaseAdmin
      .from("trades")
      .select("realized_pnl,commission")
      .eq("user_id", userId)
      .gte("filled_at", since.toISOString());
    const realizedTodayDb = (todayTrades ?? []).reduce(
      (s, t) => s + Number(t.realized_pnl) - Number(t.commission ?? 0),
      0,
    );
    const realizedToday = realizedTodayBinance ?? realizedTodayDb;

    return {
      cfg,
      symbols,
      account,
      positions,
      openOrders,
      error,
      realizedToday,
      credsStatus,
      trendBias,
      marketSession,
      binanceNetworkRoute: await binanceNetworkRouteStatus(),
    };
  });

export const getTrades = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasSupabaseAdminEnv()) {
      const local = getLocalBotState(context.userId);
      const creds = await getCredsForUser(context.userId, true);
      const enabledSymbols = local.symbols.filter((s) => s.enabled).map((s) => s.symbol);
      const symbols =
        enabledSymbols.length > 0 ? enabledSymbols : local.symbols.map((s) => s.symbol);
      const trades = (
        await Promise.all(
          symbols.map(async (symbol) => {
            try {
              return await binance.userTrades(creds, symbol, undefined, 100);
            } catch {
              return [] as any[];
            }
          }),
        )
      ).flat();
      return trades
        .map((t: any) => ({
          id: `${t.symbol}-${t.id}`,
          symbol: t.symbol,
          side: t.side,
          price: Number(t.price),
          qty: Number(t.qty),
          realized_pnl: Number(t.realizedPnl ?? 0),
          commission: Number(t.commission ?? 0),
          binance_order_id: t.orderId,
          binance_trade_id: t.id,
          filled_at: new Date(t.time).toISOString(),
        }))
        .sort((a, b) => new Date(b.filled_at).getTime() - new Date(a.filled_at).getTime())
        .slice(0, 200);
    }

    const { data } = await supabaseAdmin
      .from("trades")
      .select("*")
      .eq("user_id", context.userId)
      .order("filled_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const getLogs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasSupabaseAdminEnv()) return getLocalBotState(context.userId).logs;

    const { data } = await supabaseAdmin
      .from("bot_logs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const setBotRunning = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { running: boolean }) => z.object({ running: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasSupabaseAdminEnv()) {
      if (data.running) {
        const { creds, testnet } = await loadCreds(context.userId);
        const check = await verifyFuturesCreds(creds);
        if (
          !check.ok &&
          !(testnet && check.reason?.includes("not treated as a credential failure"))
        ) {
          throw new Error(`Can't start bot: ${check.reason}`);
        }
        if (check.ok) {
          addLocalLog(
            context.userId,
            "info",
            `Pre-flight OK — Futures ${testnet ? "testnet" : "mainnet"} key authenticated, wallet=${check.account?.totalWalletBalance ?? "?"} USDT`,
          );
        } else {
          addLocalLog(context.userId, "warn", `Pre-flight account check skipped — ${check.reason}`);
        }
      }
      updateLocalBotConfig(context.userId, { is_running: data.running });
      addLocalLog(context.userId, "info", data.running ? "Bot started" : "Bot stopped");
      if (data.running) {
        ensureLocalBotRunner(context.userId);
        runLocalBotTick(context.userId).catch((error) => {
          addLocalLog(
            context.userId,
            "error",
            `Initial local tick failed: ${(error as Error).message}`,
          );
        });
      } else {
        stopLocalBotRunner(context.userId);
      }
      return { ok: true };
    }

    if (data.running) {
      const { data: cfg } = await supabaseAdmin
        .from("bot_config")
        .select("testnet")
        .eq("user_id", context.userId)
        .maybeSingle();
      const testnet = cfg?.testnet ?? true;
      let creds: BinanceCreds;
      try {
        creds = await getCredsForUser(context.userId, testnet);
      } catch (e) {
        const message = (e as Error).message;
        throw new Error(
          message.includes("not configured")
            ? `Save your Binance ${testnet ? "testnet" : "mainnet"} API key and secret in Settings before starting the bot.`
            : `Can't start bot: ${message}`,
        );
      }
      // Sanity check: correct API surface (Futures vs Spot) + trading permission.
      const check = await verifyFuturesCreds(creds);
      if (!check.ok) {
        if (testnet && check.reason?.includes("not treated as a credential failure")) {
          await botLog(
            context.userId,
            "warn",
            `Pre-flight account check skipped — ${check.reason}`,
          );
        } else {
          await pauseBotForCredentialError(
            context.userId,
            check.reason ?? "Credential check failed",
          );
          throw new Error(`Can't start bot: ${check.reason}`);
        }
      } else {
        await botLog(
          context.userId,
          "info",
          `Pre-flight OK — Futures ${testnet ? "testnet" : "mainnet"} key authenticated, canTrade=true, wallet=${check.account?.totalWalletBalance ?? "?"} USDT`,
        );
      }
    }
    await supabaseAdmin
      .from("bot_config")
      .update({ is_running: data.running, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    await botLog(context.userId, "info", data.running ? "Bot started" : "Bot stopped");
    return { ok: true };
  });

export const setTestnet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { testnet: boolean }) => z.object({ testnet: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasSupabaseAdminEnv()) {
      updateLocalBotConfig(context.userId, { testnet: data.testnet, is_running: false });
      addLocalLog(
        context.userId,
        "warn",
        `Switched to ${data.testnet ? "TESTNET" : "MAINNET"} and stopped the bot`,
      );
      return { ok: true };
    }

    await supabaseAdmin
      .from("bot_config")
      .update({ testnet: data.testnet, is_running: false, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    await botLog(
      context.userId,
      "warn",
      `Switched to ${data.testnet ? "TESTNET" : "MAINNET"} and stopped the bot`,
    );
    return { ok: true };
  });

export const setMaxExposure = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { max: number }) => z.object({ max: z.number().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!hasSupabaseAdminEnv()) {
      updateLocalBotConfig(context.userId, { max_total_notional_usdt: data.max });
      return { ok: true };
    }

    await supabaseAdmin
      .from("bot_config")
      .update({ max_total_notional_usdt: data.max })
      .eq("user_id", context.userId);
    return { ok: true };
  });

const intelligenceSchema = z.object({
  advisor_enabled: z.boolean().optional(),
  auto_select_enabled: z.boolean().optional(),
  auto_select_max_symbols: z.number().int().min(1).max(15).optional(),
  drawdown_pause_pct: z.number().min(0).max(50).optional(),
  news_pause_enabled: z.boolean().optional(),
  news_pause_window_min: z.number().int().min(0).max(240).optional(),
  news_currencies: z.string().max(64).optional(),
});

export const setIntelligence = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof intelligenceSchema>) => intelligenceSchema.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of Object.keys(data) as Array<keyof typeof data>) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (!hasSupabaseAdminEnv()) {
      updateLocalBotConfig(context.userId, patch);
      addLocalLog(context.userId, "info", `Intelligence settings updated: ${JSON.stringify(data)}`);
      return { ok: true };
    }

    await supabaseAdmin
      .from("bot_config")
      .update(patch as any)
      .eq("user_id", context.userId);
    await botLog(context.userId, "info", `Intelligence settings updated: ${JSON.stringify(data)}`);
    return { ok: true };
  });

export const runAutoSelect = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasSupabaseAdminEnv()) {
      const local = getLocalBotState(context.userId);
      const max = Number(local.cfg.auto_select_max_symbols ?? 4);
      const top = local.symbols.slice(0, max).map((s) => ({ symbol: s.symbol, score: 0 }));
      for (const item of top) updateLocalSymbol(context.userId, item.symbol, { enabled: true });
      addLocalLog(
        context.userId,
        "info",
        `Local ranking enabled: ${top.map((t) => t.symbol).join(", ")}`,
      );
      return { ok: true, top };
    }

    const { rankAndApplyAutoSelect } = await import("@/lib/bot/ranking.server");
    const { data: cfg } = await supabaseAdmin
      .from("bot_config")
      .select("auto_select_max_symbols")
      .eq("user_id", context.userId)
      .maybeSingle();
    const max = Number((cfg as any)?.auto_select_max_symbols ?? 4);
    const top = await rankAndApplyAutoSelect(context.userId, max);
    return { ok: true, top };
  });

export const getNewsStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (!hasSupabaseAdminEnv()) {
      return { enabled: false, active: false } as const;
    }

    const { data: cfg } = await supabaseAdmin
      .from("bot_config")
      .select("news_pause_enabled,news_pause_window_min,news_currencies")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!cfg || (cfg as any).news_pause_enabled === false) {
      return { enabled: false, active: false } as const;
    }
    const { getBlackout } = await import("@/lib/bot/news.server");
    const currencies = String((cfg as any).news_currencies ?? "USD")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bo = await getBlackout({
      windowMinutes: Number((cfg as any).news_pause_window_min ?? 30),
      currencies,
    });
    return { enabled: true, ...bo } as const;
  });

const symbolSchema = z.object({
  symbol: z.string(),
  enabled: z.boolean(),
  grid_levels: z.number().int().min(1).max(20),
  grid_spacing_pct: z.number().positive(),
  order_size_usdt: z.number().positive(),
  leverage: z.number().int().min(1).max(20),
  upper_bound: z.number().nullable(),
  lower_bound: z.number().nullable(),
  auto_tune: z.boolean().optional(),
  min_order_size_usdt: z.number().positive().optional(),
  max_order_size_usdt: z.number().positive().optional(),
  min_spacing_pct: z.number().positive().optional(),
  max_spacing_pct: z.number().positive().optional(),
  stop_loss_roi_pct: z.number().max(0).optional(),
  max_position_age_minutes: z.number().int().min(0).optional(),
  trend_filter_enabled: z.boolean().optional(),
  trend_ema_period: z.number().int().min(5).max(500).optional(),
  trend_interval: z.enum(["15m", "30m", "1h", "2h", "4h", "1d"]).optional(),
  extreme_loss_threshold_usdt: z.number().max(0).optional(),
  extreme_loss_cooldown_min: z.number().int().min(0).max(1440).optional(),
  funding_filter_enabled: z.boolean().optional(),
  funding_max_abs_bps: z.number().min(0).max(1000).optional(),
  z_filter_enabled: z.boolean().optional(),
  z_lookback: z.number().int().min(5).max(500).optional(),
  z_interval: z.enum(["15m", "30m", "1h", "2h", "4h", "1d"]).optional(),
  z_entry_threshold: z.number().min(0).max(10).optional(),
});

export const updateSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof symbolSchema>) => symbolSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (!hasSupabaseAdminEnv()) {
      updateLocalSymbol(context.userId, data.symbol, data);
      addLocalLog(context.userId, "info", `Updated ${data.symbol} symbol settings`, data.symbol);
      if (getLocalBotState(context.userId).cfg.is_running) {
        ensureLocalBotRunner(context.userId);
        runLocalBotTick(context.userId).catch((error) => {
          addLocalLog(
            context.userId,
            "error",
            `Symbol update tick failed: ${(error as Error).message}`,
            data.symbol,
          );
        });
      }
      return { ok: true };
    }

    await supabaseAdmin
      .from("symbol_config")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol);
    return { ok: true };
  });

export const learnSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { learnFromTrades } = await import("@/lib/bot/learn.server");
    const { data: cfg } = await supabaseAdmin
      .from("symbol_config")
      .select("*")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .maybeSingle();
    if (!cfg) return { applied: false, note: "symbol not configured" };
    return learnFromTrades(cfg as any, { force: true });
  });

export const killSwitch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    if (!hasSupabaseAdminEnv()) {
      stopLocalBotRunner(userId);
      updateLocalBotConfig(userId, { is_running: false });
      const { creds } = await loadCreds(userId);
      const symbols = getLocalBotState(userId).symbols;
      for (const s of symbols) {
        try {
          await binance.cancelAllOrders(creds, s.symbol);
          addLocalLog(userId, "warn", "Canceled all open orders from kill switch", s.symbol);
        } catch (e) {
          addLocalLog(userId, "warn", `cancelAll ${s.symbol}: ${(e as Error).message}`, s.symbol);
        }
      }
      addLocalLog(
        userId,
        "error",
        "KILL SWITCH activated - bot stopped and all open orders were canceled",
      );
      return { ok: true };
    }

    await supabaseAdmin.from("bot_config").update({ is_running: false }).eq("user_id", userId);
    try {
      const { creds } = await loadCreds(userId);
      const { data: symbols } = await supabaseAdmin
        .from("symbol_config")
        .select("symbol")
        .eq("user_id", userId);
      for (const s of symbols ?? []) {
        try {
          await binance.cancelAllOrders(creds, s.symbol);
        } catch (e) {
          await botLog(userId, "warn", `cancelAll ${s.symbol}: ${(e as Error).message}`);
        }
      }
      await supabaseAdmin
        .from("grid_orders")
        .update({ status: "CANCELED" })
        .eq("user_id", userId)
        .eq("status", "NEW");
      await botLog(userId, "error", "KILL SWITCH activated – bot stopped and all orders canceled");
    } catch (e) {
      await botLog(userId, "error", `kill switch: ${(e as Error).message}`);
      throw e;
    }
    return { ok: true };
  });

export const closePosition = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    const positions = await binance.positionRisk(creds, data.symbol);
    const pos = positions.find((p: any) => p.symbol === data.symbol);
    const amt = parseFloat(pos?.positionAmt ?? "0");
    if (amt === 0) return { ok: true, message: "no position" };
    await binance.placeOrder(creds, {
      symbol: data.symbol,
      side: amt > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity: Math.abs(amt),
      reduceOnly: true,
    });
    await botLog(userId, "info", "Manually closed position", data.symbol);
    if (hasSupabaseAdminEnv()) {
      await syncFillsForSymbol(userId, creds, data.symbol);
    }
    return { ok: true };
  });

export const cancelSymbolOrders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    await binance.cancelAllOrders(creds, data.symbol);
    if (!hasSupabaseAdminEnv()) {
      addLocalLog(userId, "info", "Canceled all open orders", data.symbol);
      return { ok: true };
    }

    await supabaseAdmin
      .from("grid_orders")
      .update({ status: "CANCELED" })
      .eq("user_id", userId)
      .eq("symbol", data.symbol)
      .eq("status", "NEW");
    await botLog(userId, "info", "Canceled all open orders", data.symbol);
    return { ok: true };
  });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    let activeTestnet = true;
    try {
      const { creds, testnet } = await loadCreds(context.userId);
      activeTestnet = testnet;
      const check = await verifyFuturesCreds(creds);
      if (!check.ok) {
        if (testnet && check.reason?.includes("not treated as a credential failure")) {
          return { ok: true, testnet, balance: "demo", canTrade: true, warning: check.reason };
        }
        return { ok: false, testnet, error: check.reason };
      }
      return {
        ok: true,
        testnet,
        balance: check.account!.totalWalletBalance,
        canTrade: check.account!.canTrade ?? true,
      };
    } catch (e) {
      const msg = isBinanceAuthError(e)
        ? formatBinanceError(e, activeTestnet)
        : (e as Error).message;
      return { ok: false, error: msg };
    }
  });

// --- Per-user Binance creds management ---

const credsSchema = z.object({
  api_key: z.string().nullable().optional(),
  api_secret: z.string().nullable().optional(),
  testnet_api_key: z.string().nullable().optional(),
  testnet_api_secret: z.string().nullable().optional(),
});

function cleanOptionalSecret(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const saveBinanceCreds = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.infer<typeof credsSchema>) => credsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const mainnetApiKey = cleanOptionalSecret(data.api_key);
    const mainnetApiSecret = cleanOptionalSecret(data.api_secret);
    const testnetApiKey = cleanOptionalSecret(data.testnet_api_key);
    const testnetApiSecret = cleanOptionalSecret(data.testnet_api_secret);

    if (!!mainnetApiKey !== !!mainnetApiSecret) {
      throw new Error("Enter both the mainnet API key and mainnet API secret together.");
    }
    if (!!testnetApiKey !== !!testnetApiSecret) {
      throw new Error("Enter both the testnet API key and testnet API secret together.");
    }

    // Only overwrite complete key/secret pairs. Empty/undefined leaves the existing pair untouched.
    const patch: Record<string, string> = {};
    if (mainnetApiKey && mainnetApiSecret) {
      patch.api_key = mainnetApiKey;
      patch.api_secret = mainnetApiSecret;
    }
    if (testnetApiKey && testnetApiSecret) {
      patch.testnet_api_key = testnetApiKey;
      patch.testnet_api_secret = testnetApiSecret;
    }

    if (Object.keys(patch).length === 0) {
      throw new Error("Enter a complete Binance API key and secret pair before saving.");
    }

    if (!hasSupabaseAdminEnv()) {
      saveLocalBinanceCreds(userId, patch);
      addLocalLog(userId, "info", "Updated Binance API credentials");
      return { ok: true };
    }

    const { data: existing } = await supabaseAdmin
      .from("user_binance_creds")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("user_binance_creds")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    } else {
      await supabaseAdmin.from("user_binance_creds").insert({ user_id: userId, ...patch });
    }
    await botLog(userId, "info", "Updated Binance API credentials");
    return { ok: true };
  });

export const autoConfigureSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string }) => z.object({ symbol: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { creds } = await loadCreds(userId);
    const symbol = data.symbol;

    const [klines, acct, mark] = await Promise.all([
      binance.klines(creds, symbol, "1h", 168),
      binance.account(creds),
      binance.markPrice(creds, symbol),
    ]);

    if (!klines.length) throw new Error(`No kline data for ${symbol}`);

    const highs = klines.map((k) => parseFloat(k[2] as string));
    const lows = klines.map((k) => parseFloat(k[3] as string));
    const closes = klines.map((k) => parseFloat(k[4] as string));
    const ranges = klines.map((k, i) => {
      const high = parseFloat(k[2] as string);
      const low = parseFloat(k[3] as string);
      return (high - low) / closes[i];
    });
    const avgRangePct = (ranges.reduce((a, b) => a + b, 0) / ranges.length) * 100;
    const high7d = Math.max(...highs);
    const low7d = Math.min(...lows);
    const price = parseFloat(mark.markPrice);

    const last24 = closes.slice(-24);
    const trendPct = ((last24[last24.length - 1] - last24[0]) / last24[0]) * 100;

    const spacingPctRaw = Math.max(0.2, Math.min(2.0, avgRangePct * 1.2));
    const spacingPct = Math.round(spacingPctRaw * 100) / 100;
    const gridLevels = 1;
    const leverage = Math.max(2, Math.min(5, Math.round(2 / spacingPct)));

    if (!hasSupabaseAdminEnv()) {
      const available = parseFloat(acct.availableBalance) || 0;
      const orderSize = Math.max(75, Math.min(150, Math.round(available * 0.02 * 100) / 100));
      const lowerBound = Math.round(low7d * 0.98 * 1e6) / 1e6;
      const upperBound = Math.round(high7d * 1.02 * 1e6) / 1e6;
      updateLocalSymbol(userId, symbol, {
        enabled: true,
        grid_levels: 1,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        min_order_size_usdt: 50,
        max_order_size_usdt: 150,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
        backtest_at: new Date().toISOString(),
      });
      updateLocalBotConfig(userId, {
        max_total_notional_usdt: Math.max(1500, Math.ceil(orderSize * 3)),
      });
      addLocalLog(
        userId,
        "info",
        `Auto-configured one-grid ${symbol}: 1 order × ${spacingPct.toFixed(2)}% spacing, ${leverage}x, ${orderSize} USDT. Range ${lowerBound}-${upperBound}. Vol ${avgRangePct.toFixed(2)}%/h, 24h trend ${trendPct.toFixed(2)}%.`,
        symbol,
      );
      return {
        ok: true,
        analysis: {
          price,
          avgHourlyRangePct: Number(avgRangePct.toFixed(3)),
          trend24hPct: Number(trendPct.toFixed(2)),
          high7d,
          low7d,
          availableBalance: available,
        },
        config: {
          grid_levels: 1,
          grid_spacing_pct: spacingPct,
          order_size_usdt: orderSize,
          leverage,
          lower_bound: lowerBound,
          upper_bound: upperBound,
        },
      };
    }

    const [{ data: botCfg }, { data: otherSymbols }] = await Promise.all([
      supabaseAdmin
        .from("bot_config")
        .select("max_total_notional_usdt")
        .eq("user_id", userId)
        .single(),
      supabaseAdmin
        .from("symbol_config")
        .select("symbol,enabled,order_size_usdt,grid_levels")
        .eq("user_id", userId)
        .neq("symbol", symbol),
    ]);
    const currentCap = Number(botCfg?.max_total_notional_usdt ?? 500);
    const otherExposure = (otherSymbols ?? [])
      .filter((r) => r.enabled)
      .reduce((sum, r) => sum + Number(r.order_size_usdt) * Number(r.grid_levels) * 2, 0);

    const available = parseFloat(acct.availableBalance) || 0;
    const totalOrders = gridLevels * 2;

    let orderSize = (available * 0.5) / totalOrders;
    orderSize = Math.max(5.5, orderSize);
    orderSize = Math.round(orderSize * 100) / 100;

    const thisExposure = orderSize * totalOrders;
    const requiredCap = Math.ceil(otherExposure + thisExposure);
    const newCap = Math.max(currentCap, requiredCap);

    const lowerBound = Math.round(low7d * 0.98 * 1e6) / 1e6;
    const upperBound = Math.round(high7d * 1.02 * 1e6) / 1e6;

    await supabaseAdmin
      .from("symbol_config")
      .update({
        grid_levels: gridLevels,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("symbol", symbol);

    if (newCap !== currentCap) {
      await supabaseAdmin
        .from("bot_config")
        .update({ max_total_notional_usdt: newCap, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    const capNote = newCap !== currentCap ? ` Cap raised ${currentCap}→${newCap} USDT.` : "";
    await botLog(
      userId,
      "info",
      `Auto-configured: ${gridLevels} levels × ${spacingPct.toFixed(2)}% spacing, ${leverage}x lev, ${orderSize} USDT/order. Range ${lowerBound}–${upperBound}. Vol ${avgRangePct.toFixed(2)}%/h, 24h trend ${trendPct.toFixed(2)}%.${capNote}`,
      symbol,
    );

    return {
      ok: true,
      analysis: {
        price,
        avgHourlyRangePct: Number(avgRangePct.toFixed(3)),
        trend24hPct: Number(trendPct.toFixed(2)),
        high7d,
        low7d,
        availableBalance: available,
      },
      config: {
        grid_levels: gridLevels,
        grid_spacing_pct: spacingPct,
        order_size_usdt: orderSize,
        leverage,
        lower_bound: lowerBound,
        upper_bound: upperBound,
      },
    };
  });

export const optimizeSymbol = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { symbol: string; days?: number }) =>
    z.object({ symbol: z.string(), days: z.number().int().min(7).max(90).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { backtestGrid } = await import("@/lib/binance/backtest.server");
    const { creds } = await loadCreds(userId);
    const symbol = data.symbol;
    const days = data.days ?? 60;

    const [klines, acct, mark] = await Promise.all([
      binance.klines(creds, symbol, "1h", Math.min(1500, days * 24)),
      binance.account(creds),
      binance.markPrice(creds, symbol),
    ]);
    if (klines.length < 24) throw new Error(`Not enough kline data for ${symbol}`);

    const closes = klines.map((k: any) => parseFloat(k[4]));
    const highs = klines.map((k: any) => parseFloat(k[2]));
    const lows = klines.map((k: any) => parseFloat(k[3]));
    const high60 = Math.max(...highs);
    const low60 = Math.min(...lows);
    const lowerBound = low60 * 0.98;
    const upperBound = high60 * 1.02;
    const available = parseFloat(acct.availableBalance) || 0;

    const spacings = [0.3, 0.5, 0.8, 1.2, 1.8, 2.5];
    const levelsArr = [1];
    const leverages = [2, 3, 5];

    type Trial = {
      spacingPct: number;
      gridLevels: number;
      leverage: number;
      orderSizeUsdt: number;
    } & ReturnType<typeof backtestGrid>;
    const trials: Trial[] = [];

    for (const spacingPct of spacings) {
      for (const gridLevels of levelsArr) {
        for (const leverage of leverages) {
          const totalOrders = gridLevels * 2;
          let orderSize = (available * 0.5) / totalOrders;
          orderSize = Math.max(5.5, Math.round(orderSize * 100) / 100);
          const result = backtestGrid(klines, {
            gridLevels,
            spacingPct,
            orderSizeUsdt: orderSize,
            leverage,
            lowerBound,
            upperBound,
          });
          trials.push({ spacingPct, gridLevels, leverage, orderSizeUsdt: orderSize, ...result });
        }
      }
    }

    const valid = trials.filter((t) => !t.liquidated && t.fills >= 5);
    const ranked = (valid.length ? valid : trials).sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (!hasSupabaseAdminEnv()) {
      const orderSizeUsdt = Math.max(75, Math.min(150, best.orderSizeUsdt));
      updateLocalSymbol(userId, symbol, {
        enabled: true,
        grid_levels: 1,
        grid_spacing_pct: best.spacingPct,
        order_size_usdt: orderSizeUsdt,
        min_order_size_usdt: 50,
        max_order_size_usdt: 150,
        leverage: best.leverage,
        lower_bound: Math.round(lowerBound * 1e6) / 1e6,
        upper_bound: Math.round(upperBound * 1e6) / 1e6,
        backtest_pnl: best.realizedPnl,
        backtest_max_drawdown: best.maxDrawdown,
        backtest_fills: best.fills,
        backtest_return_pct: best.netReturnPct,
        backtest_at: new Date().toISOString(),
      });
      updateLocalBotConfig(userId, { max_total_notional_usdt: 1500 });
      addLocalLog(
        userId,
        "info",
        `Optimized one-grid ${symbol} over ${days}d: 1 level x ${best.spacingPct}% x ${best.leverage}x -> backtest PnL ${best.realizedPnl} USDT, ${best.fills} fills, max DD ${best.maxDrawdown}, return ${best.netReturnPct}%`,
        symbol,
      );

      return {
        ok: true,
        best: { ...best, gridLevels: 1, orderSizeUsdt },
        topResults: ranked.slice(0, 5).map((t) => ({
          spacingPct: t.spacingPct,
          gridLevels: 1,
          leverage: t.leverage,
          orderSizeUsdt: Math.max(75, Math.min(150, t.orderSizeUsdt)),
          realizedPnl: t.realizedPnl,
          maxDrawdown: t.maxDrawdown,
          fills: t.fills,
          netReturnPct: t.netReturnPct,
          liquidated: t.liquidated,
        })),
        bounds: { lowerBound, upperBound },
        trialsTested: trials.length,
        validTrials: valid.length,
        daysAnalyzed: Math.round(klines.length / 24),
      };
    }

    await supabaseAdmin
      .from("symbol_config")
      .update({
        grid_levels: 1,
        grid_spacing_pct: best.spacingPct,
        order_size_usdt: best.orderSizeUsdt,
        leverage: best.leverage,
        lower_bound: Math.round(lowerBound * 1e6) / 1e6,
        upper_bound: Math.round(upperBound * 1e6) / 1e6,
        backtest_pnl: best.realizedPnl,
        backtest_max_drawdown: best.maxDrawdown,
        backtest_fills: best.fills,
        backtest_return_pct: best.netReturnPct,
        backtest_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("symbol", symbol);

    const { data: botCfg } = await supabaseAdmin
      .from("bot_config")
      .select("max_total_notional_usdt")
      .eq("user_id", userId)
      .single();
    const currentCap = Number(botCfg?.max_total_notional_usdt ?? 500);
    const planned = best.orderSizeUsdt * 2;
    if (planned > currentCap) {
      await supabaseAdmin
        .from("bot_config")
        .update({
          max_total_notional_usdt: Math.ceil(planned),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    await botLog(
      userId,
      "info",
      `Optimized over ${days}d: 1 level × ${best.spacingPct}% × ${best.leverage}x -> backtest PnL ${best.realizedPnl} USDT, ${best.fills} fills, max DD ${best.maxDrawdown}, return ${best.netReturnPct}%`,
      symbol,
    );

    return {
      ok: true,
      best: { ...best, gridLevels: 1 },
      topResults: ranked.slice(0, 5).map((t) => ({
        spacingPct: t.spacingPct,
        gridLevels: t.gridLevels,
        leverage: t.leverage,
        orderSizeUsdt: t.orderSizeUsdt,
        realizedPnl: t.realizedPnl,
        maxDrawdown: t.maxDrawdown,
        fills: t.fills,
        netReturnPct: t.netReturnPct,
        liquidated: t.liquidated,
      })),
      bounds: { lowerBound, upperBound },
      trialsTested: trials.length,
      validTrials: valid.length,
      daysAnalyzed: Math.round(klines.length / 24),
    };
  });
