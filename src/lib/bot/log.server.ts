import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addLocalLog } from "@/lib/bot/local-bot-store.server";

function hasSupabaseAdminEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function botLog(
  userId: string,
  level: "info" | "warn" | "error",
  message: string,
  symbol?: string,
  context?: Record<string, unknown>,
) {
  if (!hasSupabaseAdminEnv()) {
    addLocalLog(userId, level, message, symbol);
    console.log(`[bot:${level}] ${userId.slice(0, 8)} ${symbol ?? "-"} ${message}`);
    return;
  }

  try {
    await supabaseAdmin
      .from("bot_logs")
      .insert({ user_id: userId, level, message, symbol, context: context as any });
  } catch (e) {
    console.error("botLog failed", e);
  }
  console.log(`[bot:${level}] ${userId.slice(0, 8)} ${symbol ?? "-"} ${message}`);
}
