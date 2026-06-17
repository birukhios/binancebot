import { binance, getCredsForUser } from "@/lib/binance/client.server";
import { reconcileSymbol } from "@/lib/binance/grid.server";
import { addLocalLog, getLocalBotState, listLocalBotUserIds, updateLocalBotConfig, updateLocalSymbol } from "@/lib/bot/local-bot-store.server";

const LOOP_MS = Number(process.env.LOCAL_BOT_LOOP_MS ?? 30_000);

type RunnerRegistry = Record<string, { timer: ReturnType<typeof setInterval>; running: boolean }>;

function registry(): RunnerRegistry {
  const g = globalThis as typeof globalThis & { __localBotRunners?: RunnerRegistry };
  g.__localBotRunners ??= {};
  return g.__localBotRunners;
}

export async function runLocalBotTick(userId: string) {
  let state = getLocalBotState(userId);
  if (!state.cfg.is_running) return { ok: true, skipped: "stopped" };
  if (state.cfg.testnet !== true) {
    updateLocalBotConfig(userId, { is_running: false });
    addLocalLog(userId, "error", "Local shared runner only supports Binance Futures TESTNET. Bot stopped.");
    return { ok: false, error: "mainnet blocked" };
  }

  const enabled = state.symbols.filter((s) => s.enabled);
  const creds = await getCredsForUser(userId, true);
  const openPositions = await binance.positionRisk(creds).catch(() => [] as any[]);
  const openPositionSymbols = new Set(
    openPositions
      .filter((p: any) => Number(p.positionAmt) !== 0)
      .map((p: any) => String(p.symbol)),
  );
  for (const symbol of openPositionSymbols) {
    if (!state.symbols.some((s) => s.symbol === symbol)) {
      updateLocalSymbol(userId, symbol, { enabled: false });
      addLocalLog(
        userId,
        "info",
        "Discovered an existing open position on Binance and added it to local management so the bot can attach exits.",
        symbol,
      );
    }
  }
  state = getLocalBotState(userId);
  const managed = state.symbols.filter((s) => s.enabled || openPositionSymbols.has(s.symbol));

  if (managed.length === 0) {
    addLocalLog(userId, "warn", "No enabled symbols or open positions to manage.");
    return { ok: true, processed: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const symbolCfg of state.symbols.filter((s) => !managed.some((m) => m.symbol === s.symbol))) {
    try {
      const open = await binance.openOrders(creds, symbolCfg.symbol).catch(() => [] as any[]);
      const gridOrders = open.filter((o: any) => String(o.clientOrderId ?? "").startsWith(`grid_${symbolCfg.symbol}_`));
      if (gridOrders.length > 0) {
        await binance.cancelAllOrders(creds, symbolCfg.symbol);
        addLocalLog(userId, "info", `Canceled ${gridOrders.length} stale grid order(s) on inactive symbol`, symbolCfg.symbol);
      }
    } catch (error) {
      addLocalLog(userId, "warn", `Inactive-symbol cleanup failed: ${(error as Error).message}`, symbolCfg.symbol);
    }
  }

  for (const symbolCfg of managed) {
    try {
      if (!symbolCfg.enabled && openPositionSymbols.has(symbolCfg.symbol)) {
        addLocalLog(
          userId,
          "info",
          "Managing close strategy for an open position on a symbol that is not currently enabled.",
          symbolCfg.symbol,
        );
      }
      const open = await binance.openOrders(creds, symbolCfg.symbol).catch(() => [] as any[]);
      const gridOrders = open.filter((o: any) => String(o.clientOrderId ?? "").startsWith(`grid_${symbolCfg.symbol}_`));
      if (gridOrders.length > 1) {
        await binance.cancelAllOrders(creds, symbolCfg.symbol);
        addLocalLog(userId, "info", `Canceled ${gridOrders.length} extra grid order(s) before creating one-order grid`, symbolCfg.symbol);
      }
      await reconcileSymbol({
        ...symbolCfg,
        grid_levels: 1,
        single_grid_order: true,
        user_id: userId,
      } as any);
      processed++;
    } catch (error) {
      errors++;
      addLocalLog(userId, "error", (error as Error).message, symbolCfg.symbol);
    }
  }

  return { ok: errors === 0, processed, errors };
}

export function ensureLocalBotRunner(userId: string) {
  const runners = registry();
  if (runners[userId]) return;

  const tickSoon = () => {
    const entry = runners[userId];
    if (!entry || entry.running) return;
    entry.running = true;
    runLocalBotTick(userId)
      .catch((error) => addLocalLog(userId, "error", `Local runner tick failed: ${(error as Error).message}`))
      .finally(() => {
        const current = runners[userId];
        if (current) current.running = false;
      });
  };

  runners[userId] = {
    running: false,
    timer: setInterval(() => {
      tickSoon();
    }, LOOP_MS),
  };

  setTimeout(tickSoon, 250);
}

export function stopLocalBotRunner(userId: string) {
  const runners = registry();
  const entry = runners[userId];
  if (!entry) return;
  clearInterval(entry.timer);
  delete runners[userId];
}

export function bootstrapLocalBotRunners() {
  for (const userId of listLocalBotUserIds()) {
    const state = getLocalBotState(userId);
    if (state.cfg.is_running && state.cfg.testnet === true) {
      ensureLocalBotRunner(userId);
    }
  }
}

setTimeout(() => {
  bootstrapLocalBotRunners();
}, 500);
