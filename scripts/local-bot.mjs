/**
 * Bot tick helper for the Better Auth/local-storage VPS build.
 *
 * Run the web app with `npm run start` (or PM2), sign in, save each user's
 * Binance API keys in Settings, and turn the bot on in the dashboard. This
 * helper can be used by cron/PM2 to call the same local tick endpoint.
 */

const APP_URL = process.env.APP_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8080"}`;
const BOT_TICK_SECRET = process.env.BOT_TICK_SECRET;
const LOOP_INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? "30000");

if (!BOT_TICK_SECRET) {
  console.error("Missing BOT_TICK_SECRET. Set it in the same environment as the web app.");
  process.exit(1);
}

async function tick() {
  const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/public/bot-tick`, {
    method: "POST",
    headers: {
      "x-bot-tick-secret": BOT_TICK_SECRET,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`bot-tick ${res.status}: ${text}`);
  console.log(`[${new Date().toISOString()}] ${text}`);
}

while (true) {
  try {
    await tick();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] tick failed:`, error);
  }
  await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
}
