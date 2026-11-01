import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { processSettledMatchRewards } from "./processor.js";
import { KeyMutex, simClient, type SimDb } from "./simulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEASON = "season-test";

function fresh(): { store: SimDb; db: ReturnType<typeof simClient> } {
  const store: SimDb = { claims: [], ledger: [], identities: [], attrs: [], seasonId: SEASON };
  return { store, db: simClient(store, new KeyMutex()) };
}

function seedGameplay(store: SimDb, wallet: string, points: number, prefix: string) {
  const rows = Math.floor(points / 2);
  for (let i = 0; i < rows; i += 1) {
    store.ledger.push({
      season_id: SEASON,
      wallet,
      category: "gameplay",
      event_type: "gameplay_match",
      source_key: `${prefix}${i}`,
      points: 2,
      status: "verified",
    });
  }
}

function dayTotal(store: SimDb, wallet: string): number {
  return store.ledger
    .filter(
      (l) =>
        l.wallet === wallet &&
        (l.category === "gameplay" || l.category === "win_bonus") &&
        l.status === "verified"
    )
    .reduce((s, l) => s + l.points, 0);
}

const DAY = "2026-09-20T12:00:00.000Z";

async function award(db: any, wallet: string, match: string, win: boolean, settledAt: string = DAY) {
  return db.rpc("award_gameplay_match_atomic", {
    p_season_id: SEASON,
    p_wallet: wallet,
    p_match_id: match,
    p_is_winner: win,
    p_settled_at: settledAt,
  });
}

describe("atomic gameplay daily cap (200, serialized)", () => {
  it("CASE A: 198 + concurrent loss + loss -> 200, never 202", async () => {
    const { store, db } = fresh();
    seedGameplay(store, "W", 198, "s");
    const [a, b] = await Promise.all([award(db, "W", "m1", false), award(db, "W", "m2", false)]);
    const statuses = [(a.data as any).status, (b.data as any).status].sort();
    assert.deepEqual(statuses, ["awarded", "capped"]);
    assert.equal(dayTotal(store, "W"), 200);
  });

  it("CASE B: 198 + concurrent win + win -> 200, never >200", async () => {
    const { store, db } = fresh();
    seedGameplay(store, "W", 198, "s");
    const [a, b] = await Promise.all([award(db, "W", "w1", true), award(db, "W", "w2", true)]);
    assert.equal(dayTotal(store, "W"), 200);
    const statuses = [(a.data as any).status, (b.data as any).status].sort();
    assert.ok(statuses.includes("capped"), "one match capped");
    assert.ok(statuses.includes("partial") || statuses.includes("awarded"), "one match awarded");
  });

  it("CASE C: 199 + win -> 200 via gameplay +1, bonus +0", async () => {
    const { store, db } = fresh();
    seedGameplay(store, "W", 198, "s");
    store.ledger.push({
      season_id: SEASON, wallet: "W", category: "gameplay", event_type: "gameplay_match",
      source_key: "sx", points: 1, status: "verified",
    });
    const r = await award(db, "W", "w9", true);
    assert.equal((r.data as any).status, "partial");
    assert.equal((r.data as any).gameplay, 1);
    assert.equal((r.data as any).win_bonus, 0);
    assert.equal(dayTotal(store, "W"), 200);
  });

  it("CASE D: 200 + new match -> capped WITH 0-point durable markers", async () => {
    const { store, db } = fresh();
    seedGameplay(store, "W", 200, "s");
    const loss = await award(db, "W", "m9", false);
    const win = await award(db, "W", "w9", true);
    assert.equal((loss.data as any).status, "capped");
    assert.equal((win.data as any).status, "capped");
    // Event-day idempotency: the marker IS written at 0 points (counts as
    // an eligible game; replays return exists instead of re-capping).
    const markers = store.ledger.filter((l) => ["m9", "w9"].includes(l.source_key));
    assert.equal(markers.length, 2);
    assert.ok(markers.every((m) => m.points === 0 && m.event_type === "gameplay_match"));
    assert.equal(dayTotal(store, "W"), 200);
    const replay = await award(db, "W", "m9", false);
    assert.equal((replay.data as any).status, "exists");
  });

  it("CASE E: same Match 10x concurrently -> single reward effect", async () => {
    const { store, db } = fresh();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => award(db, "W", "same", true))
    );
    const awarded = results.filter((r) => (r.data as any).status === "awarded").length;
    const exists = results.filter((r) => (r.data as any).status === "exists").length;
    assert.equal(awarded, 1);
    assert.equal(exists, 9);
    assert.equal(dayTotal(store, "W"), 5);
  });

  it("normal win breakdown: gameplay +2 / bonus +3; normal loss: +2", async () => {
    const { store, db } = fresh();
    const win = await award(db, "W", "win1", true);
    assert.equal((win.data as any).status, "awarded");
    assert.equal((win.data as any).gameplay, 2);
    assert.equal((win.data as any).win_bonus, 3);
    const loss = await award(db, "L", "loss1", false);
    assert.equal((loss.data as any).status, "awarded");
    const game = store.ledger.find((l) => l.wallet === "W" && l.event_type === "gameplay_match")!;
    const bonus = store.ledger.find((l) => l.wallet === "W" && l.event_type === "win_bonus_match")!;
    assert.equal(game.points, 2);
    assert.equal(bonus.points, 3);
    assert.ok(game.points > 0 && bonus.points >= 0, "no negative points");
  });

  it("processor awards gameplay through the atomic RPC only", async () => {
    const { store, db } = fresh();
    const out = await processSettledMatchRewards(db, {
      seasonId: SEASON,
      matchId: "pm1",
      headsWallet: "H",
      tailsWallet: "T",
      winnerWallet: "H",
      settledAt: DAY,
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.errors, []);
    assert.equal(dayTotal(store, "H"), 5, "winner 2+3");
    assert.equal(dayTotal(store, "T"), 2, "loser 2");
    const src = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    assert.ok(src.includes("award_gameplay_match_atomic"), "gameplay via atomic RPC");
    assert.ok(!src.includes(".upsert("), "no direct ledger writes remain");
  });

  it("SQL serializes per wallet+EVENT-day with prospective cap arithmetic", () => {
    const src = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000002_gameplay_event_day_idempotency.sql"),
      "utf8"
    );
    assert.ok(src.includes("p_settled_at timestamptz"), "authoritative event time param");
    assert.ok(src.includes("missing-settled-at"), "null event time fails closed");
    assert.ok(src.includes("pg_advisory_xact_lock"), "lock present");
    assert.ok(src.includes("gameplay-day:"), "gameplay lock key");
    assert.ok(src.includes("v_event_day"), "event-day lock/cap scope");
    assert.ok(src.includes("greatest(0, 200 - v_current)"), "allowance arithmetic");
    assert.ok(src.includes("least(2, v_allow)"), "base split");
    assert.ok(src.includes("least(3, v_allow)"), "bonus split");
    assert.ok(
      src.includes("drop function if exists public.award_gameplay_match_atomic(uuid, text, text, boolean)"),
      "obsolete processing-time overload removed"
    );
    assert.ok(src.includes("grant execute"), "service_role grant re-applied");
    assert.ok(src.includes("from authenticated"), "authenticated revoked");
  });
});
