// Smart symbol selection: score a universe of USDT-perps and auto-enable
// the top N for symbols flagged auto_managed. Manual picks are sticky.
import { getCredsForUser } from "@/lib/binance/client.server";
import { getAtrPct } from "@/lib/binance/grid.server";
import { botLog } from "@/lib/bot/log.server";
import { getLocalBotState, updateLocalSymbol } from "@/lib/bot/local-bot-store.server";

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
  score: number;
}

export async function rankAndApplyAutoSelect(userId: string, maxSymbols: number) {
  const state = getLocalBotState(userId);
  const testnet = Boolean(state.cfg.testnet ?? true);
  const creds = await getCredsForUser(userId, testnet);

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
        scores.push({ symbol, atrPct, score: atrFit });
      } catch {
        scores.push({ symbol, atrPct: null, score: 0 });
      }
    }),
  );

  scores.sort((a, b) => b.score - a.score);
  const winners = new Set(scores.slice(0, maxSymbols).map((s) => s.symbol));

  for (const s of scores.slice(0, maxSymbols)) {
    updateLocalSymbol(userId, s.symbol, {
        enabled: true,
        grid_levels: 5,
        grid_spacing_pct: 0.5,
        order_size_usdt: 75,
        leverage: 5,
      });
  }

  for (const symbol of UNIVERSE) {
    if (!winners.has(symbol)) updateLocalSymbol(userId, symbol, { enabled: false });
  }

  await botLog(
    userId,
    "info",
    `Auto-select: kept ${[...winners].join(", ")} (top ${maxSymbols} by ATR-fit)`,
  );

  return scores.slice(0, maxSymbols);
}
