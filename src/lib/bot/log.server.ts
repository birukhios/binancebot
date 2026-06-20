import { addLocalLog } from "@/lib/bot/local-bot-store.server";

const DEDUPE_MS = 2 * 60 * 1000;

function recentLogKeys(): Map<string, number> {
  const g = globalThis as typeof globalThis & { __botRecentLogKeys?: Map<string, number> };
  g.__botRecentLogKeys ??= new Map();
  return g.__botRecentLogKeys;
}

export async function botLog(
  userId: string,
  level: "info" | "warn" | "error",
  message: string,
  symbol?: string,
  context?: Record<string, unknown>,
) {
  void context;
  const key = `${userId}:${symbol ?? "-"}:${level}:${message}`;
  if (level !== "error") {
    const now = Date.now();
    const recent = recentLogKeys();
    const last = recent.get(key) ?? 0;
    if (now - last < DEDUPE_MS) return;
    recent.set(key, now);
    if (recent.size > 1000) {
      for (const [oldKey, ts] of recent.entries()) {
        if (now - ts > DEDUPE_MS) recent.delete(oldKey);
      }
    }
  }
  addLocalLog(userId, level, message, symbol);
  console.log(`[bot:${level}] ${userId.slice(0, 8)} ${symbol ?? "-"} ${message}`);
}
