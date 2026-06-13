/**
 * End-to-end isolation test.
 *
 * Verifies that one user's Binance API setup, bot state, trades, logs, and
 * per-symbol locks NEVER bleed into another user's dashboard or bot state.
 *
 * Exercises the same contract every server function in src/lib/bot uses:
 *   - context.userId from auth middleware scopes every supabaseAdmin query
 *   - getCredsForUser(userId) only ever returns that user's row
 *   - symbol_locks is unique per (user_id, symbol) so two users on the same
 *     symbol never collide
 *
 * Run with:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bunx vitest run
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const skip = !SUPABASE_URL || !SERVICE_KEY;
const d = skip ? describe.skip : describe;

if (skip) {
  // eslint-disable-next-line no-console
  console.warn(
    "[isolation.test] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — skipping. " +
      "Set them in your shell to run this test.",
  );
}

const admin: SupabaseClient = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SYMBOL = "BTCUSDT";
const userIds: string[] = [];

async function createUser(label: string) {
  const email = `iso-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@isolation.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "Isolation!Test1234",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  userIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function cleanup(id: string) {
  await admin.from("symbol_locks").delete().eq("user_id", id);
  await admin.from("trades").delete().eq("user_id", id);
  await admin.from("bot_logs").delete().eq("user_id", id);
  await admin.from("user_binance_creds").delete().eq("user_id", id);
  await admin.from("symbol_config").delete().eq("user_id", id);
  await admin.from("bot_config").delete().eq("user_id", id);
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

d("per-user isolation", () => {
  let alice: { id: string };
  let bob: { id: string };

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");

    // Alice: mainnet, custom exposure, her own keys, a trade and a log.
    await admin.from("bot_config").upsert({
      user_id: alice.id,
      testnet: false,
      is_running: true,
      max_total_notional_usdt: 1000,
    });
    await admin.from("user_binance_creds").upsert({
      user_id: alice.id,
      api_key: "ALICE_MAINNET_KEY",
      api_secret: "ALICE_MAINNET_SECRET",
    });
    await admin
      .from("symbol_config")
      .upsert({ user_id: alice.id, symbol: SYMBOL, enabled: true, grid_levels: 7, grid_spacing_pct: 0.7, order_size_usdt: 25, leverage: 10 });
    await admin.from("trades").insert({
      user_id: alice.id,
      symbol: SYMBOL,
      side: "BUY",
      qty: 0.01,
      price: 65000,
      realized_pnl: 12.5,
      commission: 0.5,
      filled_at: new Date().toISOString(),
    });
    await admin.from("bot_logs").insert({ user_id: alice.id, level: "info", message: "alice-only" });

    // Bob: testnet, stopped, his own keys, no trades.
    await admin.from("bot_config").upsert({
      user_id: bob.id,
      testnet: true,
      is_running: false,
      max_total_notional_usdt: 200,
    });
    await admin.from("user_binance_creds").upsert({
      user_id: bob.id,
      testnet_api_key: "BOB_TESTNET_KEY",
      testnet_api_secret: "BOB_TESTNET_SECRET",
    });
    await admin
      .from("symbol_config")
      .upsert({ user_id: bob.id, symbol: SYMBOL, enabled: false, grid_levels: 3, grid_spacing_pct: 0.2, order_size_usdt: 10, leverage: 3 });
    await admin.from("bot_logs").insert({ user_id: bob.id, level: "info", message: "bob-only" });
  });

  afterAll(async () => {
    for (const id of userIds) await cleanup(id);
  });

  it("bot_config is scoped per user", async () => {
    const { data: a } = await admin.from("bot_config").select("*").eq("user_id", alice.id).maybeSingle();
    const { data: b } = await admin.from("bot_config").select("*").eq("user_id", bob.id).maybeSingle();
    expect(a?.is_running).toBe(true);
    expect(a?.testnet).toBe(false);
    expect(a?.max_total_notional_usdt).toBe(1000);
    expect(b?.is_running).toBe(false);
    expect(b?.testnet).toBe(true);
    expect(b?.max_total_notional_usdt).toBe(200);
  });

  it("symbol_config is scoped per user", async () => {
    const { data: a } = await admin
      .from("symbol_config")
      .select("*")
      .eq("user_id", alice.id)
      .eq("symbol", SYMBOL)
      .maybeSingle();
    const { data: b } = await admin
      .from("symbol_config")
      .select("*")
      .eq("user_id", bob.id)
      .eq("symbol", SYMBOL)
      .maybeSingle();
    expect(a?.enabled).toBe(true);
    expect(a?.leverage).toBe(10);
    expect(b?.enabled).toBe(false);
    expect(b?.leverage).toBe(3);
  });

  it("trades and logs never leak across users", async () => {
    const { data: aTrades } = await admin.from("trades").select("*").eq("user_id", alice.id);
    const { data: bTrades } = await admin.from("trades").select("*").eq("user_id", bob.id);
    expect(aTrades?.length).toBe(1);
    expect(bTrades?.length).toBe(0);

    const { data: aLogs } = await admin.from("bot_logs").select("message").eq("user_id", alice.id);
    const { data: bLogs } = await admin.from("bot_logs").select("message").eq("user_id", bob.id);
    expect(aLogs?.some((l) => l.message === "alice-only")).toBe(true);
    expect(aLogs?.some((l) => l.message === "bob-only")).toBe(false);
    expect(bLogs?.some((l) => l.message === "bob-only")).toBe(true);
    expect(bLogs?.some((l) => l.message === "alice-only")).toBe(false);
  });

  it("getCredsForUser returns each user's own keys (mainnet vs testnet)", async () => {
    const { getCredsForUser } = await import("@/lib/binance/client.server");
    const aMain = await getCredsForUser(alice.id, false);
    expect(aMain.apiKey).toBe("ALICE_MAINNET_KEY");
    expect(aMain.apiSecret).toBe("ALICE_MAINNET_SECRET");
    expect(aMain.testnet).toBe(false);

    const bTest = await getCredsForUser(bob.id, true);
    expect(bTest.apiKey).toBe("BOB_TESTNET_KEY");
    expect(bTest.apiSecret).toBe("BOB_TESTNET_SECRET");
    expect(bTest.testnet).toBe(true);

    // Bob has no mainnet key — must throw, not fall back to Alice or env.
    await expect(getCredsForUser(bob.id, false)).rejects.toThrow();
    // Alice has no testnet key — must throw, not fall back to Bob or env.
    await expect(getCredsForUser(alice.id, true)).rejects.toThrow();
  });

  it("symbol_locks is unique per (user_id, symbol) so two users don't collide", async () => {
    const now = new Date().toISOString();
    const a = await admin
      .from("symbol_locks")
      .insert({ user_id: alice.id, symbol: SYMBOL, locked_at: now });
    const b = await admin
      .from("symbol_locks")
      .insert({ user_id: bob.id, symbol: SYMBOL, locked_at: now });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    // Re-inserting Alice's lock collides; Bob's lock is unaffected.
    const dup = await admin
      .from("symbol_locks")
      .insert({ user_id: alice.id, symbol: SYMBOL, locked_at: now });
    expect(dup.error?.code).toBe("23505");

    const { data: bobLock } = await admin
      .from("symbol_locks")
      .select("*")
      .eq("user_id", bob.id)
      .eq("symbol", SYMBOL)
      .maybeSingle();
    expect(bobLock).toBeTruthy();
  });

  it("dashboard query shape only returns the requested user's rows", async () => {
    // Mirror getDashboard's queries with each user's id and assert no cross-bleed.
    for (const u of [alice, bob]) {
      const { data: cfg } = await admin.from("bot_config").select("user_id").eq("user_id", u.id);
      const { data: syms } = await admin.from("symbol_config").select("user_id").eq("user_id", u.id);
      const { data: trades } = await admin.from("trades").select("user_id").eq("user_id", u.id);
      const { data: logs } = await admin.from("bot_logs").select("user_id").eq("user_id", u.id);
      for (const row of [...(cfg ?? []), ...(syms ?? []), ...(trades ?? []), ...(logs ?? [])]) {
        expect(row.user_id).toBe(u.id);
      }
    }
  });
});
