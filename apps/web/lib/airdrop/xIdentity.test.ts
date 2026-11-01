import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewSocialClaim } from "./social.js";
import { verifiedTotal } from "./rules.js";
import { KeyMutex, simClient, type SimDb } from "./simulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEASON = "season-devnet-beta";
const OTHER = "season-1";

function fresh(seasonId = SEASON): { store: SimDb; db: ReturnType<typeof simClient> } {
  const store: SimDb = { claims: [], ledger: [], identities: [], attrs: [], seasonId };
  return { store, db: simClient(store, new KeyMutex()) };
}

async function createVerify(
  db: any,
  season: string,
  wallet: string,
  task: string,
  handle: string,
  points: number
) {
  const c = await db.rpc("create_airdrop_social_claim_atomic", {
    p_season_id: season,
    p_wallet: wallet,
    p_task_type: task,
    p_handle: handle,
    p_profile_url: `https://x.com/${handle}`,
    p_evidence_url: null,
    p_x_user_id: null,
    p_points: points,
  });
  if (c.error) return { created: c, verified: null };
  const v = await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "verified", reviewer: "ADMIN" });
  return { created: c, verified: v };
}

describe("X identity invariant (one wallet, three tasks, one X)", () => {
  it("Wallet A: connect_x @alice verified -> PASS", async () => {
    const { store, db } = fresh();
    const { created, verified } = await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    assert.equal(created.data.status, "created");
    assert.equal(verified!.ok, true);
    assert.equal(store.identities.length, 1);
    assert.equal(store.identities[0].status, "verified");
  });

  it("Wallet A: repost @alice verified -> PASS (same identity, second task)", async () => {
    const { store, db } = fresh();
    await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    const { created, verified } = await createVerify(db, SEASON, "WA", "repost", "alice", 75);
    assert.equal(created.data.status, "created", "second task claim allowed");
    assert.equal(verified!.ok, true);
    assert.equal(store.identities.length, 1, "same identity reused, not duplicated");
  });

  it("Wallet A: reply @alice verified -> PASS (third task)", async () => {
    const { store, db } = fresh();
    await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    await createVerify(db, SEASON, "WA", "repost", "alice", 75);
    const { verified } = await createVerify(db, SEASON, "WA", "reply", "alice", 50);
    assert.equal(verified!.ok, true);
    assert.equal(
      verifiedTotal(store.ledger.map((l) => ({ status: l.status, points: l.points }))),
      225
    );
  });

  it("Wallet B: connect_x @alice verified -> FAIL/409", async () => {
    const { store, db } = fresh();
    await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    const b = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: SEASON,
      p_wallet: "WB",
      p_task_type: "connect_x",
      p_handle: "alice",
      p_profile_url: "https://x.com/alice",
      p_evidence_url: null,
      p_x_user_id: null,
      p_points: 100,
    });
    assert.ok(b.error, "blocked with x-taken");
    assert.equal(store.claims.filter((c) => c.wallet === "WB").length, 0, "claim untouched");
    assert.equal(
      verifiedTotal(store.ledger.filter((l) => l.wallet === "WB").map((l) => ({ status: l.status, points: l.points }))),
      0,
      "no verified points leak"
    );
  });

  it("pending-vs-pending race: A verifies, B verify -> 409 with B untouched", async () => {
    const { store, db } = fresh();
    const a = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "WA", p_task_type: "repost", p_handle: "race",
      p_profile_url: "https://x.com/race", p_evidence_url: null, p_x_user_id: null, p_points: 75,
    });
    const b = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "WB", p_task_type: "repost", p_handle: "race",
      p_profile_url: "https://x.com/race", p_evidence_url: null, p_x_user_id: null, p_points: 75,
    });
    assert.equal(a.data.status, "created");
    assert.equal(b.data.status, "created", "both pending allowed (no verified identity yet)");
    const va = await reviewSocialClaim(db, { claimId: a.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    assert.equal(va.ok, true);
    const vb = await reviewSocialClaim(db, { claimId: b.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    assert.equal(vb.ok, false);
    if (!vb.ok) assert.equal(vb.status, 409);
    const loser = store.claims.find((c) => c.id === b.data.claim_id)!;
    assert.equal(loser.status, "pending", "loser claim untouched");
    assert.equal(
      store.ledger.find((l) => l.source_key === b.data.claim_id)!.status,
      "pending",
      "loser ledger untouched"
    );
  });

  it("case-insensitive: @Alice and @alice are the same manual identity", async () => {
    const { db } = fresh();
    await createVerify(db, SEASON, "WA", "repost", "alice", 75);
    const b = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "WB", p_task_type: "repost", p_handle: "Alice",
      p_profile_url: "https://x.com/Alice", p_evidence_url: null, p_x_user_id: null, p_points: 75,
    });
    assert.ok(b.error, "blocked case-insensitively");
  });

  it("different season: future SEASON_1 maps identities independently", async () => {
    const { db } = fresh();
    await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    const { created, verified } = await createVerify(db, OTHER, "WB", "connect_x", "alice", 100);
    assert.equal(created.data.status, "created");
    assert.equal(verified!.ok, true, "DEVNET_BETA identity does not block SEASON_1");
  });

  it("revoking the last verified claim revokes the identity; siblings keep it", async () => {
    const { store, db } = fresh();
    const a1 = await createVerify(db, SEASON, "WA", "connect_x", "alice", 100);
    const a2 = await createVerify(db, SEASON, "WA", "repost", "alice", 75);
    const first = await reviewSocialClaim(db, { claimId: a1.created.data.claim_id, decision: "rejected", reviewer: "ADMIN", note: "fake" });
    assert.equal(first.ok, true);
    assert.equal(store.identities[0].status, "verified", "sibling verified claim keeps identity");
    const second = await reviewSocialClaim(db, { claimId: a2.created.data.claim_id, decision: "rejected", reviewer: "ADMIN", note: "fake" });
    assert.equal(second.ok, true);
    assert.equal(store.identities[0].status, "rejected", "last revoke clears identity");
    assert.equal(
      verifiedTotal(store.ledger.map((l) => ({ status: l.status, points: l.points }))),
      0,
      "revoked points leave the verified total"
    );
    assert.equal(store.claims.length, 2, "history kept, never deleted");
  });

  it("routes bind the wallet identity and surface revoke", () => {
    const claimRoute = readFileSync(join(root, "app", "api", "airdrop", "social-claim", "route.ts"), "utf8");
    assert.ok(claimRoute.includes("create_airdrop_social_claim_atomic"), "atomic creation");
    const adminUi = readFileSync(join(root, "components", "admin", "AdminTabsC.tsx"), "utf8");
    assert.ok(adminUi.includes("Revoke"), "admin revoke control for verified claims");
  });
});
