import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const provider = createOpenAICompatible({
  name: "lovable",
  baseURL: "https://ai.gateway.lovable.dev/v1",
  headers: {
    "Lovable-API-Key": process.env.LOVABLE_API_KEY,
    "X-Lovable-AIG-SDK": "vercel-ai-sdk",
  },
});

const ChoiceSchema = z.object({
  choice: z.enum([
    "profit_factor_metrics",
    "news_aware_pause",
    "trend_strength_guard",
    "position_sizing_guardrails",
    "multi_timeframe_confirmation"
  ]),
  priority: z.number().min(1).max(5),
  reason: z.string(),
  implementation_hint: z.string(),
});

const prompt = `You are the AI advisor for a Binance Futures grid trading bot. We just read an article on grid trading best practices (Axiory). The article emphasizes:

- Grid spacing must adapt to volatility (already implemented)
- Trends are the #1 enemy of grid strategies
- Profit factor should be >= 1.5 and max drawdown < 20%
- News/strong trends can blow up accounts
- Small % of capital per trade; enough margin for multiple positions
- Backtesting is critical
- Range/sideways markets are ideal; trending markets are dangerous

The bot already has: adaptive grid spacing, EMA trend bias, LLM per-symbol advisor, drawdown circuit-breaker, auto-tune from results, smart symbol selection, and exposure caps.

Which SINGLE feature should we add next to make the bot safer and more profitable? Options:

1. profit_factor_metrics — Add profit-factor >= 1.5 and max-drawdown < 20% metrics to the results / backtest panel so the user can see if the grid is viable before running live.

2. news_aware_pause — Integrate an economic-calendar feed to auto-pause the bot during high-impact news events (NFP, CPI, FOMC) when the article says grids get destroyed.

3. trend_strength_guard — Add a stronger trend-strength metric (e.g., ADX or slope-of-EMA) so that when trend strength is high, the grid is drastically reduced or paused entirely.

4. position_sizing_guardrails — Enforce a hard max % of total wallet per symbol AND per individual grid level, so no single level or symbol can blow up the account.

5. multi_timeframe_confirmation — Require trend agreement across 15m, 1h, and 4h timeframes before placing grids, reducing false-flat signals.

Pick ONE. Give priority 1-5, a short reason, and a one-line implementation hint.`;

const { experimental_output } = await generateText({
  model: provider("google/gemini-3-flash-preview"),
  experimental_output: Output.object({ schema: ChoiceSchema }),
  prompt,
});

console.log(JSON.stringify(experimental_output, null, 2));
