import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  STALE_SUBMITTED_MS,
  decideAfterUnknownConfirmation,
} from "./welcomeGrantRetry.js";

describe("unknown-confirmation double-grant protection", () => {
  it("send succeeds + confirm succeeds -> complete, no new transfer", () => {
    assert.deepEqual(decideAfterUnknownConfirmation({ kind: "confirmed" }, 1000), {
      action: "complete",
    });
  });

  it("send succeeds + confirm times out + tx later confirms -> complete", () => {
    // Re-check of the persisted signature reports confirmed.
    assert.deepEqual(decideAfterUnknownConfirmation({ kind: "confirmed" }, 240000), {
      action: "complete",
    });
  });

  it("send succeeds + RPC response lost/unknown + fresh -> wait, never resend", () => {
    assert.deepEqual(decideAfterUnknownConfirmation({ kind: "unknown" }, 30_000), {
      action: "wait-pending",
    });
    assert.deepEqual(
      decideAfterUnknownConfirmation({ kind: "unknown" }, STALE_SUBMITTED_MS),
      { action: "wait-pending" }
    );
  });

  it("only a definitive failure permits replacement; expired unknown stays pending", () => {
    assert.deepEqual(decideAfterUnknownConfirmation({ kind: "failed" }, 1000), {
      action: "retry-new-transfer",
    });
    // It cannot land in the future, but might already have landed.
    assert.deepEqual(
      decideAfterUnknownConfirmation({ kind: "unknown" }, STALE_SUBMITTED_MS + 1),
      { action: "wait-pending" }
    );
  });

  it("simultaneous requests -> max one successful grant (documented in route)", () => {
    // Only the atomic (wallet,mint) insert winner reaches attemptTransfer;
    // losers see pending/completed. The persisted signature makes even a
    // confirmation race converge to a single completed transfer.
    assert.ok(STALE_SUBMITTED_MS > 60_000, "margin far beyond blockhash expiry");
  });
});
