import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { processSettledMatchRewards } from "./processor.js";
import { KeyMutex, simClient, type SimDb } from "./simulator.js";

/**
 * Cross-UTC-day gameplay idempotency (event-day cap + durable markers).
 * Mirrors supabase/migrations/20260929000002_gameplay_event_day_idempotency.sql
 * via the in-memory simulator: cap day + lock key derive from p_settled_at
 * (authoritative matches.settled_at), never processing time.
 */

const SEASON = "season-event-day";
const D1 = "2026-09-20T12:00:00.000Z"; // event day 2026-09-20
const D2 = "2026-09-21T12:00:00.000Z"; // next UTC day

function fresh(): { store: SimDb; db: ReturnType<typeof simClient> } {
  const store: SimDb = { claims: [], ledger: [], identities: [], attrs: [], seasonId: SEASON };
  return { store, db: simClient(store, new KeyMutex()) };
}

function award(db: any, wallet: string, match: string, win: boolean, settledAt: string = D1) {
  return db.rpc("award_gameplay_match_atomic", {
    p_season_id: SEASON,
    p_wallet: wallet,
    p_match_id: match,
    p_is_winner: win,
    p_settled_at: settledAt,
  });
}

/** Seed N verified gameplay points on an explicit event day (legacy rows). */
function seedDay(store: SimDb, wallet: string, points: number, prefix: string, day: string) {
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
      day,
    });
  }
}

function dayTotal(store: SimDb, wallet: string, day: string): number {
  return store.ledger
    .filter(
      (l) =>
        l.wallet === wallet &&
        (l.category === "gameplay" || l.category === "win_bonus") &&
        l.status === "verified" &&
        (((l.metadata as any)?.event_day as string) ?? (l as { day?: string }).day ?? day) === day
    )
    .reduce((s, l) => s + l.points, 0);
}

function markers(store: SimDb, wallet: string, match: string) {
  return store.ledger.filter(
    (l) => l.wallet === wallet && l.event_type === "gameplay_match" && l.source_key === match
  );
}

describe("gameplay event-day idempotency", () => {
  it("1. normal loss +2 on its event day", async () => {
    const { store, db } = fresh();
    const r = await award(db, "L", "m1", false, D1);
    assert.equal((r.data as any).status, "awarded");
    assert.equal(dayTotal(store, "L", "2026-09-20"), 2);
  });

  it("2. normal win +2 +3 on its event day", async () => {
    const { store, db } = fresh();
    const r = await award(db, "W", "m1", true, D1);
    assert.equal((r.data as any).status, "awarded");
    assert.equal((r.data as any).gameplay, 2);
    assert.equal((r.data as any).win_bonus, 3);
    assert.equal(dayTotal(store, "W", "2026-09-20"), 5);
  });

  it("3. 198 winner -> +2 only, bonus omitted (partial)", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 198, "s", "2026-09-20");
    const r = await award(db, "W", "w1", true, D1);
    assert.equal((r.data as any).status, "partial");
    assert.equal((r.data as any).gameplay, 2);
    assert.equal((r.data as any).win_bonus, 0);
    assert.equal(dayTotal(store, "W", "2026-09-20"), 200);
  });

  it("4. 198-winner replay next UTC day -> exists, +0 (no bonus top-up)", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 198, "s", "2026-09-20");
    await award(db, "W", "w1", true, D1);
    const replay = await award(db, "W", "w1", true, D2);
    assert.equal((replay.data as any).status, "exists");
    assert.equal(dayTotal(store, "W", "2026-09-20"), 200);
    assert.equal(dayTotal(store, "W", "2026-09-21"), 0);
  });

  it("5. 199 winner -> +1 only, bonus omitted", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 198, "s", "2026-09-20");
    store.ledger.push({
      season_id: SEASON, wallet: "W", category: "gameplay", event_type: "gameplay_match",
      source_key: "sx", points: 1, status: "verified", day: "2026-09-20",
    });
    const r = await award(db, "W", "w9", true, D1);
    assert.equal((r.data as any).status, "partial");
    assert.equal((r.data as any).gameplay, 1);
    assert.equal((r.data as any).win_bonus, 0);
    assert.equal(dayTotal(store, "W", "2026-09-20"), 200);
  });

  it("6. 199-winner replay next UTC day -> exists, +0", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 199, "s", "2026-09-20");
    await award(db, "W", "w9", true, D1);
    const replay = await award(db, "W", "w9", true, D2);
    assert.equal((replay.data as any).status, "exists");
    assert.equal(dayTotal(store, "W", "2026-09-21"), 0);
  });

  it("7. 200 capped loss -> 0-point gameplay marker", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 200, "s", "2026-09-20");
    const r = await award(db, "W", "m9", false, D1);
    assert.equal((r.data as any).status, "capped");
    const m = markers(store, "W", "m9");
    assert.equal(m.length, 1);
    assert.equal(m[0].points, 0);
    assert.equal(m[0].status, "verified");
    assert.equal(dayTotal(store, "W", "2026-09-20"), 200);
  });

  it("8. 200 capped winner -> 0-point gameplay marker, no bonus row", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 200, "s", "2026-09-20");
    const r = await award(db, "W", "w9", true, D1);
    assert.equal((r.data as any).status, "capped");
    assert.equal(markers(store, "W", "w9").length, 1);
    assert.equal(
      store.ledger.filter((l) => l.event_type === "win_bonus_match" && l.source_key === "w9").length,
      0
    );
  });

  it("9. capped replay next UTC day -> exists (never re-caps a new day)", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 200, "s", "2026-09-20");
    await award(db, "W", "m9", false, D1);
    const replay = await award(db, "W", "m9", false, D2);
    assert.equal((replay.data as any).status, "exists");
    assert.equal(markers(store, "W", "m9").length, 1);
  });

  it("10. zero-point capped marker counts toward referral game #3", async () => {
    const { store, db } = fresh();
    // Invitee I referred by R: 1 normal + 1 zero-point capped marker.
    store.attrs.push({ invitee_wallet: "I", referrer_wallet: "R", referral_code: "CODE1", status: "pending" });
    store.ledger.push({
      season_id: SEASON, wallet: "I", category: "gameplay", event_type: "gameplay_match",
      source_key: "g1", points: 2, status: "verified", day: "2026-09-20",
    });
    store.ledger.push({
      season_id: SEASON, wallet: "I", category: "gameplay", event_type: "gameplay_match",
      source_key: "g0", points: 0, status: "verified",
      metadata: { matchId: "g0", event_day: "2026-09-20", capped: true },
    });
    // Third eligible game settles -> qualification must fire (+25/+50).
    const out = await processSettledMatchRewards(db, {
      seasonId: SEASON, matchId: "g3", headsWallet: "I", tailsWallet: "X",
      winnerWallet: "X", settledAt: D1,
    });
    assert.equal(out.ok, true);
    const inviteeBonus = store.ledger.find(
      (l) => l.wallet === "I" && l.event_type === "referral_qualify_invitee"
    );
    const referrerBonus = store.ledger.find(
      (l) => l.wallet === "R" && l.event_type === "referral_qualify_referrer"
    );
    assert.equal(inviteeBonus?.points, 25);
    assert.equal(referrerBonus?.points, 50);
  });

  it("11. delayed reconciliation uses the settlement UTC day, not processing day", async () => {
    const { store, db } = fresh();
    // Wallet is 200/200 TODAY but the match settled YESTERDAY (empty cap).
    seedDay(store, "W", 200, "s", "2026-09-21");
    const r = await award(db, "W", "late", true, "2026-09-20T23:00:00.000Z");
    assert.equal((r.data as any).status, "awarded");
    assert.equal((r.data as any).event_day, "2026-09-20");
    assert.equal(dayTotal(store, "W", "2026-09-20"), 5);
    assert.equal(dayTotal(store, "W", "2026-09-21"), 200);
  });

  it("12. same match x10 concurrent -> one durable marker", async () => {
    const { store, db } = fresh();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => award(db, "W", "same", true, D1))
    );
    assert.equal(results.filter((r) => (r.data as any).status === "awarded").length, 1);
    assert.equal(results.filter((r) => (r.data as any).status === "exists").length, 9);
    assert.equal(markers(store, "W", "same").length, 1);
  });

  it("13. daily total never exceeds 200 under concurrency", async () => {
    const { store, db } = fresh();
    seedDay(store, "W", 198, "s", "2026-09-20");
    await Promise.all([
      award(db, "W", "a", true, D1),
      award(db, "W", "b", true, D1),
      award(db, "W", "c", false, D1),
    ]);
    assert.ok(dayTotal(store, "W", "2026-09-20") <= 200);
  });

  it("14. referral qualification +25/+50 exactly once across replays", async () => {
    const { store, db } = fresh();
    store.attrs.push({ invitee_wallet: "I", referrer_wallet: "R", referral_code: "CODE1", status: "pending" });
    for (const [i, mid] of ["q1", "q2", "q3"].entries()) {
      const out = await processSettledMatchRewards(db, {
        seasonId: SEASON, matchId: mid, headsWallet: "I", tailsWallet: `T${i}`,
        winnerWallet: `T${i}`, settledAt: D1,
      });
      assert.equal(out.ok, true);
    }
    const invitee = store.ledger.filter((l) => l.wallet === "I" && l.event_type === "referral_qualify_invitee");
    const referrer = store.ledger.filter((l) => l.wallet === "R" && l.event_type === "referral_qualify_referrer");
    assert.equal(invitee.length, 1);
    assert.equal(invitee[0].points, 25);
    assert.equal(referrer.length, 1);
    assert.equal(referrer[0].points, 50);
    // Replay all three: no duplicates.
    for (const [i, mid] of ["q1", "q2", "q3"].entries()) {
      await processSettledMatchRewards(db, {
        seasonId: SEASON, matchId: mid, headsWallet: "I", tailsWallet: `T${i}`,
        winnerWallet: `T${i}`, settledAt: D1,
      });
    }
    assert.equal(store.ledger.filter((l) => l.event_type === "referral_qualify_invitee").length, 1);
    assert.equal(store.ledger.filter((l) => l.event_type === "referral_qualify_referrer").length, 1);
  });

  it("15. game #4 referrer +2 exactly once", async () => {
    const { store, db } = fresh();
    store.attrs.push({ invitee_wallet: "I", referrer_wallet: "R", referral_code: "CODE1", status: "pending" });
    for (const [i, mid] of ["g1", "g2", "g3", "g4"].entries()) {
      await processSettledMatchRewards(db, {
        seasonId: SEASON, matchId: mid, headsWallet: "I", tailsWallet: `T${i}`,
        winnerWallet: `T${i}`, settledAt: D1,
      });
    }
    const perGame = store.ledger.filter((l) => l.wallet === "R" && l.event_type === "referral_game");
    assert.equal(perGame.length, 1);
    assert.equal(perGame[0].points, 2);
    // Replay game 4: still exactly one.
    await processSettledMatchRewards(db, {
      seasonId: SEASON, matchId: "g4", headsWallet: "I", tailsWallet: "T3",
      winnerWallet: "T3", settledAt: D1,
    });
    assert.equal(store.ledger.filter((l) => l.wallet === "R" && l.event_type === "referral_game").length, 1);
  });

  it("missing settled_at fails closed (no invented time)", async () => {
    const { store, db } = fresh();
    const r = await db.rpc("award_gameplay_match_atomic", {
      p_season_id: SEASON, p_wallet: "W", p_match_id: "m1", p_is_winner: false, p_settled_at: null,
    });
    assert.ok(r.error, "error returned");
    assert.equal(store.ledger.length, 0, "no rows written");
  });
});
