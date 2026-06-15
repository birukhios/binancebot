import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { betterAuth } from "better-auth";
import { dash } from "@better-auth/infra";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import Database from "better-sqlite3";

const dbPath = resolve(
  process.env.BETTER_AUTH_DB_PATH ?? (process.env.VERCEL ? "/tmp/auth.sqlite" : "./data/auth.sqlite"),
);
mkdirSync(dirname(dbPath), { recursive: true });

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:5173",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-better-auth-secret-change-before-production",
  database: new Database(dbPath),
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
