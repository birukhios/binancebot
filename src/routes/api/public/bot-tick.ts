import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { getLocalBotState, listLocalBotUserIds } from "@/lib/bot/local-bot-store.server";
import { runLocalBotTick } from "@/lib/bot/local-runner.server";


async function pauseBot(userId: string, message: string) {
  const { updateLocalBotConfig, addLocalLog } = await import("@/lib/bot/local-bot-store.server");
  updateLocalBotConfig(userId, { is_running: false });
  addLocalLog(userId, "error", `Bot paused: ${message}`);
}


export const Route = createFileRoute("/api/public/bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BOT_TICK_SECRET;
        const provided =
          request.headers.get("x-bot-tick-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          request.headers.get("apikey") ??
          "";

        const matches = (expected?: string) => {
          if (!expected) return false;
          const a = Buffer.from(provided);
          const b = Buffer.from(expected);
          return a.length === b.length && timingSafeEqual(a, b);
        };

        if (!matches(secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let okCount = 0;
        let errCount = 0;

        for (const userId of listLocalBotUserIds()) {
          const state = getLocalBotState(userId);
          if (!state.cfg.is_running) continue;
          try {
            const result = await runLocalBotTick(userId);
            if (!result.ok) throw new Error(result.error ?? "tick failed");
            okCount++;
          } catch (e) {
            await pauseBot(userId, (e as Error).message);
            errCount++;
          }
        }

        return Response.json({ ok: true, processed: okCount, errors: errCount });
      },
      GET: async () => new Response("Method not allowed", { status: 405 }),
    },
  },
});
