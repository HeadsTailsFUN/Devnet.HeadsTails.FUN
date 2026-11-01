import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { countStats } from "./stats.js";

const W = "WALLET1";

function winRow() {
  return { winner_wallet: W, heads_wallet: W, tails_wallet: "OTHER", heads_amount: "1000000", tails_amount: "1000000" };
}

function lossRow() {
  return { winner_wallet: "OTHER", heads_wallet: W, tails_wallet: "OTHER", heads_amount: "1000000", tails_amount: "1000000" };
}

describe("authoritative profile stats (settled only)", () => {
  it("settled win increments Games/Wins", () => {
    const s = countStats([winRow()], W);
    assert.equal(s.games, 1);
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 0);
    assert.equal(s.totalWonBaseUnits, "2000000");
  });

  it("settled loss increments Games/Losses", () => {
    const s = countStats([lossRow()], W);
    assert.equal(s.games, 1);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 1);
  });

  it("pending match does not count (absent from settled rows)", () => {
    const s = countStats([], W);
    assert.equal(s.games, 0);
    assert.equal(s.wins, 0);
    assert.equal(s.losses, 0);
  });

  it("mixed history aggregates", () => {
    const s = countStats([winRow(), lossRow(), winRow()], W);
    assert.equal(s.games, 3);
    assert.equal(s.wins, 2);
    assert.equal(s.losses, 1);
  });
});
