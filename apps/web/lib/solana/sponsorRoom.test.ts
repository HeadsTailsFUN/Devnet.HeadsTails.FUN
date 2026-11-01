import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  DISCRIMINATORS,
  derivePlayerStatePda,
  deriveRoomQueueEntryPda,
  discriminatorsFor,
  verifySponsorTransaction,
  verifyTopLevelShape,
  GAME_PROGRAM_ID,
  type TopLevelIx,
} from "./sponsorVerify.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Sponsor reimbursement: CURRENT room-based instructions (the live UI sends
 * join_queue_room / cancel_queue_entry_room). Previously only legacy V1
 * discriminators were accepted, so valid room joins/cancels failed with
 * 422 `wrong game instruction` while gameplay itself succeeded.
 *
 * Security preserved: exact discriminator set per action (room-first +
 * narrow legacy compat), program-ID allowlist, wallet participation, PDA
 * presence derived from on-chain ix bytes (never client claims), caps and
 * idempotency enforced at the route layer.
 */

const WALLET = "DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy";
const OTHER = "EZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNw";

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** join_queue_room(side, tier_usd, stake, sequence) — IDL arg order. */
function roomJoinData(side = 0, tier = 1, sequence = BigInt(0)): Uint8Array {
  const buf = Buffer.alloc(8 + 1 + 1 + 8 + 8);
  Buffer.from(hexToBytes(DISCRIMINATORS.join_queue_room)).copy(buf, 0);
  buf[8] = side;
  buf[9] = tier;
  buf.writeBigUInt64LE(BigInt(1000000), 10);
  buf.writeBigUInt64LE(sequence, 18);
  return new Uint8Array(buf);
}

function roomCancelData(): Uint8Array {
  return hexToBytes(DISCRIMINATORS.cancel_queue_entry_room);
}

function gameIx(data: Uint8Array): TopLevelIx {
  return { programId: GAME_PROGRAM_ID, data, accounts: [WALLET] };
}

function computeIx(): TopLevelIx {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, data: new Uint8Array([1, 2, 3]), accounts: [] };
}

describe("sponsor room-instruction reimbursement (current live UI)", () => {
  it("room discriminators match the shipped IDL (no drift)", () => {
    const idl = JSON.parse(
      readFileSync(
        join(root, "..", "..", "packages", "game-sdk", "src", "idl.json"),
        "utf8"
      )
    ) as { instructions: Array<{ name: string; discriminator: number[] }> };
    const hex = (name: string): string => {
      const ix = idl.instructions.find((i) => i.name === name);
      assert.ok(ix, `IDL has ${name}`);
      return Buffer.from(ix.discriminator).toString("hex");
    };
    assert.equal(DISCRIMINATORS.join_queue_room, hex("join_queue_room"));
    assert.equal(DISCRIMINATORS.cancel_queue_entry_room, hex("cancel_queue_entry_room"));
    assert.equal(DISCRIMINATORS.match_next_room, hex("match_next_room"));
    // Legacy pins unchanged.
    assert.equal(DISCRIMINATORS.join_queue, hex("join_queue"));
    assert.equal(DISCRIMINATORS.cancel_queue_entry, hex("cancel_queue_entry"));
  });

  it("1. valid current $1 room join → accepted (fee + room-entry rent)", () => {
    const data = roomJoinData(0, 1, BigInt(3));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveRoomQueueEntryPda(GAME_PROGRAM_ID, 1, 0, BigInt(3));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [computeIx(), gameIx(data)],
      accountKeys: [WALLET, ps, entry, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0, 0],
      postBalances: [100_000_000 - 5000 - 2_700_000, 1_500_000, 1_200_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000 + 2_700_000);
  });

  it("2. valid current $10 room join → accepted (tier-scoped entry)", () => {
    const data = roomJoinData(1, 10, BigInt(0));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveRoomQueueEntryPda(GAME_PROGRAM_ID, 10, 1, BigInt(0));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data)],
      accountKeys: [WALLET, ps, entry, GAME_PROGRAM_ID],
      preBalances: [10_000_000_000, 0, 0, 0],
      postBalances: [10_000_000_000 - 5000, 0, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000);
  });

  it("3. valid current room leave/cancel → accepted (fee-only)", () => {
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const v = verifySponsorTransaction({
      action: "cancel",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(roomCancelData())],
      accountKeys: [WALLET, ps, GAME_PROGRAM_ID],
      preBalances: [50_000_000, 2_000_000, 0],
      postBalances: [50_000_000 - 5000, 2_000_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000);
  });

  it("room join with the WRONG tier entry PDA → rejected (relationship check)", () => {
    // Args say tier 1 but accountKeys carry the tier-10 entry: the exact
    // (tier, side, sequence) binding must hold.
    const data = roomJoinData(0, 1, BigInt(3));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const wrongEntry = deriveRoomQueueEntryPda(GAME_PROGRAM_ID, 10, 0, BigInt(3));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data)],
      accountKeys: [WALLET, ps, wrongEntry, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0, 0],
      postBalances: [100_000_000 - 5000, 0, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /QueueEntry PDA missing/);
  });

  it("4. unrelated game instruction for the action → rejected", () => {
    // settle_match bytes presented as a join: must stay `wrong game instruction`.
    const v = verifyTopLevelShape({
      action: "join",
      topLevel: [gameIx(hexToBytes(DISCRIMINATORS.settle_match))],
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /wrong game instruction for join/);
  });

  it("5. wrong program top-level → rejected", () => {
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [
        { programId: "Fake111111111111111111111111111111111111111", data: roomJoinData(0, 1, BigInt(0)) },
      ],
      accountKeys: [WALLET],
      preBalances: [100_000_000],
      postBalances: [100_000_000 - 5000],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
  });

  it("6. wrong wallet → rejected", () => {
    const data = roomJoinData(0, 1, BigInt(0));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: OTHER,
      topLevel: [gameIx(data)],
      accountKeys: [OTHER],
      preBalances: [100_000_000],
      postBalances: [100_000_000 - 5000],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /wallet mismatch/);
  });

  it("7. failed on-chain transactions are rejected before verification", () => {
    const src = readFileSync(join(root, "app", "api", "devnet", "sponsor", "reimburse", "route.ts"), "utf8");
    assert.ok(src.includes("tx.meta.err"), "inspects on-chain failure");
    assert.ok(src.includes("on-chain transaction failed"), "failed tx rejected with 422");
  });

  it("8. duplicate reimbursement is idempotent (same sig once)", () => {
    const src = readFileSync(join(root, "app", "api", "devnet", "sponsor", "reimburse", "route.ts"), "utf8");
    assert.ok(src.includes("sendJournaledTransaction"), "shared atomic admission before any transfer");
    assert.ok(src.includes("reimb-${gameSignature}"), "idempotency key pinned to the game signature");
    assert.ok(src.includes("already-reimbursed"), "repeat returns success with zero new SOL");
  });

  it("9. malformed transactions → rejected", () => {
    assert.equal(
      verifyTopLevelShape({ action: "join", topLevel: [] }).ok,
      false,
      "empty instructions rejected"
    );
    assert.equal(
      verifySponsorTransaction({
        action: "join",
        expectedWallet: WALLET,
        txWallet: WALLET,
        topLevel: [{ programId: GAME_PROGRAM_ID, data: new Uint8Array([1, 2, 3]) }],
        accountKeys: [WALLET],
        preBalances: [100_000_000],
        postBalances: [100_000_000 - 5000],
        feeLamports: 5000,
      }).ok,
      false,
      "short game data rejected"
    );
  });

  it("legacy V1 join/cancel stay recognized (narrow historical compat)", () => {
    assert.ok(discriminatorsFor("join").includes(DISCRIMINATORS.join_queue), "V1 join kept");
    assert.ok(
      discriminatorsFor("cancel").includes(DISCRIMINATORS.cancel_queue_entry),
      "V1 cancel kept"
    );
    assert.equal(discriminatorsFor("join")[0], DISCRIMINATORS.join_hts_queue_room, "HTS room-first order");
  });
});
