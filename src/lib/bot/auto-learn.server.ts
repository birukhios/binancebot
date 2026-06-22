import { binance } from "@/lib/binance/client.server";
import { addLocalLog, getLocalBotState, updateLocalSymbol } from "@/lib/bot/local-bot-store.server";

// How the bot improvises:
//  - It reads its own CLOSED trades (realized PnL fills) from Binance.
//  - It measures win rate, profit factor and recent loss streaks.
//  - It nudges four learned knobs toward performance-implied targets, using
//    smooth EMA convergence so the strategy adapts without oscillating:
//      learned_spacing_mult      → wider grid in chop/trend, tighter when winning
//      take_profit_spacing_mult  → bank quicker when win-rate is low, let winners
//                                  run when win-rate is high
//      learned_stop_mult         → cut losers faster when profit factor < 1
//      learned_size_mult         → de-risk after loss streaks, recover when healthy

const RELEARN_INTERVAL_MS = 8 * 60 * 1000;
const MIN_FILLS_TO_ACT = 8;
const LEARN_RATE = 0.34;

// Base take-profit multiplier (mirrors grid.server TAKE_PROFIT_SPACING_MULT).
// Kept ~aligned with the maker grid exit so closes stay cheap (maker) fills.
const TP_BASE = 0.85;

const CLAMP = {
  spacing: [0.7, 1.6] as const,
  // Keep TP aligned with the maker grid exit (cheap closes). Speed comes from
  // tight spacing, not from shrinking the TP below the maker exit.
  tp: [0.6, 1.1] as const,
  stop: [0.7, 1.3] as const,
  size: [0.5, 1.0] as const,
};

function clamp(value: number, [lo, hi]: readonly [number, number]) {
  return Math.max(lo, Math.min(hi, value));
}

function converge(current: number, target: number, rate = LEARN_RATE) {
  return current + (target - current) * rate;
}

export interface LearnedKnobs {
  spacingMult: number;
  tpMult: number;
  stopMult: number;
  sizeMult: number;
}

function readKnobs(cfg: any): LearnedKnobs {
  return {
    spacingMult: Number(cfg?.learned_spacing_mult ?? 1) || 1,
    tpMult: Number(cfg?.take_profit_spacing_mult ?? TP_BASE) || TP_BASE,
    stopMult: Number(cfg?.learned_stop_mult ?? 1) || 1,
    sizeMult: Number(cfg?.learned_size_mult ?? 1) || 1,
  };
}

/**
 * Analyze closed orders and improvise the strategy. Cheap on most ticks: it
 * only calls Binance and recomputes when the relearn interval has elapsed.
 * Always returns the current learned knobs so the caller can apply them.
 */
export async function maybeAutoLearn(
  userId: string,
  creds: any,
  symbol: string,
  opts: { force?: boolean } = {},
): Promise<LearnedKnobs> {
  const state = getLocalBotState(userId);
  const cfg = state.symbols.find((s) => s.symbol === symbol);
  const current = readKnobs(cfg);

  const lastAt = Date.parse(String(cfg?.learning_at ?? "")) || 0;
  if (!opts.force && Date.now() - lastAt < RELEARN_INTERVAL_MS) {
    return current;
  }

  let fills: any[] = [];
  try {
    fills = await binance.userTrades(creds, symbol, undefined, 500);
  } catch {
    return current;
  }

  // Closing fills carry non-zero realized PnL. Each is one completed round-trip.
  const closed = fills
    .filter((t: any) => Number(t.realizedPnl ?? 0) !== 0)
    .map((t: any) => {
      const usdtCommission = String(t.commissionAsset ?? "")
        .toUpperCase()
        .includes("USDT")
        ? Number(t.commission ?? 0)
        : 0;
      return {
        id: Number(t.id ?? 0),
        time: Number(t.time ?? 0),
        net: Number(t.realizedPnl ?? 0) - usdtCommission,
      };
    })
    .sort((a, b) => a.time - b.time);

  const lastFillId = Number(cfg?.learning_last_fill_id ?? 0);
  const newFills = closed.filter((c) => c.id > lastFillId);
  const latestId = closed.length ? closed[closed.length - 1].id : lastFillId;

  // Nothing new to learn from — just bump the timestamp so we don't re-poll.
  if (!opts.force && newFills.length === 0) {
    updateLocalSymbol(userId, symbol, { learning_at: new Date().toISOString() });
    return current;
  }

  // Use a recent window so the bot tracks current market regime.
  const recent = closed.slice(-50);
  if (recent.length < MIN_FILLS_TO_ACT) {
    updateLocalSymbol(userId, symbol, {
      learning_at: new Date().toISOString(),
      last_learned_at: new Date().toISOString(),
      learning_last_fill_id: latestId,
      learning_fills: recent.length,
      learning_notes: `Collecting data: ${recent.length}/${MIN_FILLS_TO_ACT} closed orders before adapting.`,
    });
    return current;
  }

  const wins = recent.filter((c) => c.net > 0);
  const losses = recent.filter((c) => c.net < 0);
  const winRate = wins.length / recent.length;
  const grossWin = wins.reduce((s, c) => s + c.net, 0);
  const grossLoss = Math.abs(losses.reduce((s, c) => s + c.net, 0));
  const netPnl = recent.reduce((s, c) => s + c.net, 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 3 : 1;

  // Trailing loss streak (most recent consecutive losers).
  let lossStreak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].net < 0) lossStreak++;
    else break;
  }

  // ---- Derive performance-implied targets ----
  let spacingTarget = 1.0;
  if (winRate >= 0.6 && netPnl > 0) spacingTarget = 0.85;
  else if (winRate < 0.45 || netPnl < 0) spacingTarget = 1.35;

  // Reward:risk is the lever here. When losing (PF < 1), the wins are too
  // small versus the losses — let winners run FURTHER (bigger TP) so the
  // average win can cover the average loss. Only when it is already winning
  // comfortably do we tighten TP to bank more often.
  // Keep TP aligned with the maker exit. Nudge slightly within the band based
  // on performance; speed is governed by spacing, not by shrinking the TP.
  let tpTarget = TP_BASE;
  if (profitFactor < 0.9 && netPnl < 0) {
    tpTarget = 1.0; // losing → let winners run a touch more
  } else if (winRate >= 0.75 && profitFactor > 1.4) {
    tpTarget = 0.7; // winning comfortably → bank a bit quicker
  }

  let stopTarget = 1.0;
  if (profitFactor < 1.0 || lossStreak >= 3) stopTarget = 0.8; // cut losers faster
  else if (profitFactor > 1.6 && winRate >= 0.55) stopTarget = 1.2; // give room

  let sizeTarget = 1.0;
  if (netPnl < 0 && lossStreak >= 3) sizeTarget = 0.7; // de-risk

  const next: LearnedKnobs = {
    spacingMult: clamp(converge(current.spacingMult, spacingTarget), CLAMP.spacing),
    tpMult: clamp(converge(current.tpMult, tpTarget), CLAMP.tp),
    stopMult: clamp(converge(current.stopMult, stopTarget), CLAMP.stop),
    sizeMult: clamp(converge(current.sizeMult, sizeTarget), CLAMP.size),
  };

  const note =
    `Learned from ${recent.length} closed orders: win ${(winRate * 100).toFixed(0)}%, ` +
    `PF ${profitFactor.toFixed(2)}, net ${netPnl.toFixed(4)} USDT, streak ${lossStreak}. ` +
    `→ spacing×${next.spacingMult.toFixed(2)} TP×${next.tpMult.toFixed(2)} ` +
    `stop×${next.stopMult.toFixed(2)} size×${next.sizeMult.toFixed(2)}`;

  updateLocalSymbol(userId, symbol, {
    learned_spacing_mult: Math.round(next.spacingMult * 1000) / 1000,
    take_profit_spacing_mult: Math.round(next.tpMult * 1000) / 1000,
    learned_stop_mult: Math.round(next.stopMult * 1000) / 1000,
    learned_size_mult: Math.round(next.sizeMult * 1000) / 1000,
    learning_win_rate: Math.round(winRate * 1000) / 1000,
    learning_profit_factor: Math.round(profitFactor * 1000) / 1000,
    learning_net_pnl: Math.round(netPnl * 10000) / 10000,
    learning_fills: recent.length,
    learning_last_fill_id: latestId,
    learning_at: new Date().toISOString(),
    last_learned_at: new Date().toISOString(),
    learning_notes: note,
  });

  addLocalLog(userId, "info", `Strategy adapted — ${note}`, symbol, {
    dedupeKey: `auto-learn-${symbol}`,
    dedupeWindowMs: 5 * 60 * 1000,
  });

  return next;
}
