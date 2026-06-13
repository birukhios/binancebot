## Goal
Turn the bot from a fixed grid placer into a self-managing system that reasons about market context each tick, tunes itself from results, picks which symbols to trade, and protects capital automatically.

## 1. LLM-driven decisions (per tick, per symbol)
- New `src/lib/bot/advisor.server.ts` using Lovable AI (`google/gemini-3-flash-preview` via `createLovableAiGatewayProvider`) with `generateText` + `Output.object` returning structured JSON:
  - `action`: `"trade" | "pause" | "reduce" | "close_all"`
  - `bias`: `"long_only" | "short_only" | "both" | "flat"`
  - `spacing_mult`, `size_mult` (0.5–1.5)
  - `confidence` (0–1)
  - `reason` (short string for the log)
- Input context per call: symbol, mark, EMA bias, ATR%, session, recent 20 trades P&L summary, current position, total exposure vs cap, lower/upper bounds.
- Called from `reconcileSymbolLocked` once per symbol per tick. Result cached in memory for 5 min per symbol to bound cost. Result feeds the adaptive grid (spacing/size/skew) and the trend-gate decision.
- Cost guard: skip the LLM call if `advisor_enabled = false` on `bot_config`, or if last call < 5 min ago, or if no creds for Lovable AI.

## 2. Auto-tune parameters from results (deeper)
Extend `learn.server.ts`:
- Look at last 100 fills + open position duration, not just 50.
- Tune `grid_levels` (3–8) in addition to spacing and size, based on fill-rate per level.
- Penalize symbols with high drawdown (>5% of allocated notional) by shrinking size more aggressively.
- Reward symbols whose realized P&L per hour is in top quartile across the user's enabled symbols by widening size.
- Cooldown stays 1h; force-run option preserved.

## 3. Smart symbol selection
- New server function `rankSymbols` and a per-tick step in `bot-tick.ts`:
  - Pull 24h ticker stats for a fixed universe (top USDT-perp by volume, e.g. 15 symbols).
  - Score = volatility-fit (ATR% in a sweet-spot band) × volume × recent realized P&L per hour (if any).
  - Auto-enable top N (configurable, default 4) and auto-disable the bottom (only those the user originally toggled via `auto_select`). Manual enables remain sticky.
- New `bot_config.auto_select_enabled` boolean + `auto_select_max_symbols` int.
- New `symbol_config.auto_managed` boolean so user manual picks are never overridden.

## 4. Risk-aware position management
In `grid.server.ts` and `bot-tick.ts`:
- **Drawdown circuit-breaker**: if 24h realized + unrealized < `-drawdown_pause_pct` of wallet (default 3%), pause bot, log, send no further orders.
- **Adverse-trend exit**: if a position is >1 ATR underwater AND EMA bias is strongly against it AND advisor says `close_all` or `reduce`, market-close it (respects existing `closePosition` flow).
- **Dynamic exposure cap**: shrink `max_total_notional_usdt` effectively by 30% when daily P&L is negative; restore when flat or positive.
- **Scale-in on confirmed reversal**: when advisor returns `bias` flip with `confidence > 0.7` and we have a small adverse position, add one extra grid level on the favorable side at 0.5× size.

## 5. DB migration (single migration)
- `bot_config`: add `advisor_enabled bool default true`, `auto_select_enabled bool default false`, `auto_select_max_symbols int default 4`, `drawdown_pause_pct numeric default 3.0`.
- `symbol_config`: add `auto_managed bool default false`, `last_advisor_at timestamptz`, `last_advisor_note text`.
- New `bot_advisor_calls` table (`user_id, symbol, decision jsonb, created_at`) for audit + UI debugging; RLS + GRANTs per project rules.

## 6. UI (`src/routes/index.tsx`)
- New "Intelligence" card with toggles for advisor, auto-select (with max symbols slider), drawdown pause %.
- Per-symbol row: small badge showing latest advisor decision + reason on hover.
- Logs panel already exists — advisor decisions are written via `botLog` with `level=info`.

## Files touched
- New: `src/lib/bot/advisor.server.ts`, `src/lib/bot/ranking.server.ts`, `src/lib/ai-gateway.server.ts` (if not already present), migration file.
- Edited: `src/lib/bot/learn.server.ts`, `src/lib/binance/grid.server.ts`, `src/lib/bot/bot.functions.ts`, `src/routes/api/public/bot-tick.ts`, `src/routes/index.tsx`, `scripts/local-bot.mjs` (mirror the new tick steps).

## Out of scope
- News / Twitter sentiment ingestion.
- Cross-symbol portfolio optimization (mean-variance, etc.).
- Backtesting UI for the new advisor (the existing `backtest.server.ts` stays as-is).

## Notes on cost
LLM call is ~1 request per enabled symbol per 5 min. With 4 symbols that's ~48 requests/hour from Lovable AI credits. Toggle off via the new `advisor_enabled` switch if cost is a concern.

Confirm and I'll run the migration and wire everything up.