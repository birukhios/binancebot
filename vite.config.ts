// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, nitro: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: {
      entry: "server",
    },
  },
  vite: {
    server: {
      allowedHosts: [".trycloudflare.com", ".loca.lt"],
    },
  },
  nitro: {
    preset: "vercel",
    externals: {
      external: ["better-sqlite3"],
    },
    vercel: {
      entryFormat: "node",
      functions: {
        runtime: "nodejs22.x",
        maxDuration: 60,
        memory: 1024,
      },
      regions: ["fra1"],
      functionRules: {
        "/**": {
          maxDuration: 60,
          memory: 1024,
        },
      },
    },
  } as any,
});
