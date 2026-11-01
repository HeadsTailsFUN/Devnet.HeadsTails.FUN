import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  playAgainReady,
  queuePositionText,
  shouldCommitSelectionRefresh,
} from "./uiGuards.js";

describe("selection epoch guard", () => {
  it("stale refresh cannot clear HEADS after user picks it", () => {
    // refresh begins (epoch 4, no selection) -> user picks HEADS (epoch 5)
    // -> old refresh returns: must NOT commit.
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 4,
        currentEpoch: 5,
        selAtStart: null,
        selNow: "HEADS",
        chainHasPosition: false,
      }),
      false
    );
  });

  it("stale refresh cannot clear TAILS after user picks it", () => {
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 4,
        currentEpoch: 5,
        selAtStart: null,
        selNow: "TAILS",
        chainHasPosition: false,
      }),
      false
    );
  });

  it("fresh refresh may commit when nothing changed", () => {
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 5,
        currentEpoch: 5,
        selAtStart: "HEADS",
        selNow: "HEADS",
        chainHasPosition: false,
      }),
      true
    );
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 5,
        currentEpoch: 5,
        selAtStart: null,
        selNow: null,
        chainHasPosition: false,
      }),
      true
    );
  });

  it("chain-proven position always wins", () => {
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 4,
        currentEpoch: 9,
        selAtStart: null,
        selNow: "TAILS",
        chainHasPosition: true,
      }),
      true
    );
  });
});

describe("play again lifecycle", () => {
  it("unavailable before settlement (claim still pending)", () => {
    assert.equal(
      playAgainReady({ isWinOrLoss: true, claimPending: true, settledObserved: false }),
      false
    );
    assert.equal(
      playAgainReady({ isWinOrLoss: true, claimPending: true, settledObserved: true }),
      false
    );
  });

  it("works after settlement observed with no pending claim", () => {
    assert.equal(
      playAgainReady({ isWinOrLoss: true, claimPending: false, settledObserved: true }),
      true
    );
  });

  it("not shown outside win/loss", () => {
    assert.equal(
      playAgainReady({ isWinOrLoss: false, claimPending: false, settledObserved: true }),
      false
    );
  });
});

describe("queue position text", () => {
  it("shows exact position, never fabricated", () => {
    assert.equal(queuePositionText("HEADS", 3), "#3 In Queue");
    assert.equal(queuePositionText("TAILS", 2), "#2 In Queue");
  });

  it("honest fallback when unknown (never invents a number)", () => {
    assert.equal(queuePositionText("HEADS", null), "In Queue");
    assert.equal(queuePositionText("HEADS", undefined), "In Queue");
    assert.equal(queuePositionText("TAILS", 0), "In Queue");
  });
});
