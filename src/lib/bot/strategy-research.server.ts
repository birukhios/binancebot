import { backtestGrid, type BacktestResult } from "@/lib/binance/backtest.server";

type StrategyCandidate = {
  source: "freqtrade" | "hummingbot" | "jesse";
  name: string;
  hypothesis: string;
  gridLevels: number;
  spacingPct: number;
  leverage: number;
  stopLossRoiPct: number;
  trendFilterEnabled: boolean;
  fundingMaxAbsBps: number;
  zFilterEnabled: boolean;
  zEntryThreshold: number;
};

type StrategyTrial = StrategyCandidate & {
  orderSizeUsdt: number;
  train: BacktestResult;
  test: BacktestResult;
  combinedScore: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function closes(klines: any[][]) {
  return klines.map((k) => Number(k[4])).filter((v) => Number.isFinite(v) && v > 0);
}

function ema(values: number[], period: number) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atrPct(klines: any[][], period = 14) {
  if (klines.length <= period) return null;
  const trs: number[] = [];
  for (let i = klines.length - period; i < klines.length; i++) {
    const high = Number(klines[i][2]);
    const low = Number(klines[i][3]);
    const prevClose = Number(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const lastClose = Number(klines[klines.length - 1][4]);
  if (!lastClose) return null;
  return (trs.reduce((sum, v) => sum + v, 0) / trs.length / lastClose) * 100;
}

function rangeBounds(klines: any[][]) {
  const highs = klines.map((k) => Number(k[2])).filter(Number.isFinite);
  const lows = klines.map((k) => Number(k[3])).filter(Number.isFinite);
  return {
    lowerBound: Math.round(Math.min(...lows) * 0.98 * 1e6) / 1e6,
    upperBound: Math.round(Math.max(...highs) * 1.02 * 1e6) / 1e6,
  };
}

function candidatesFor(klines: any[][]): StrategyCandidate[] {
  const values = closes(klines);
  const latestRsi = rsi(values) ?? 50;
  const fast = ema(values, 20) ?? values[values.length - 1];
  const slow = ema(values, 80) ?? fast;
  const trendPct = slow > 0 ? ((fast - slow) / slow) * 100 : 0;
  const realizedAtr = clamp(atrPct(klines) ?? 0.8, 0.3, 2.2);
  const stretched = latestRsi >= 68 || latestRsi <= 32;
  const trending = Math.abs(trendPct) >= realizedAtr * 0.5;

  return [
    {
      source: "hummingbot",
      name: "PMM inventory-skew grid",
      hypothesis: "Market-making style grid with inventory-aware exits, multiple order levels, and moderate funding filter.",
      gridLevels: 2,
      spacingPct: round2(clamp(realizedAtr * 1.15, 0.6, 1.4)),
      leverage: 2,
      stopLossRoiPct: -10,
      trendFilterEnabled: true,
      fundingMaxAbsBps: 18,
      zFilterEnabled: false,
      zEntryThreshold: 1.2,
    },
    {
      source: "hummingbot",
      name: "Avellaneda volatility-wide grid",
      hypothesis: "Widen spreads when realized volatility is higher and keep leverage low to reduce liquidation pressure.",
      gridLevels: 2,
      spacingPct: round2(clamp(realizedAtr * 1.65, 0.8, 2.2)),
      leverage: 2,
      stopLossRoiPct: -8,
      trendFilterEnabled: true,
      fundingMaxAbsBps: 12,
      zFilterEnabled: false,
      zEntryThreshold: 1.5,
    },
    {
      source: "freqtrade",
      name: "RSI Bollinger mean-reversion grid",
      hypothesis: "Only favor mean-reversion entries when price appears stretched, using a tighter grid in choppy markets.",
      gridLevels: 2,
      spacingPct: round2(clamp(realizedAtr * (stretched ? 1.0 : 1.35), 0.6, 1.8)),
      leverage: 2,
      stopLossRoiPct: -9,
      trendFilterEnabled: false,
      fundingMaxAbsBps: 14,
      zFilterEnabled: true,
      zEntryThreshold: stretched ? 1.0 : 1.4,
    },
    {
      source: "freqtrade",
      name: "EMA trend-pullback grid",
      hypothesis: "Trade pullbacks around the trend bias while keeping counter-trend exposure smaller.",
      gridLevels: 2,
      spacingPct: round2(clamp(realizedAtr * 0.95, 0.6, 1.3)),
      leverage: 2,
      stopLossRoiPct: -12,
      trendFilterEnabled: true,
      fundingMaxAbsBps: 16,
      zFilterEnabled: false,
      zEntryThreshold: 1.2,
    },
    {
      source: "jesse",
      name: "Walk-forward conservative grid",
      hypothesis: "Prefer parameters that survive an out-of-sample window, even if the in-sample score is not the highest.",
      gridLevels: 2,
      spacingPct: round2(clamp(realizedAtr * 1.4, 0.8, 2.0)),
      leverage: 1,
      stopLossRoiPct: -7,
      trendFilterEnabled: true,
      fundingMaxAbsBps: 10,
      zFilterEnabled: false,
      zEntryThreshold: 1.4,
    },
  ];
}

export function researchOpenSourceInspiredStrategies(
  klines: any[][],
  opts: { symbol: string; availableBalance: number },
) {
  if (klines.length < 120) {
    throw new Error(`Need at least 120 candles to research learned strategies for ${opts.symbol}.`);
  }

  const split = Math.max(80, Math.floor(klines.length * 0.7));
  const trainKlines = klines.slice(0, split);
  const testKlines = klines.slice(split);
  const fullBounds = rangeBounds(klines);
  const orderSizeUsdt = clamp(Math.round((opts.availableBalance * 0.5) / 4), 75, 150);

  const trials: StrategyTrial[] = candidatesFor(trainKlines).map((candidate) => {
    const train = backtestGrid(trainKlines, {
      gridLevels: candidate.gridLevels,
      spacingPct: candidate.spacingPct,
      orderSizeUsdt,
      leverage: candidate.leverage,
      ...rangeBounds(trainKlines),
    });
    const test = backtestGrid(testKlines, {
      gridLevels: candidate.gridLevels,
      spacingPct: candidate.spacingPct,
      orderSizeUsdt,
      leverage: candidate.leverage,
      ...rangeBounds(testKlines),
    });
    const drawdownPenalty = Math.abs(test.maxDrawdown) * 1.5 + Math.abs(train.maxDrawdown) * 0.5;
    const combinedScore =
      (test.liquidated ? -1_000_000 : test.score * 2) +
      (train.liquidated ? -500_000 : train.score * 0.5) -
      drawdownPenalty;
    return { ...candidate, orderSizeUsdt, train, test, combinedScore: round2(combinedScore) };
  });

  const valid = trials.filter((trial) => {
    const enoughFills = trial.train.fills + trial.test.fills >= 6;
    const survived = !trial.train.liquidated && !trial.test.liquidated;
    const drawdownOk = Math.abs(trial.test.maxDrawdown) <= Math.max(orderSizeUsdt * 2, opts.availableBalance * 0.12);
    return enoughFills && survived && drawdownOk;
  });
  const ranked = (valid.length ? valid : trials).sort((a, b) => b.combinedScore - a.combinedScore);
  const best = ranked[0];

  return {
    best,
    ranked: ranked.slice(0, 5),
    patch: {
      enabled: true,
      grid_levels: best.gridLevels,
      grid_spacing_pct: best.spacingPct,
      order_size_usdt: best.orderSizeUsdt,
      min_order_size_usdt: 50,
      max_order_size_usdt: Math.max(150, best.orderSizeUsdt),
      leverage: best.leverage,
      lower_bound: fullBounds.lowerBound,
      upper_bound: fullBounds.upperBound,
      stop_loss_roi_pct: best.stopLossRoiPct,
      trend_filter_enabled: best.trendFilterEnabled,
      funding_filter_enabled: true,
      funding_max_abs_bps: best.fundingMaxAbsBps,
      z_filter_enabled: best.zFilterEnabled,
      z_entry_threshold: best.zEntryThreshold,
      learned_strategy_source: best.source,
      learned_strategy_name: best.name,
      learning_notes: `${best.source}: ${best.name}. ${best.hypothesis}`,
      backtest_pnl: best.test.realizedPnl,
      backtest_max_drawdown: best.test.maxDrawdown,
      backtest_fills: best.test.fills,
      backtest_return_pct: best.test.netReturnPct,
      backtest_at: new Date().toISOString(),
    },
    validTrials: valid.length,
    trialsTested: trials.length,
  };
}
