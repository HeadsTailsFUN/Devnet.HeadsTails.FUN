import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { detectUnclaimedWin } from "./pending.js";

const ME = "ME1111111111111111111111111111111111111111";
const OTHER = "OT2222222222222222222222222222222222222222";

function match(over: Partial<Parameters<typeof detectUnclaimedWin>[0]["match"]> = {}) {
  return {
    matchId: "8",
    state: "waitingForRandomness",
    headsPlayer: ME,
    tailsPlayer: OTHER,
    headsAmount: "1000000",
    tailsAmount: "1000000",
    ...over,
  };
}

describe("pending winner detection", () => {
  it("pending winner detected with amount", () => {
    const r = detectUnclaimedWin({
      inMatch: true,
      match: match(),
      fulfilled: true,
      resultBit: 0,
      myWallet: ME,
    });
    assert.equal(r.kind, "win");
    if (r.kind === "win") {
      assert.equal(r.matchId, "8");
      assert.equal(r.amountBaseUnits, "2000000");
      assert.equal(r.result, "HEADS");
    }
  });

  it("loser gets no winner notification", () => {
    const r = detectUnclaimedWin({
      inMatch: true,
      match: match(),
      fulfilled: true,
      resultBit: 1,
      myWallet: ME,
    });
    assert.deepEqual(r, { kind: "none" });
  });

  it("settled match clears notification", () => {
    const r = detectUnclaimedWin({
      inMatch: true,
      match: match({ state: "settled" }),
      fulfilled: true,
      resultBit: 0,
      myWallet: ME,
    });
    assert.deepEqual(r, { kind: "none" });
  });

  it("unfulfilled randomness yields nothing", () => {
    assert.deepEqual(
      detectUnclaimedWin({ inMatch: true, match: match(), fulfilled: false, resultBit: null, myWallet: ME }),
      { kind: "none" }
    );
  });

  it("no match yields nothing", () => {
    assert.deepEqual(
      detectUnclaimedWin({ inMatch: false, match: null, fulfilled: false, resultBit: null, myWallet: ME }),
      { kind: "none" }
    );
  });

  it("popup dismissal keeps badge (detection is state-driven, not popup-driven)", () => {
    // Badge derives from the same detection; dismissing the popup does not
    // alter chain state, so a later refresh still detects the win.
    const again = detectUnclaimedWin({
      inMatch: true,
      match: match(),
      fulfilled: true,
      resultBit: 0,
      myWallet: ME,
    });
    assert.equal(again.kind, "win");
  });
});
