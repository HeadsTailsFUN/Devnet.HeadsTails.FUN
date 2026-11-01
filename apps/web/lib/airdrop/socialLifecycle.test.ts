import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewSocialClaim, socialPendingPoints } from "./social.js";
import { verifiedTotal } from "./rules.js";
import { KeyMutex, simClient, type SimDb } from "./simulator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEASON = "season-test";

function fresh(): { store: SimDb; db: ReturnType<typeof simClient> } {
  const store: SimDb = { claims: [], ledger: [], identities: [], attrs: [], seasonId: SEASON };
  return { store, db: simClient(store, new KeyMutex()) };
}

async function create(db: any, wallet: string, task: string, handle = "alice", points = 75) {
  return db.rpc("create_airdrop_social_claim_atomic", {
    p_season_id: SEASON,
    p_wallet: wallet,
    p_task_type: task,
    p_handle: handle,
    p_profile_url: `https://x.com/${handle}`,
    p_evidence_url: null,
    p_x_user_id: null,
    p_points: points,
  });
}

describe("social lifecycle (claim -> ledger -> review)", () => {
  it("pending claim carries pending points (connect 100 / repost 75 / reply 50)", () => {
    assert.equal(socialPendingPoints("connect_x"), 100);
    assert.equal(socialPendingPoints("repost"), 75);
    assert.equal(socialPendingPoints("reply"), 50);
    assert.equal(
      verifiedTotal([
        { status: "pending", points: 100 },
        { status: "pending", points: 75 },
      ]),
      0
    );
  });

  it("verify transitions the SAME ledger event pending -> verified", async () => {
    const { store, db } = fresh();
    const c = await create(db, "W1", "repost", "alice", 75);
    assert.equal(c.data.status, "created");
    const out = await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    assert.equal(out.ok, true);
    assert.equal(store.ledger.length, 1, "no second reward row");
    assert.equal(store.ledger[0].status, "verified");
    assert.ok(store.identities.some((i) => i.wallet === "W1" && i.status === "verified"));
  });

  it("reject transitions the SAME event to rejected (no verified points left)", async () => {
    const { store, db } = fresh();
    const c = await create(db, "W1", "reply", "bob", 50);
    const out = await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "rejected", reviewer: "ADMIN" });
    assert.equal(out.ok, true);
    assert.equal(store.ledger[0].status, "rejected");
    assert.equal(
      verifiedTotal(store.ledger.map((l) => ({ status: l.status, points: l.points }))),
      0
    );
  });

  it("verified claim later invalidated is revocable to rejected", async () => {
    const { store, db } = fresh();
    const c = await create(db, "W1", "connect_x", "carol", 100);
    await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    const out = await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "rejected", reviewer: "ADMIN" });
    assert.equal(out.ok, true);
    assert.equal(store.ledger[0].status, "rejected");
  });

  it("same verified X cannot map to two wallets (409, no partial state)", async () => {
    const { store, db } = fresh();
    const a = await create(db, "W1", "repost", "dave", 75);
    await reviewSocialClaim(db, { claimId: a.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    const b = await create(db, "W2", "repost", "Dave", 75);
    assert.ok(b.error, "second wallet blocked at creation");
    assert.equal(store.claims.filter((c) => c.wallet === "W2").length, 0, "no orphan claim");
    assert.equal(store.ledger.filter((l) => l.wallet === "W2").length, 0, "no orphan ledger");
  });

  it("concurrent identical creates -> one created + one already-claimed", async () => {
    const { store, db } = fresh();
    const [r1, r2] = await Promise.all([
      create(db, "WC", "connect_x", "race", 100),
      create(db, "WC", "connect_x", "race", 100),
    ]);
    const statuses = [r1.data.status, r2.data.status].sort();
    assert.deepEqual(statuses, ["already-claimed", "created"]);
    assert.equal(r1.data.claim_id, r2.data.claim_id, "same claim id");
    assert.equal(store.claims.length, 1, "one claim row");
    assert.equal(store.ledger.length, 1, "one pending ledger event");
  });

  it("handle edit on verified identity -> pending, same rows, no second reward", async () => {
    const { store, db } = fresh();
    const c = await create(db, "W1", "connect_x", "carol", 100);
    await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    const edit = await db.rpc("update_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "W1", p_task_type: "connect_x",
      p_handle: "carol2", p_evidence_url: null,
    });
    assert.equal(edit.data.status, "edited");
    assert.equal(edit.data.claim_id, c.data.claim_id, "same claim row");
    assert.equal(store.claims.length, 1, "no duplicate claim");
    assert.equal(store.ledger.length, 1, "no duplicate ledger event");
    assert.equal(store.ledger[0].status, "pending", "reward back to pending, not verified");
    assert.equal(store.identities[0].status, "pending", "identity back to pending");
    assert.equal(store.identities[0].x_handle, "carol2");
  });

  it("same-handle edit -> unchanged, no writes", async () => {
    const { store, db } = fresh();
    const c = await create(db, "W1", "connect_x", "carol", 100);
    const edit = await db.rpc("update_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "W1", p_task_type: "connect_x",
      p_handle: "@carol", p_evidence_url: null,
    });
    assert.equal(edit.data.status, "unchanged");
    assert.equal(store.ledger[0].status, "pending");
  });

  it("reply URL edit -> pending with new evidence, same rows", async () => {
    const { store, db } = fresh();
    await create(db, "W1", "connect_x", "dora", 100);
    const c = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "W1", p_task_type: "reply",
      p_handle: "dora", p_profile_url: "https://x.com/dora",
      p_evidence_url: "https://x.com/post/1", p_x_user_id: null, p_points: 50,
    });
    await reviewSocialClaim(db, { claimId: c.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    const edit = await db.rpc("update_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "W1", p_task_type: "reply",
      p_handle: "dora", p_evidence_url: "https://x.com/post/2",
    });
    assert.equal(edit.data.status, "edited");
    assert.equal(store.claims.filter((x) => x.task_type === "reply").length, 1);
    assert.equal(store.ledger.filter((l) => l.event_type === "social_reply").length, 1);
    assert.equal(store.ledger.find((l) => l.event_type === "social_reply")!.status, "pending");
  });

  it("handle edit to another wallet's verified X is blocked (x-taken)", async () => {
    const { store, db } = fresh();
    const a = await create(db, "W1", "connect_x", "taken", 100);
    await reviewSocialClaim(db, { claimId: a.data.claim_id, decision: "verified", reviewer: "ADMIN" });
    await create(db, "W2", "connect_x", "free", 100);
    const edit = await db.rpc("update_airdrop_social_claim_atomic", {
      p_season_id: SEASON, p_wallet: "W2", p_task_type: "connect_x",
      p_handle: "taken", p_evidence_url: null,
    });
    assert.ok(edit.error, "blocked");
    assert.equal(store.identities.find((i) => i.wallet === "W2")!.x_handle, "free", "unchanged");
  });

  it("server routes run the atomic RPCs (no multi-step writes)", () => {
    const claim = readFileSync(join(root, "app", "api", "airdrop", "social-claim", "route.ts"), "utf8");
    assert.ok(claim.includes("create_airdrop_social_claim_atomic"), "atomic creation");
    assert.ok(!claim.includes('.from("airdrop_social_claims")'), "no direct claim writes");
    assert.ok(!claim.includes('.from("airdrop_points_ledger")'), "no direct ledger writes");
    assert.ok(claim.includes("already-claimed"), "duplicate handled, not 500");
    const admin = readFileSync(join(root, "app", "api", "admin", "airdrop", "route.ts"), "utf8");
    assert.ok(admin.includes("reviewSocialClaim"), "review through shared atomic flow");
  });
});
