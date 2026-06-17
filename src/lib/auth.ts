import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import { tanstackStartCookies } from "better-auth/tanstack-start";

function resolveAuthBaseURL() {
  const fallback =
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://127.0.0.1:${process.env.PORT ?? "8080"}`);

  return {
    allowedHosts: [
      "localhost",
      "localhost:*",
      "127.0.0.1",
      "127.0.0.1:*",
      "binancebot-github-io.vercel.app",
      "*.vercel.app",
      "*.trycloudflare.com",
      "*.loca.lt",
    ],
    fallback,
    protocol: "auto" as const,
  };
}

function resolveTrustedOrigins() {
  const origins = [
    "http://localhost",
    "http://localhost:*",
    "http://127.0.0.1",
    "http://127.0.0.1:*",
    "https://binancebot-github-io.vercel.app",
    "https://*.vercel.app",
    "https://*.trycloudflare.com",
    "https://*.loca.lt",
  ];

  if (process.env.BETTER_AUTH_URL) {
    try {
      origins.push(new URL(process.env.BETTER_AUTH_URL).origin);
    } catch {}
  }

  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }

  return Array.from(new Set(origins));
}

const dbPath = resolve(
  process.env.BETTER_AUTH_DB_PATH ?? (process.env.VERCEL ? "/tmp/auth.sqlite" : "./data/auth.sqlite"),
);
mkdirSync(dirname(dbPath), { recursive: true });
const sqliteModule = await import("better-sqlite3");
const database = new sqliteModule.default(dbPath);

export const auth = betterAuth({
  baseURL: resolveAuthBaseURL(),
  trustedOrigins: resolveTrustedOrigins,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-better-auth-secret-change-before-production",
  database,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    dash({
      apiKey: process.env.BETTER_AUTH_API_KEY,
    }),
    tanstackStartCookies(),
  ],
});
