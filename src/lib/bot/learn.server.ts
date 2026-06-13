import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { botLog } from "@/lib/bot/log.server";

const MIN_TRADES = 10;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

type SymbolCfg = {
  user_id: string;
  symbol: string;
  enabled: boolean;
  grid_spacing_pct: number;
  order_size_usdt: number;
  auto_tune: boolean | null;
  min_order_size_usdt: number | null;
  max_order_size_usdt: number | null;
  min_spacing_pct: number | null;
  max_spacing_pct: number | null;
  last_learned_at: string | null;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Adapt grid_spacing_pct and order_size_usdt for one (user,symbol)
 * based on the last 50 realized fills. Bounded ±20% per run and clamped
 * to user-defined min/max. Returns null if no change made.
 */
export async function learnFromTrades(
  cfg: SymbolCfg,
  opts: { force?: boolean } = {},
): Promise<{ applied: boolean; note: string }> {
  if (!opts.force) {
    if (!cfg.auto_tune) return { applied: false, note: "auto_tune disabled" };
    if (cfg.last_learned_at) {
      const age = Date.now() - new Date(cfg.last_learned_at).getTime();
      if (age < COOLDOWN_MS) return { applied: false, note: "cooldown" };
    }
  }

  const { data: trades } = await supabaseAdmin
    .from("trades")
    .select("realized_pnl,commission,price,qty,filled_at")
    .eq("user_id", cfg.user_id)
    .eq("symbol", cfg.symbol)
    .order("filled_at", { ascending: false })
    .limit(50);

  if (!trades || trades.length < MIN_TRADES) {
    return { applied: false, note: `need ${MIN_TRADES}+ trades (have ${trades?.length ?? 0})` };
  }

  let realized = 0;
  let fees = 0;
  let wins = 0;
  let nonZero = 0;
  let notional = 0;
  for (const t of trades) {
    const pnl = Number(t.realized_pnl) || 0;
    realized += pnl;
    fees += Number(t.commission) || 0;
    notional += (Number(t.price) || 0) * (Number(t.qty) || 0);
    if (pnl !== 0) {
      nonZero++;
      if (pnl > 0) wins++;
    }
  }
  const net = realized - fees;
  const winRate = nonZero ? wins / nonZero : 0;
  const roi = notional ? net / notional : 0;

  const minSpacing = cfg.min_spacing_pct ?? 0.2;
  const maxSpacing = cfg.max_spacing_pct ?? 3.0;
  const minSize = cfg.min_order_size_usdt ?? 10;
  const maxSize = cfg.max_order_size_usdt ?? 200;

  let newSpacing = cfg.grid_spacing_pct;
  let newSize = cfg.order_size_usdt;
  let newEnabled = cfg.enabled;
  const reasons: string[] = [];

  if (net < 0 && winRate < 0.4) {
    newSpacing = cfg.grid_spacing_pct * 1.2;
    newSize = cfg.order_size_usdt * 0.8;
    reasons.push("losing streak — widening spacing, shrinking size");
  } else if (net > 0 && winRate > 0.55) {
    newSpacing = cfg.grid_spacing_pct * 0.95;
    newSize = cfg.order_size_usdt * 1.1;
    reasons.push("profitable — tightening spacing, increasing size");
  } else {
    reasons.push("flat performance — no change");
  }

  // Auto-disable on sustained deep loss
  if (trades.length >= 30 && roi < -0.05) {
    newEnabled = false;
    reasons.push(`auto-disabled (roi ${(roi * 100).toFixed(2)}%)`);
  }

  newSpacing = clamp(Number(newSpacing.toFixed(4)), minSpacing, maxSpacing);
  newSize = clamp(Number(newSize.toFixed(2)), minSize, maxSize);

  const changed =
    newSpacing !== cfg.grid_spacing_pct ||
    newSize !== cfg.order_size_usdt ||
    newEnabled !== cfg.enabled;

  const note = `n=${trades.length} pnl=${net.toFixed(2)} win=${(winRate * 100).toFixed(0)}% roi=${(roi * 100).toFixed(2)}% → ${reasons.join("; ")}`;

  await supabaseAdmin
    .from("symbol_config")
    .update({
      grid_spacing_pct: newSpacing,
      order_size_usdt: newSize,
      enabled: newEnabled,
      last_learned_at: new Date().toISOString(),
      learning_notes: note,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", cfg.user_id)
    .eq("symbol", cfg.symbol);

  if (changed) {
    await botLog(
      cfg.user_id,
      "info",
      `learn: spacing ${cfg.grid_spacing_pct}→${newSpacing}, size ${cfg.order_size_usdt}→${newSize}${newEnabled !== cfg.enabled ? `, enabled→${newEnabled}` : ""}. ${note}`,
      cfg.symbol,
    );
  }

  return { applied: changed, note };
}
