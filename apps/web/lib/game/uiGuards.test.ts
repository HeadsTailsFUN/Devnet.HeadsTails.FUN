import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  playAgainReady,
  queuePositionText,
  shouldCommitSelectionRefresh,
  networkFeePreparationMessage,
  anchoredResultState,
} from "./uiGuards.js";

describe("revealed result ownership",()=>{
  const result={wallet:"player-a",matchId:"42",iWon:true};
  const context={result,wallet:"player-a",activeMatchId:"42",hasNewIntent:false};
  it("keeps a result through idle, low balance, errors and same-round polling without claiming payout",()=>{
    for(const state of ["ready","insufficient-balance","error","paused","flipping"] as const)
      assert.equal(anchoredResultState({...context,state}),"win");
    assert.equal(anchoredResultState({...context,state:"ready",activeMatchId:null,result:{...result,iWon:false}}),"loss");
  });
  it("never shows another wallet's result or hides a newer explicit/chain-proven round",()=>{
    assert.equal(anchoredResultState({...context,state:"ready",wallet:"player-b"}),"ready");
    assert.equal(anchoredResultState({...context,state:"tails-selected",hasNewIntent:true}),"tails-selected");
    assert.equal(anchoredResultState({...context,state:"flipping",activeMatchId:"43"}),"flipping");
    assert.equal(anchoredResultState({...context,state:"queued-heads"}),"queued-heads");
  });
});

describe("network fee preparation feedback", () => {
  it("distinguishes restricted admission from temporary funding failures", () => {
    assert.match(networkFeePreparationMessage("Restricted QA access only"), /not enabled for restricted testing/);
    assert.match(networkFeePreparationMessage("Verify wallet ownership for restricted QA"), /Verify your connected wallet/);
    assert.match(networkFeePreparationMessage("Verify wallet ownership"), /Verify your connected wallet/);
    assert.match(networkFeePreparationMessage("Connected wallet does not match verified session"), /Verify your connected wallet/);
  });
  it("does not reflect unexpected server error content", () => {
    const fallback = "Network fee preparation unavailable. Try again in a moment.";
    for (const reason of [undefined, "Sponsor unavailable", "private diagnostic: unexpected credential"]) {
      assert.equal(networkFeePreparationMessage(reason), fallback);
    }
  });
});

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
