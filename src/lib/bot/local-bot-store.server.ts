import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function defaultBotStorePath() {
  if (
    process.env.VERCEL ||
    process.env.VERCEL_URL ||
    process.env.NOW_REGION ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  ) {
    return "/tmp/local-bot-store.json";
  }

  return "./data/local-bot-store.json";
}

const requestedPath = process.env.LOCAL_BOT_STORE_PATH ?? defaultBotStorePath();
const filePath = requestedPath.startsWith("/") ? requestedPath : resolve(requestedPath);

type LocalUserStore = {
  cfg: Record<string, any>;
  symbols: Array<Record<string, any>>;
  logs: Array<Record<string, any>>;
};

type LocalBotStore = Record<string, LocalUserStore>;

const now = () => new Date().toISOString();

function defaultSymbol(symbol: string, enabled = symbol === "BTCUSDT") {
  return {
    id: symbol,
    symbol,
    enabled,
    grid_levels: 1,
    grid_spacing_pct: symbol === "BTCUSDT" ? 0.45 : 0.6,
    order_size_usdt: 75,
    leverage: 3,
    upper_bound: null,
    lower_bound: null,
    auto_tune: false,
    min_order_size_usdt: 50,
    max_order_size_usdt: 150,
    min_spacing_pct: 0.2,
    max_spacing_pct: 3,
    stop_loss_roi_pct: -50,
    max_position_age_minutes: 0,
    trend_filter_enabled: true,
    trend_ema_period: 50,
    trend_interval: "1h",
    extreme_loss_threshold_usdt: -10,
    extreme_loss_cooldown_min: 60,
    funding_filter_enabled: false,
    funding_max_abs_bps: 10,
    z_filter_enabled: false,
    z_lookback: 20,
    z_interval: "1h",
    z_entry_threshold: 1.5,
    updated_at: now(),
  };
}

function defaultUserStore(): LocalUserStore {
  return {
    cfg: {
      testnet: true,
      is_running: false,
      max_total_notional_usdt: 1500,
      auto_select_enabled: false,
      auto_select_max_symbols: 4,
      drawdown_pause_pct: 3,
      news_pause_enabled: true,
      news_pause_window_min: 30,
      news_currencies: "USD",
      updated_at: now(),
    },
    symbols: [defaultSymbol("BTCUSDT", true), defaultSymbol("ETHUSDT", false), defaultSymbol("SOLUSDT", false)],
    logs: [],
  };
}

function readStore(): LocalBotStore {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as LocalBotStore;
  } catch {
    return {};
  }
}

function writeStore(store: LocalBotStore) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function withUser(userId: string) {
  const store = readStore();
  if (!store[userId]) {
    store[userId] = defaultUserStore();
  }
  normalizeUserStore(store[userId]!);
  writeStore(store);
  return { store, user: store[userId]! };
}

function normalizeUserStore(user: LocalUserStore) {
  user.cfg.max_total_notional_usdt = Math.max(1500, Number(user.cfg.max_total_notional_usdt ?? 0));
  for (const symbol of user.symbols) {
    symbol.grid_levels = 1;
    symbol.order_size_usdt = Math.max(75, Number(symbol.order_size_usdt ?? 0));
    symbol.min_order_size_usdt = Math.max(50, Number(symbol.min_order_size_usdt ?? 0));
    symbol.max_order_size_usdt = Math.max(150, Number(symbol.max_order_size_usdt ?? 0));
  }
  if (!user.symbols.some((symbol) => symbol.enabled) && user.symbols[0]) user.symbols[0].enabled = true;
}

export function getLocalBotState(userId: string) {
  return withUser(userId).user;
}

export function listLocalBotUserIds() {
  return Object.keys(readStore());
}

export function updateLocalBotConfig(userId: string, patch: Record<string, any>) {
  const { store, user } = withUser(userId);
  user.cfg = { ...user.cfg, ...patch, updated_at: now() };
  writeStore(store);
  return user.cfg;
}

export function updateLocalSymbol(userId: string, symbol: string, patch: Record<string, any>) {
  const { store, user } = withUser(userId);
  const idx = user.symbols.findIndex((s) => s.symbol === symbol);
  const next = {
    ...(idx >= 0 ? user.symbols[idx] : defaultSymbol(symbol, false)),
    ...patch,
    symbol,
    grid_levels: 1,
    updated_at: now(),
  };
  if (idx >= 0) user.symbols[idx] = next;
  else user.symbols.push(next);
  user.symbols.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  normalizeUserStore(user);
  writeStore(store);
  return next;
}

export function addLocalLog(userId: string, level: "info" | "warn" | "error", message: string, symbol?: string) {
  const { store, user } = withUser(userId);
  user.logs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    level,
    message,
    symbol: symbol ?? null,
    created_at: now(),
  });
  user.logs = user.logs.slice(0, 200);
  writeStore(store);
}
