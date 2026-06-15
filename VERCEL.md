# Vercel Deployment

This app can run on Vercel as a server-backed deployment.

## Settings

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `.vercel/output`

## Notes

- `vite.config.ts` pins Nitro to the `vercel` preset, so the build emits Vercel-ready output.
- The Vercel build uses Node entry format with a 60-second function limit and 1024 MB memory.
- Vercel uses the in-memory Better Auth adapter so the app can start without loading SQLite.
- Keep the same environment variables you use locally for auth and Binance access.
- Auth state on Vercel is ephemeral and will reset on redeploys or cold starts.
