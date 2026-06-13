# Running the bot locally

The bot ships in two halves:

- **Web dashboard** (this repo, deployed on Lovable Cloud) — configure symbols, view trades, kill-switch.
- **Local runner** (`scripts/local-bot.mjs`) — runs on your machine with Node.js, talks to Binance from your home IP, writes results back to the same database the dashboard reads.

This setup is required because Binance Futures requires API keys to be IP-whitelisted, and serverless platforms don't have fixed IPs.

## Setup

1. **Install [Node.js 20.6+](https://nodejs.org)** (one-time). Check with:
   ```bash
   node --version
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create your local env file**:
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in:
   - `BINANCE_API_KEY` / `BINANCE_API_SECRET` — Binance Futures key with **your home IP whitelisted** (check at https://whatismyipaddress.com)
   - `SUPABASE_SERVICE_ROLE_KEY` — from Lovable → Backend → Project Settings → API (keep secret!)
   - `BINANCE_TESTNET=false` for mainnet, `true` for testnet

4. **Start the bot**:
   ```bash
   npm run bot
   ```
   or directly:
   ```bash
   node --env-file=.env.local scripts/local-bot.mjs
   ```

It loops every 60 seconds, picks up enabled symbols and config changes from the dashboard, and stops when you flip the "Bot Running" toggle off in the web UI (or Ctrl+C).

## Notes

- **The bot only runs while this Node process is up.** If your laptop sleeps, the bot pauses.
  For 24/7 operation, run it on a cheap VPS ($5/mo DigitalOcean droplet, Raspberry Pi, etc.)
  and whitelist that server's IP on Binance instead.
- The dashboard's pg_cron trigger is harmless when no cloud-side keys are set — it just no-ops.
- All trading actions still respect the kill-switch and bounds you set in the UI.
