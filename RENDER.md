# Render Deployment

This app needs a Render Web Service, not GitHub Pages, because it uses server-side auth, server functions, and Binance API calls.

## Settings

- Repository: `birukhios/binancebot`
- Build command: `npm ci && npm run render:build`
- Start command: `npm run start`
- Health check path: `/healthz`
- Runtime: Node

If the deploy log says `Missing dist/server/server.js`, Render started the service without
running the build command above, or it deployed an older commit/service configuration. Update
the service settings, clear the build cache, and redeploy the latest `main` commit.

## Required Environment Variables

Set these in Render after creating the service:

```env
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=2048
BETTER_AUTH_URL=https://YOUR-RENDER-SERVICE.onrender.com
BETTER_AUTH_SECRET=<generate a long random secret>
BETTER_AUTH_DB_PATH=/tmp/auth.sqlite
LOCAL_BOT_STORE_PATH=/tmp/local-bot-store.json
LOCAL_BINANCE_CREDS_PATH=/tmp/binance-creds.json
BINANCE_TESTNET=true
BOT_TICK_SECRET=<generate a long random secret>
```

Optional Binance/proxy variables:

```env
BINANCE_PROXY_URL=
BINANCE_TESTNET_API_KEY=
BINANCE_TESTNET_API_SECRET=
BINANCE_API_KEY=
BINANCE_API_SECRET=
```

## Notes

- Keep live trading off until testnet works on Render.
- If Binance rejects Render's IP, check the app Settings page for the server public IP and update the Binance API key allow-list.
- Free Render services may sleep when idle.
- Free Render services have an ephemeral filesystem, so Better Auth users, bot settings, and saved API keys can reset after redeploys/restarts. For production, use a persistent disk or a VPS with persistent storage.
