import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PublicKey } from "@solana/web3.js";
import { roomQueuePda } from "./queueSnapshot.js";
import { mapRowToFlip, type MatchRow } from "./history.js";

const PROGRAM = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
const SIG = "5".repeat(88);

describe("multi-room isolation", () => {
  it("$1 HEADS cannot match $10 TAILS (distinct queue PDAs)", () => {
    const a = roomQueuePda(PROGRAM, 1, 0, BigInt(0));
    const b = roomQueuePda(PROGRAM, 10, 1, BigInt(0));
    assert.notDeepEqual(a.toBase58(), b.toBase58());
  });

  it("queue counters independent per tier (distinct addresses)", () => {
    assert.notDeepEqual(
      roomQueuePda(PROGRAM, 1, 0, BigInt(3)).toBase58(),
      roomQueuePda(PROGRAM, 10, 0, BigInt(3)).toBase58()
    );
    assert.notDeepEqual(
      roomQueuePda(PROGRAM, 1, 1, BigInt(3)).toBase58(),
      roomQueuePda(PROGRAM, 10, 1, BigInt(3)).toBase58()
    );
  });

  it("recent flips tier filtered (map preserves tier, defaults legacy to $1)", () => {
    const base: MatchRow = {
      onchain_match_id: "1",
      result: "HEADS",
      winner_wallet: "W",
      heads_wallet: "H",
      tails_wallet: "T",
      heads_amount: "1",
      tails_amount: "1",
      token_mint: "M",
      settled_at: null,
      transaction_signature: SIG,
    };
    assert.equal(mapRowToFlip({ ...base }).tierUsd, 1);
    assert.equal(mapRowToFlip({ ...base, tier_usd: 10 }).tierUsd, 10);
    const flips = [
      mapRowToFlip({ ...base, onchain_match_id: "1", tier_usd: 1 }),
      mapRowToFlip({ ...base, onchain_match_id: "2", tier_usd: 10 }),
    ];
    assert.deepEqual(flips.filter((f) => f.tierUsd === 1).map((f) => f.matchId), ["1"]);
    assert.deepEqual(flips.filter((f) => f.tierUsd === 10).map((f) => f.matchId), ["2"]);
  });
});

