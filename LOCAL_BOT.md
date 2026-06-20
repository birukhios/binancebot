# Running the Bot on a VPS

This build stores login users with Better Auth and stores each user's Binance API keys from the web Settings screen. No external database is required.

## VPS Setup

1. Install Node.js 22.

```bash
node --version
npm --version
```

2. Install and build the app.

```bash
npm ci
npm run render:build
```

3. Create a production env file.

```env
NODE_ENV=production
PORT=8080
BETTER_AUTH_URL=http://YOUR_VPS_IP:8080
BETTER_AUTH_SECRET=<generate-a-long-random-secret>
BETTER_AUTH_DB_PATH=/var/lib/kelay-bot/auth.sqlite
LOCAL_BOT_STORE_PATH=/var/lib/kelay-bot/local-bot-store.json
LOCAL_BINANCE_CREDS_PATH=/var/lib/kelay-bot/binance-creds.json
BINANCE_TESTNET=true
BOT_TICK_SECRET=<generate-a-long-random-secret>
```

4. Start the web app.

```bash
npm run start
```

5. Open the dashboard, create/sign in to a user, save that user's Binance API key and secret in Settings, then turn the bot on.

## 24/7 With PM2

```bash
npm install -g pm2
pm2 start "npm run start" --name kelay-web
pm2 save
pm2 startup
```

The app has an in-process runner that ticks enabled users while the web app is running. `npm run bot` is only a helper for external cron/PM2 setups that call `/api/public/bot-tick`.

## Notes

- Start on Binance Futures testnet.
- Whitelist the VPS public IP in Binance before using mainnet keys.
- Do not enable withdrawal permissions on Binance API keys.
- Keep `/var/lib/kelay-bot` persistent and backed up; it contains users, bot settings, and encrypted/session data.
