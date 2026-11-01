import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decideRecoveryOutcome,
  reconcileAfterAmbiguousSubmit,
} from "./txRecovery.js";

describe("signed transaction recovery", () => {
  it("absent tx with no state is safe retry", () => {
    assert.equal(
      decideRecoveryOutcome({
        signatureStatus: "not-found",
        hasPlayerState: false,
        queued: false,
        inMatch: false,
        signatureError: null,
      }),
      "absent"
    );
  });

  it("queued state shows Queued", () => {
    assert.equal(
      decideRecoveryOutcome({
        signatureStatus: "confirmed",
        hasPlayerState: true,
        queued: true,
        inMatch: false,
        signatureError: null,
      }),
      "queued"
    );
  });

  it("matched state shows Match Found / Flipping", () => {
    assert.equal(
      decideRecoveryOutcome({
        signatureStatus: "confirmed",
        hasPlayerState: true,
        queued: false,
        inMatch: true,
        signatureError: null,
      }),
      "matched"
    );
  });

  it("on-chain failure shows actual program error", () => {
    assert.equal(
      decideRecoveryOutcome({
        signatureStatus: "error",
        hasPlayerState: false,
        queued: false,
        inMatch: false,
        signatureError: "custom program error: 0x1",
      }),
      "failed"
    );
  });

  it("confirmed but no state yet stays unknown (no duplicate Join)", async () => {
    const out = await reconcileAfterAmbiguousSubmit(
      {
        getSignatureStatus: async () => ({ found: true, err: null, confirmationStatus: "confirmed" }),
        getPlayerStatus: async () => ({ exists: false, queued: false, inMatch: false }),
      },
      "sig",
      { tries: 2, delayMs: 1 }
    );
    assert.equal(out, "unknown");
  });

  it("recovers queued after ambiguous submit", async () => {
    const out = await reconcileAfterAmbiguousSubmit(
      {
        getSignatureStatus: async () => ({ found: true, err: null, confirmationStatus: "confirmed" }),
        getPlayerStatus: async () => ({ exists: true, queued: true, inMatch: false }),
      },
      "sig",
      { tries: 2, delayMs: 1 }
    );
    assert.equal(out, "queued");
  });
});
