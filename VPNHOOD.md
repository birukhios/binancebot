# VpnHood Route for Binance

Binance can be blocked by some local providers. This app supports routing all Binance REST requests through a VPN/proxy route with `BINANCE_PROXY_URL`.

## VpnHood

VpnHood is an open-source VPN project:

https://github.com/vpnhood/vpnhood

It is a full VPN server/client stack, mostly built in .NET/C#. It is not a Node package that can be imported into the React app.

## How to Use It With This Bot

Use one of these setups:

1. Run the VpnHood client on the same machine or VPS that runs this bot.
   - If the VPN changes the host network route, no app setting is needed.
   - Restart the bot server after connecting the VPN.

2. Run a trusted HTTP or SOCKS proxy behind your VPN route.
   - Add this to `.env.local`:

```env
BINANCE_PROXY_URL=http://user:pass@proxy.example.com:8080
```

or:

```env
BINANCE_PROXY_URL=socks5://user:pass@proxy.example.com:1080
```

Then restart the dev server.

## Check

After restart, open Settings in the app. The "Binance network route" card should show `Proxy set` when `BINANCE_PROXY_URL` is configured.

Keep VPN/proxy credentials out of Git. `.env.local` is ignored by this repository.
