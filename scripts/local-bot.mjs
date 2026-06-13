/**
 * Local Binance Futures grid bot runner (Node.js).
 *
 * Runs on YOUR machine so Binance sees YOUR home IP — which you can
 * whitelist on the API key (required for Futures on mainnet).
 *
 * Usage:
 *   1. cp .env.local.example .env.local
 *   2. fill in BINANCE_API_KEY / BINANCE_API_SECRET / SUPABASE_SERVICE_ROLE_KEY
 *   3. npm install
 *   4. npm run bot       (or: node --env-file=.env.local scripts/local-bot.mjs)
 *
 * Requires Node.js 20.6+ (for built-in --env-file and global fetch).
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const {
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_TESTNET = "false",
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  USER_ID,
  LOOP_INTERVAL_MS = "60000",
} = process.env;

if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
  console.error("Missing BINANCE_API_KEY / BINANCE_API_SECRET in .env.local");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!USER_ID) {
  console.error("Missing USER_ID in .env.local (the auth user whose bot config/trades this runner owns)");
  process.exit(1);
}


const TESTNET = BINANCE_TESTNET === "true";
const BASE = TESTNET ? "https://testnet.binancefuture.com" : "https://fapi.binance.com";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- binance client ----------
function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}
async function pub(path, params = {}) {
  const url = `${BASE}${path}${Object.keys(params).length ? "?" + qs(params) : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}
async function signed(method, path, params = {}) {
  const full = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const query = qs(full);
  const sig = createHmac("sha256", BINANCE_API_SECRET).update(query).digest("hex");
  const url = `${BASE}${path}?${query}&signature=${sig}`;
  const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": BINANCE_API_KEY } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return JSON.parse(text);
}

const bx = {
  ping: () => pub("/fapi/v1/ping"),
  exchangeInfo: () => pub("/fapi/v1/exchangeInfo"),
  markPrice: (s) => pub("/fapi/v1/premiumIndex", { symbol: s }),
  account: () => signed("GET", "/fapi/v2/account"),
  openOrders: (s) => signed("GET", "/fapi/v1/openOrders", { symbol: s }),
  userTrades: (s, fromId) =>
    signed("GET", "/fapi/v1/userTrades", { symbol: s, fromId, limit: 100 }),
  setLeverage: (s, lev) => signed("POST", "/fapi/v1/leverage", { symbol: s, leverage: lev }),
  setMarginType: (s, t) =>
    signed("POST", "/fapi/v1/marginType", { symbol: s, marginType: t }).catch(() => null),
  placeOrder: (p) =>
    signed("POST", "/fapi/v1/order", {
      ...p,
      timeInForce: p.type === "LIMIT" ? (p.timeInForce ?? "GTC") : undefined,
    }),
  cancelOrder: (s, id) => signed("DELETE", "/fapi/v1/order", { symbol: s, orderId: id }),
};

// ---------- symbol filters ----------
const filtersCache = new Map();
async function getFilters(symbol) {
  if (filtersCache.has(symbol)) return filtersCache.get(symbol);
  const info = await bx.exchangeInfo();
  const s = info.symbols.find((x) => x.symbol === symbol);
  if (!s) throw new Error(`Symbol ${symbol} not found`);
  const lot = s.filters.find((f) => f.filterType === "LOT_SIZE");
  const tick = s.filters.find((f) => f.filterType === "PRICE_FILTER");
  const f = {
    stepSize: parseFloat(lot.stepSize),
    minQty: parseFloat(lot.minQty),
    tickSize: parseFloat(tick.tickSize),
    pricePrecision: s.pricePrecision,
    quantityPrecision: s.quantityPrecision,
  };
  filtersCache.set(symbol, f);
  return f;
}
function roundStep(v, step, precision) {
  return parseFloat((Math.floor(v / step) * step).toFixed(precision));
}

// ---------- logging ----------
async function log(level, message, symbol) {
  console.log(`[${new Date().toISOString()}] [${level}] ${symbol ?? "-"} ${message}`);
  try {
    await sb.from("bot_logs").insert({ level, message, symbol, user_id: USER_ID });
  } catch (e) {
    console.error("log insert failed", e);
  }
}

// ---------- reconcile ----------
async function syncFills(symbol) {
  const { data: last } = await sb
    .from("trades")
    .select("binance_trade_id")
    .eq("user_id", USER_ID)
    .eq("symbol", symbol)
    .order("binance_trade_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromId = last?.binance_trade_id ? Number(last.binance_trade_id) + 1 : undefined;
  const fills = await bx.userTrades(symbol, fromId);
  for (const t of fills) {
    await sb.from("trades").upsert(
      {
        user_id: USER_ID,
        symbol,
        side: t.side,
        price: Number(t.price),
        qty: Number(t.qty),
        realized_pnl: Number(t.realizedPnl ?? 0),
        commission: Number(t.commission ?? 0),
        binance_order_id: t.orderId,
        binance_trade_id: t.id,
        filled_at: new Date(t.time).toISOString(),
      },
      { onConflict: "binance_trade_id" },
    );
  }
  return fills.length;
}


async function reconcile(cfg) {
  await syncFills(cfg.symbol);

  const mp = await bx.markPrice(cfg.symbol);
  const mark = parseFloat(mp.markPrice);

  if (cfg.lower_bound && mark < cfg.lower_bound) {
    await log("warn", `Price ${mark} below lower_bound ${cfg.lower_bound}`, cfg.symbol);
    return;
  }
  if (cfg.upper_bound && mark > cfg.upper_bound) {
    await log("warn", `Price ${mark} above upper_bound ${cfg.upper_bound}`, cfg.symbol);
    return;
  }

  try {
    await bx.setMarginType(cfg.symbol, "ISOLATED");
    await bx.setLeverage(cfg.symbol, cfg.leverage);
  } catch (e) {
    await log("warn", `setLeverage: ${e.message}`, cfg.symbol);
  }

  const f = await getFilters(cfg.symbol);
  const qty = roundStep(cfg.order_size_usdt / mark, f.stepSize, f.quantityPrecision);
  if (qty < f.minQty) {
    await log("warn", `qty ${qty} < minQty ${f.minQty} – raise order_size_usdt`, cfg.symbol);
    return;
  }

  const desired = [];
  for (let i = 1; i <= cfg.grid_levels; i++) {
    const spacing = (cfg.grid_spacing_pct / 100) * i;
    desired.push({
      side: "BUY",
      price: roundStep(mark * (1 - spacing), f.tickSize, f.pricePrecision),
      level: -i,
    });
    desired.push({
      side: "SELL",
      price: roundStep(mark * (1 + spacing), f.tickSize, f.pricePrecision),
      level: i,
    });
  }

  const open = await bx.openOrders(cfg.symbol);
  const liveByCid = new Map();
  for (const o of open) {
    if (o.clientOrderId?.startsWith(`grid_${cfg.symbol}_`)) liveByCid.set(o.clientOrderId, o);
  }
  const desiredCids = new Set(desired.map((d) => `grid_${cfg.symbol}_${d.level}`));

  for (const [cid, o] of liveByCid) {
    if (!desiredCids.has(cid)) {
      try {
        await bx.cancelOrder(cfg.symbol, o.orderId);
        await sb
          .from("grid_orders")
          .update({ status: "CANCELED" })
          .eq("binance_order_id", o.orderId);
      } catch (e) {
        await log("warn", `cancel ${o.orderId}: ${e.message}`, cfg.symbol);
      }
    }
  }

  for (const d of desired) {
    const cid = `grid_${cfg.symbol}_${d.level}`;
    if (liveByCid.has(cid)) continue;
    try {
      const placed = await bx.placeOrder({
        symbol: cfg.symbol,
        side: d.side,
        type: "LIMIT",
        quantity: qty,
        price: d.price,
        newClientOrderId: cid,
      });
      await sb.from("grid_orders").insert({
        user_id: USER_ID,
        symbol: cfg.symbol,
        side: d.side,
        price: d.price,
        qty,
        binance_order_id: placed.orderId,
        client_order_id: cid,
        status: placed.status,
        level_index: d.level,
      });

    } catch (e) {
      const msg = e.message;
      if (!msg.includes("immediately match") && !msg.includes("-2010")) {
        await log("warn", `place ${d.side}@${d.price}: ${msg}`, cfg.symbol);
      }
    }
  }
}

// ---------- main loop ----------
async function tick() {
  const { data: cfg } = await sb.from("bot_config").select("*").eq("user_id", USER_ID).maybeSingle();
  if (!cfg?.is_running) {
    console.log(`[${new Date().toISOString()}] bot paused (toggle in UI to start)`);
    return;
  }
  const { data: symbols } = await sb
    .from("symbol_config")
    .select("*")
    .eq("user_id", USER_ID)
    .eq("enabled", true);

  for (const s of symbols ?? []) {
    try {
      await reconcile(s);
    } catch (e) {
      await log("error", `reconcile: ${e.message}`, s.symbol);
    }
  }
}

async function main() {
  console.log(
    `Local bot starting — ${TESTNET ? "TESTNET" : "MAINNET"} — your IP visible to Binance`,
  );
  try {
    await bx.ping();
    const acct = await bx.account();
    console.log(`Connected. Wallet balance: ${acct.totalWalletBalance} USDT`);
  } catch (e) {
    console.error("Binance connection failed:", e.message);
    console.error("Check API key, secret, and IP whitelist.");
    process.exit(1);
  }

  const interval = Number(LOOP_INTERVAL_MS);
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("tick failed:", e);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

main();
