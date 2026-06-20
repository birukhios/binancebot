// AI advisor: per-symbol, per-tick decision using Lovable AI.
// Returns a structured plan that the grid layer uses to size/skew/pause.
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { botLog } from "@/lib/bot/log.server";

const DecisionSchema = z.object({
  action: z.enum(["trade", "pause", "reduce", "close_all"]),
  bias: z.enum(["long_only", "short_only", "both", "flat"]),
  spacing_mult: z.number().min(0.5).max(1.5),
  size_mult: z.number().min(0.5).max(1.5),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(280),
});

export type AdvisorDecision = z.infer<typeof DecisionSchema>;

export interface AdvisorContext {
  symbol: string;
  mark: number;
  trendBias: "up" | "down" | "flat" | null;
  atrPct: number | null;
  sessionName: string;
  positionAmt: number;
  positionUpnl: number;
  positionRoiPct: number;
  exposureUsdt: number;
  exposureCapUsdt: number;
  lowerBound: number | null;
  upperBound: number | null;
  recentTrades: Array<{ side: string; pnl: number; ts: string }>;
}

// In-memory cache: skip the LLM if we asked < CACHE_MS ago.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; decision: AdvisorDecision }>();

function cacheKey(userId: string, symbol: string) {
  return `${userId}:${symbol}`;
}

export function getCachedAdvisor(userId: string, symbol: string): AdvisorDecision | null {
  const hit = cache.get(cacheKey(userId, symbol));
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) return null;
  return hit.decision;
}

const NEUTRAL: AdvisorDecision = {
  action: "trade",
  bias: "both",
  spacing_mult: 1,
  size_mult: 1,
  confidence: 0,
  reason: "advisor disabled or unavailable",
};

export async function getAdvisorDecision(
  userId: string,
  ctx: AdvisorContext,
): Promise<AdvisorDecision> {
  const cached = getCachedAdvisor(userId, ctx.symbol);
  if (cached) return cached;

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return NEUTRAL;

  const recentSummary = ctx.recentTrades
    .slice(0, 20)
    .map((t) => `${t.side} ${t.pnl.toFixed(4)}`)
    .join(", ") || "none";

  const prompt = `You are a quantitative trading risk advisor for a USDT-perp grid bot on Binance Futures.

Symbol: ${ctx.symbol}
Mark price: ${ctx.mark}
EMA trend bias (1h): ${ctx.trendBias ?? "unknown"}
ATR% (1h, 14): ${ctx.atrPct?.toFixed(3) ?? "unknown"}
Market session: ${ctx.sessionName}
Open position: ${ctx.positionAmt} (uPnL ${ctx.positionUpnl.toFixed(4)} USDT, ROI ${ctx.positionRoiPct.toFixed(2)}%)
Total exposure: ${ctx.exposureUsdt.toFixed(2)} / ${ctx.exposureCapUsdt} USDT
Grid range: ${ctx.lowerBound ?? "-"} to ${ctx.upperBound ?? "-"}
Recent 20 fills realized P&L: ${recentSummary}

Decide:
- action: "trade" (place normal grid), "pause" (no new entries), "reduce" (shrink size), "close_all" (close position + cancel)
- bias: which side of the grid to keep ("long_only", "short_only", "both", "flat")
- spacing_mult: 0.5..1.5 (tighter in chop, wider in volatility)
- size_mult: 0.5..1.5 (smaller after losses, larger when winning)
- confidence: 0..1
- reason: short, plain-English explanation

Be conservative in strong adverse trends and after losing streaks.`;

  try {
    const gateway = createLovableAiGatewayProvider(apiKey);
    const { experimental_output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      experimental_output: Output.object({ schema: DecisionSchema }),
      prompt,
    });
    const decision = experimental_output as AdvisorDecision;
    cache.set(cacheKey(userId, ctx.symbol), { at: Date.now(), decision });

    await botLog(
      userId,
      "info",
      `Advisor: ${decision.action}/${decision.bias} space×${decision.spacing_mult} size×${decision.size_mult} conf=${decision.confidence.toFixed(2)} — ${decision.reason}`,
      ctx.symbol,
    );
    return decision;
  } catch (e) {
    await botLog(userId, "warn", `advisor: ${(e as Error).message.slice(0, 160)}`, ctx.symbol);
    return NEUTRAL;
  }
}
