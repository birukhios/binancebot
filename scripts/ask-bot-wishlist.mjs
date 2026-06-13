// Ask the AI advisor what the bot still needs and what should be removed.
const key = process.env.LOVABLE_API_KEY;
if (!key) { console.error("Missing LOVABLE_API_KEY"); process.exit(1); }

const currentFeatures = [
  "Adaptive grid spacing from ATR + EMA trend + market session",
  "Grid skew/shift based on trend bias",
  "Trend gate (EMA on configurable interval) blocks counter-trend entries",
  "Take-profit and stop-loss per symbol",
  "Auto-eviction of worst position when over max notional exposure",
  "Per-symbol auto-tune (learnFromTrades adjusts spacing/size from recent PnL)",
  "LLM advisor (gemini-3-flash): action=trade/pause/reduce/close_all, bias, spacing/size multipliers, cached 5min",
  "Smart symbol auto-select: ranks 15 USDT-perps by ATR fit + 24h PnL, enables top N",
  "Drawdown circuit-breaker: stops bot if 24h realized+unrealized < -X% of wallet",
  "News-aware pause: blocks new entries ±30min around high-impact ForexFactory events for configured currencies",
  "Per-symbol DB lock to prevent overlapping reconciles",
  "Testnet/mainnet toggle, Binance keys per user, kill switch, close position, cancel symbol orders",
  "Backtest module (binance/backtest.server.ts)",
  "Bot logs with levels, trade history with realized PnL/commission",
  "Manual ranking trigger, auto-configure symbol, optimize symbol",
];

const schema = {
  type: "object",
  properties: {
    add: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          why: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "why", "priority"],
      },
    },
    remove: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "why"],
      },
    },
    summary: { type: "string" },
  },
  required: ["add", "remove", "summary"],
};

const body = {
  model: "google/gemini-3-flash-preview",
  messages: [
    { role: "system", content: "You are a senior quant reviewing a Binance USDT-perp grid trading bot. Be opinionated and concrete. Recommend ONLY what materially improves risk-adjusted returns or operability. Recommend removal of anything redundant, low-signal, fragile, or that creates conflicting decisions." },
    { role: "user", content: `Current bot capabilities:\n- ${currentFeatures.join("\n- ")}\n\nReturn JSON with:\n- add: up to 5 things to ADD (highest leverage first), each with name/why/priority\n- remove: things to REMOVE or simplify (can be empty), each with name/why\n- summary: 2-3 sentence verdict on overall design.` },
  ],
  tools: [{ type: "function", function: { name: "respond", description: "Return structured wishlist", parameters: schema } }],
  tool_choice: { type: "function", function: { name: "respond" } },
};

const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
  body: JSON.stringify(body),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const data = await res.json();
const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
const parsed = JSON.parse(args);
console.log(JSON.stringify(parsed, null, 2));
