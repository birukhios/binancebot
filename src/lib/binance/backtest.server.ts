// Grid backtest simulator. Server-only.
// Replays historical klines through a grid strategy and reports PnL,
// drawdown, fill count. Approximations:
//   - Fills assumed at the grid price when candle range crosses it.
//   - Maker fee 0.02% per fill (Binance Futures default).
//   - Treats each round-trip (buy+sell or sell+buy at adjacent levels) as
//     a realized profit of orderSize * spacingPct.
//   - Unrealized inventory tracked for drawdown; liquidation modeled when
//     unrealized loss exceeds margin.

export interface BacktestConfig {
  gridLevels: number; // each side
  spacingPct: number; // e.g. 1.0
  orderSizeUsdt: number; // notional per order
  leverage: number;
  lowerBound: number;
  upperBound: number;
}

export interface BacktestResult {
  fills: number;
  realizedPnl: number;
  maxDrawdown: number; // worst unrealized $ loss seen
  finalInventoryUsdt: number; // signed: + long, - short
  liquidated: boolean;
  endPrice: number;
  netReturnPct: number; // realized / margin used
  score: number; // risk-adjusted: realized - 2 * |maxDD|
}

const FEE_RATE = 0.0002; // 0.02% maker

// klines rows: [openTime, open, high, low, close, volume, ...]
export function backtestGrid(
  klines: any[][],
  cfg: BacktestConfig,
): BacktestResult {
  if (!klines.length) {
    return {
      fills: 0, realizedPnl: 0, maxDrawdown: 0, finalInventoryUsdt: 0,
      liquidated: false, endPrice: 0, netReturnPct: 0, score: -Infinity,
    };
  }

  const startPrice = parseFloat(klines[0][4]);
  const spacing = cfg.spacingPct / 100;

  // Build grid levels around startPrice, clipped to bounds.
  const buyLevels: { price: number; active: boolean }[] = [];
  const sellLevels: { price: number; active: boolean }[] = [];
  for (let i = 1; i <= cfg.gridLevels; i++) {
    const buyP = startPrice * (1 - spacing * i);
    const sellP = startPrice * (1 + spacing * i);
    if (buyP >= cfg.lowerBound) buyLevels.push({ price: buyP, active: true });
    if (sellP <= cfg.upperBound) sellLevels.push({ price: sellP, active: true });
  }

  let inventoryQty = 0; // base asset
  let inventoryCost = 0; // USDT spent (signed)
  let realizedPnl = 0;
  let fills = 0;
  let maxDrawdown = 0;
  let liquidated = false;

  // Margin used ≈ sum of all order notionals / leverage
  const totalOrders = buyLevels.length + sellLevels.length;
  const marginUsed = (cfg.orderSizeUsdt * totalOrders) / cfg.leverage;

  for (const k of klines) {
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);
    const close = parseFloat(k[4]);

    // Bound exit → stop trading
    if (close < cfg.lowerBound * 0.95 || close > cfg.upperBound * 1.05) break;

    // Check buy fills: price dipped to or below an active buy level
    for (const lvl of buyLevels) {
      if (lvl.active && low <= lvl.price) {
        const qty = cfg.orderSizeUsdt / lvl.price;
        inventoryQty += qty;
        inventoryCost += cfg.orderSizeUsdt;
        realizedPnl -= cfg.orderSizeUsdt * FEE_RATE;
        lvl.active = false;
        fills++;
        // Activate paired sell one spacing above
        const pairedSellPrice = lvl.price * (1 + spacing);
        const pairedSell = sellLevels.find(
          (s) => Math.abs(s.price - pairedSellPrice) / pairedSellPrice < 0.001,
        );
        if (pairedSell) pairedSell.active = true;
        else sellLevels.push({ price: pairedSellPrice, active: true });
      }
    }

    // Check sell fills: price rose to or above an active sell level
    for (const lvl of sellLevels) {
      if (lvl.active && high >= lvl.price) {
        const qty = cfg.orderSizeUsdt / lvl.price;
        // Realize round-trip profit if we have inventory
        if (inventoryQty >= qty) {
          const avgCost = inventoryCost / inventoryQty;
          realizedPnl += (lvl.price - avgCost) * qty;
          inventoryQty -= qty;
          inventoryCost -= avgCost * qty;
        } else {
          // Short fill
          inventoryQty -= qty;
          inventoryCost -= cfg.orderSizeUsdt;
        }
        realizedPnl -= cfg.orderSizeUsdt * FEE_RATE;
        lvl.active = false;
        fills++;
        // Activate paired buy one spacing below
        const pairedBuyPrice = lvl.price * (1 - spacing);
        const pairedBuy = buyLevels.find(
          (b) => Math.abs(b.price - pairedBuyPrice) / pairedBuyPrice < 0.001,
        );
        if (pairedBuy) pairedBuy.active = true;
        else buyLevels.push({ price: pairedBuyPrice, active: true });
      }
    }

    // Track drawdown (unrealized + realized)
    const unrealized = inventoryQty * close - inventoryCost;
    const equity = realizedPnl + unrealized;
    if (equity < maxDrawdown) maxDrawdown = equity;

    // Liquidation check
    if (marginUsed > 0 && -equity > marginUsed) {
      liquidated = true;
      realizedPnl = -marginUsed;
      break;
    }
  }

  const endPrice = parseFloat(klines[klines.length - 1][4]);
  const finalInventoryUsdt = inventoryQty * endPrice;
  const netReturnPct = marginUsed > 0 ? (realizedPnl / marginUsed) * 100 : 0;
  // Risk-adjusted score: penalize drawdown 2x
  const score = liquidated ? -1e9 : realizedPnl + 2 * maxDrawdown;

  return {
    fills,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    finalInventoryUsdt: Math.round(finalInventoryUsdt * 100) / 100,
    liquidated,
    endPrice,
    netReturnPct: Math.round(netReturnPct * 100) / 100,
    score: Math.round(score * 100) / 100,
  };
}
