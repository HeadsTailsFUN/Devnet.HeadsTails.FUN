import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pointsDetails, readPointsLedger, type PointsLedgerRow } from "./earn";
import { GET } from "../../app/api/airdrop/points/route";
import { SESSION_COOKIE } from "../auth/message";
import type { SupabaseClient } from "@supabase/supabase-js";

const now = new Date("2026-11-14T02:00:00Z");
const row = (patch: Partial<PointsLedgerRow> = {}): PointsLedgerRow => ({ id: "a", category: "gameplay", event_type: "gameplay_match", points: 2, status: "verified", created_at: now.toISOString(), ...patch });
const originalFetch = globalThis.fetch;
const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
});

test("daily gameplay uses authoritative event day, includes win bonus, excludes pending and delayed yesterday rewards", () => {
  const details = pointsDetails([
    row(), row({ id: "bonus", category: "win_bonus", points: 3 }),
    row({ id: "pending", status: "pending", points: 100 }),
    row({ id: "old", points: 5, metadata: { event_day: "2026-11-13" } }),
    row({ id: "late", points: 2, created_at: "2026-11-15T02:00:00Z", metadata: { event_day: "2026-11-14" } }),
  ], now);
  assert.equal(details.today.gameplay, 7);
  assert.equal(details.today.gameplayCap, 200);
});

test("referral progress caps recurring points only, not one-time qualification bonuses", () => {
  const details = pointsDetails([
    row({ category: "referral", event_type: "referral_game", points: 2 }),
    row({ id: "qualified", category: "referral", event_type: "referral_qualified", points: 50 }),
    row({ id: "pending", category: "referral", event_type: "referral_game", status: "pending", points: 2 }),
  ], now);
  assert.equal(details.today.referral, 52);
  assert.equal(details.today.referralRecurring, 2);
  assert.equal(details.today.referralRecurringCap, 500);
});

test("recent activity is bounded, ordered, keeps rejected/pending distinct and never exposes raw metadata", () => {
  const rows = Array.from({ length: 20 }, (_, index) => row({ id: String(index), created_at: `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00Z`, status: index === 19 ? "rejected" : "pending", metadata: { event_day: "2026-11-14" } }));
  const { activity } = pointsDetails(rows, now);
  assert.equal(activity.length, 12);
  assert.equal(activity[0].id, "19");
  assert.equal(activity[0].status, "rejected");
  assert(!("metadata" in activity[0]));
  assert(!("wallet" in activity[0]));
  assert.equal(pointsDetails([row({ points: 0 })], now).activity.length, 0);
});

test("ledger pagination reads beyond 1,000 records, scopes every page and fails closed on query errors", async () => {
  const filters: string[] = [];
  const source = Array.from({ length: 1003 }, (_, i) => row({ id: String(i) }));
  let broken = false;
  const query = {
    select() { return this; }, eq(k: string, v: string) { filters.push(`${k}:${v}`); return this; },
    lte(k: string, v: string) { filters.push(`${k}:${v}`); return this; },
    order() { return this; }, async range(a: number, b: number) { return { data: source.slice(a, b + 1), error: broken ? new Error("offline") : null }; },
  };
  const db = { from: () => query } as unknown as SupabaseClient;
  assert.equal((await readPointsLedger(db, "season", "owner")).length, 1003);
  assert.equal(filters.filter(f => f === "wallet:owner").length, 3);
  assert.equal(filters.filter(f => f === "season_id:season").length, 3);
  assert.equal(new Set(filters.filter(f => f.startsWith("created_at:"))).size, 1);
  broken = true;
  await assert.rejects(readPointsLedger(db, "season", "owner"), /unavailable/);
});

test("real route denies anonymous access even with a supplied wallet address", async () => {
  const response = await GET(new Request("http://localhost/api/airdrop/points?wallet=someone-else"));
  assert.equal(response.status, 401);
});

test("route -> Supabase client -> response remains session scoped and preserves existing totals", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://rewards-fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
  const queries: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); queries.push(url);
    const table = url.pathname.split("/").at(-1);
    if (table === "auth_sessions") return Response.json({ wallet: "session-owner", expires_at: "2099-01-01T00:00:00Z" });
    if (table === "airdrop_seasons") return Response.json({ id: "active-season", key: "DEVNET_BETA", team_points_start_at: null });
    assert.equal(url.searchParams.get("wallet"), "eq.session-owner");
    assert.equal(url.searchParams.get("season_id"), "eq.active-season");
    if (table === "airdrop_points_ledger") return Response.json([row(), row({ id: "social", category: "social", points: 100, status: "pending" })]);
    if (table === "airdrop_x_identities") return Response.json(null);
    if (table === "airdrop_social_claims") return Response.json([]);
    throw new Error(`Unexpected read ${table}`);
  };
  const response = await GET(new Request("http://localhost/api/airdrop/points?wallet=attacker", { headers: { cookie: `${SESSION_COOKIE}=${"a".repeat(64)}` } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.verifiedTotal, 2);
  assert.equal(body.pendingTotal, 100);
  assert.equal(body.verified.gameplay, 2);
  assert.equal(body.activity.length, 2);
  assert(queries.length >= 5);
});
