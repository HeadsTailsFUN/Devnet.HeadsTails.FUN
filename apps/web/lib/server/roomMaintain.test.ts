import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decideHeadAction,
  isLegitimateQueuedPlayer,
  normalizeHeadStatus,
  withTransientRetry,
} from "./roomMaintain.js";

describe("room reconciler head decisions (P0)", () => {
  it("valid offline Active player is never removed (keep-valid, never advance)", () => {
    assert.deepEqual(decideHeadAction("active"), {
      kind: "keep-valid",
      reason: "active head pending playerstate verification",
    });
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: true,
        sideMatches: true,
        sequenceMatches: true,
        tierMatches: true,
        notInMatch: true,
      }),
      true
    );
  });

  it("inactive/cancelled head advances", () => {
    assert.equal(decideHeadAction(normalizeHeadStatus("Cancelled")).kind, "advance");
    assert.equal(decideHeadAction(normalizeHeadStatus("cancelled")).kind, "advance");
  });

  it("multiple inactive holes advance (matched/consumed/non-active)", () => {
    assert.equal(decideHeadAction(normalizeHeadStatus("Matched")).kind, "advance");
    assert.equal(decideHeadAction(normalizeHeadStatus("matched")).kind, "advance");
    assert.equal(decideHeadAction(normalizeHeadStatus("consumed")).kind, "advance");
    assert.equal(decideHeadAction("unknown-non-active").kind, "advance");
  });

  it("transient read retries without mutation", () => {
    assert.deepEqual(decideHeadAction("unreadable-transient").kind, "retry-transient");
    assert.deepEqual(decideHeadAction(normalizeHeadStatus("transient")).kind, "retry-transient");
  });

  it("missing head is an invariant, never silently skipped", () => {
    const a = decideHeadAction("missing");
    assert.equal(a.kind, "invariant");
  });

  it("Active entry disagreeing with PlayerState is NOT legitimate", () => {
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: true,
        sideMatches: true,
        sequenceMatches: false,
        tierMatches: true,
        notInMatch: true,
      }),
      false
    );
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: false,
        sideMatches: true,
        sequenceMatches: true,
        tierMatches: true,
        notInMatch: true,
      }),
      false
    );
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: true,
        sideMatches: true,
        sequenceMatches: true,
        tierMatches: false,
        notInMatch: true,
      }),
      false
    );
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: true,
        sideMatches: true,
        sequenceMatches: true,
        tierMatches: true,
        notInMatch: false,
      }),
      false
    );
  });

  it("self-match and cross-tier stay rejected at plan layer", () => {
    // Tier/side/player binding is enforced in maintainRoom before send;
    // the legitimacy predicate alone never approves a mismatched tier.
    assert.equal(
      isLegitimateQueuedPlayer({
        playerMatches: true,
        queued: true,
        sideMatches: false,
        sequenceMatches: true,
        tierMatches: true,
        notInMatch: true,
      }),
      false
    );
  });

  it("benign race leads to refetch/retry, not permanent stuck state", async () => {
    let calls = 0;
    const out = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("429 rate limit");
        return "ok";
      },
      { attempts: 4, baseMs: 1 }
    );
    assert.equal(out, "ok");
    assert.equal(calls, 3);
  });

  it("non-transient errors are not retried as transient", async () => {
    let calls = 0;
    await assert.rejects(
      withTransientRetry(
        async () => {
          calls += 1;
          throw new Error("InvalidHeadEntry");
        },
        { attempts: 3, baseMs: 1, isTransient: () => false }
      ),
      /InvalidHeadEntry/
    );
    assert.equal(calls, 1);
  });
});
