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

function gameplay(store: SimDb, wallet: string, n: number, prefix: string) {
  for (let i = 0; i < n; i += 1) {
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

describe("atomic referral rewards (RPC contract)", () => {
  it("failure during +25 leaves attribution pending with no bonus rows; retry heals once", async () => {
    const { store, db } = fresh();
    store.attrs.push({ invitee_wallet: "INV", referrer_wallet: "REF", referral_code: "C", status: "pending" });
    gameplay(store, "INV", 3, "g");
    store.failNextLedgerWrite = true;
    const failed = await (db.rpc as any)("qualify_referral_atomic", {
      p_season_id: SEASON,
      p_invitee: "INV",
      p_referrer: "REF",
    });
    assert.ok(failed.error, "failure surfaced, not success");
    assert.equal(store.attrs[0].status, "pending", "attribution NOT qualified");
    assert.equal(
      store.ledger.filter((l) => l.event_type.startsWith("referral_qualify")).length,
      0,
      "no partial bonus rows"
    );
    const retry = await (db.rpc as any)("qualify_referral_atomic", {
      p_season_id: SEASON,
      p_invitee: "INV",
      p_referrer: "REF",
    });
    assert.equal((retry.data as { status: string }).status, "qualified");
    const again = await (db.rpc as any)("qualify_referral_atomic", {
      p_season_id: SEASON,
      p_invitee: "INV",
      p_referrer: "REF",
    });
    assert.equal((again.data as { status: string }).status, "already-qualified");
    assert.equal(
      store.ledger.filter((l) => l.event_type === "referral_qualify_invitee").length,
      1,
      "+25 once"
    );
    assert.equal(
      store.ledger.filter((l) => l.event_type === "referral_qualify_referrer").length,
      1,
      "+50 once"
    );
  });

  it("processor reports reward errors instead of void success", async () => {
    const { store, db } = fresh();
    store.attrs.push({ invitee_wallet: "INV", referrer_wallet: "REF", referral_code: "C", status: "pending" });
    gameplay(store, "INV", 3, "g");
    const throwing = {
      ...db,
      rpc: async () => {
        throw new Error("boom");
      },
    };
    const out = await processSettledMatchRewards(throwing as any, {
      seasonId: SEASON,
      matchId: "m1",
      headsWallet: "INV",
      tailsWallet: "OTHER",
      winnerWallet: "INV",
      settledAt: "2026-09-20T12:00:00.000Z",
    });
    assert.equal(out.ok, false, "failure reported");
    assert.ok(out.errors.some((e) => e.includes("INV")), "retryable reason names the wallet");
  });

  it("concurrent awards at 498 recurring settle at exactly 500", async () => {
    const { store, db } = fresh();
    for (let i = 0; i < 249; i += 1) {
      store.ledger.push({
        season_id: SEASON,
        wallet: "R",
        event_type: "referral_game",
        source_key: `seed${i}`,
        points: 2,
        status: "verified",
        metadata: { invitee: `S${i}` },
      });
    }
    const [a, b] = await Promise.all([
      (db.rpc as any)("award_referral_game_atomic", { p_season_id: SEASON, p_referrer: "R", p_invitee: "SX", p_match_id: "m1" }),
      (db.rpc as any)("award_referral_game_atomic", { p_season_id: SEASON, p_referrer: "R", p_invitee: "SX", p_match_id: "m2" }),
    ]);
    const statuses = [(a.data as any)?.status ?? "error", (b.data as any)?.status ?? "error"].sort();
    assert.deepEqual(statuses, ["awarded", "capped-referrer"]);
    const total = store.ledger
      .filter((l) => l.wallet === "R" && l.event_type === "referral_game")
      .reduce((s, l) => s + l.points, 0);
    assert.equal(total, 500, "never 502");
  });

  it("invitee at 24 + two concurrent events settles at 25", async () => {
    const { store, db } = fresh();
    for (let i = 0; i < 24; i += 1) {
      store.ledger.push({
        season_id: SEASON,
        wallet: "R",
        event_type: "referral_game",
        source_key: `q${i}`,
        points: 2,
        status: "verified",
        metadata: { invitee: "Q" },
      });
    }
    const [a, b] = await Promise.all([
      (db.rpc as any)("award_referral_game_atomic", { p_season_id: SEASON, p_referrer: "R", p_invitee: "Q", p_match_id: "n1" }),
      (db.rpc as any)("award_referral_game_atomic", { p_season_id: SEASON, p_referrer: "R", p_invitee: "Q", p_match_id: "n2" }),
    ]);
    const statuses = [(a.data as any)?.status ?? "error", (b.data as any)?.status ?? "error"].sort();
    assert.deepEqual(statuses, ["awarded", "capped-invitee"]);
    assert.equal(
      store.ledger.filter((l) => l.wallet === "R" && (l.metadata as any)?.invitee === "Q").length,
      25
    );
  });

  it("SQL enforces the same caps transactionally (advisory lock + event filter)", () => {
    const src = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"),
      "utf8"
    );
    assert.ok(src.includes("pg_advisory_xact_lock"), "serialized per referrer+day");
    assert.ok(src.includes("metadata->>'invitee' = p_invitee"), "per-invitee counting in SQL");
    assert.ok(src.includes("v_recurring + 2 > 500"), "prospective 500 arithmetic in SQL");
    assert.ok(src.includes("qualify_referral_atomic"), "atomic qualification exists");
  });
});
