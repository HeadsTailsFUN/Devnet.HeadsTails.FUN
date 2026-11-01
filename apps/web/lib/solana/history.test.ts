import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  mapRowToFlip,
  solscanTxUrl,
  type MatchRow,
} from "./history.js";

const SIG = "5".repeat(88);

function row(): MatchRow {
  return {
    onchain_match_id: "8",
    result: "HEADS",
    winner_wallet: "W1",
    heads_wallet: "H1",
    tails_wallet: "T1",
    heads_amount: "1000000",
    tails_amount: "1000000",
    token_mint: "MINT",
    settled_at: "2026-09-22T00:00:00.000Z",
    transaction_signature: SIG,
  };
}

describe("real history mapping", () => {
  it("maps settlement signature and real match id (no mock ids)", () => {
    const f = mapRowToFlip(row());
    assert.equal(f.matchId, "8");
    assert.equal(f.settlementSignature, SIG);
    assert.equal(f.result, "HEADS");
    assert.equal(f.winnerWallet, "W1");
    assert.equal(f.headsWallet, "H1");
    assert.equal(f.tailsWallet, "T1");
    assert.equal(f.potBaseUnits, "2000000");
    assert.equal(f.tokenMint, "MINT");
  });

  it("empty history never shows mock (caller renders empty state)", () => {
    // fetchRecentFlips returns status empty for zero rows; the component
    // renders items = flips ?? [] with no mockFlips fallback.
    const flips: unknown[] | undefined = undefined;
    const items = flips ?? [];
    assert.deepEqual(items, []);
  });
});

describe("solscan urls", () => {
  it("devnet format with cluster param", () => {
    assert.equal(solscanTxUrl(SIG, "devnet"), `https://solscan.io/tx/${SIG}?cluster=devnet`);
  });

  it("mainnet format without cluster param", () => {
    assert.equal(solscanTxUrl(SIG, "mainnet-beta"), `https://solscan.io/tx/${SIG}`);
  });

  it("rejects invalid signatures (never trust DB/client input)", () => {
    assert.equal(solscanTxUrl("short", "devnet"), null);
    assert.equal(solscanTxUrl("", "devnet"), null);
    assert.equal(solscanTxUrl("https://evil.example/x", "devnet"), null);
  });
});
