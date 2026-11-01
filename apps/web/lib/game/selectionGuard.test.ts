import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { commitPassiveState, failedRefreshState, intentSelectedState, intentSide, resolvePassiveSelectionView } from "./selectionGuard.js";
import {
  createIntent,
  mayClearIntentForRefresh,
  shouldClearIntentOn,
  type SelectionIntent,
} from "./selectionIntent.js";
import { shouldCommitSelectionRefresh } from "./uiGuards.js";

/**
 * Deterministic regression tests for the selection-reset race (BUG.mp4):
 * T0 refresh starts, T1 user picks, T2 confirm visible, T3 stale refresh
 * resolves. The stale response must never clear the newer intent.
 */
describe("selection reset race", () => {
  it("HEADS survives a stale refresh resolving after the pick", () => {
    const E0 = 5;
    // T0: refresh R1 snapshots epoch 5, no selection.
    // T1: user picks HEADS -> epoch 6, intent created, UI shows confirm.
    const intent = createIntent("HEADS", 1, 6);
    // T3: R1 resolves with no chain position. Both guards must deny commit.
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: E0,
        currentEpoch: 6,
        selAtStart: null,
        selNow: "HEADS",
        chainHasPosition: false,
      }),
      false
    );
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: null, // R1 snapshotted before the intent existed
        chainHasPosition: false,
      }),
      false
    );
    // UI therefore keeps HEADS + confirm.
    assert.equal(intentSelectedState(intent), "heads-selected");
  });

  it("TAILS survives a stale refresh resolving after the pick", () => {
    const intent = createIntent("TAILS", 1, 3);
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 2,
        currentEpoch: 3,
        selAtStart: null,
        selNow: "TAILS",
        chainHasPosition: false,
      }),
      false
    );
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: null,
        chainHasPosition: false,
      }),
      false
    );
    assert.equal(intentSelectedState(intent), "tails-selected");
  });

  it("overlapping refreshes + room probe + balance + tier responses cannot clear intent", () => {
    const intent = createIntent("HEADS", 1, 9);
    // Two overlapping stale refreshes.
    for (const startEpoch of [7, 8]) {
      assert.equal(
        shouldCommitSelectionRefresh({
          startEpoch,
          currentEpoch: 9,
          selAtStart: null,
          selNow: "HEADS",
          chainHasPosition: false,
        }),
        false
      );
    }
    // Room probe answering for the OTHER tier is stale for this intent.
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 10,
        responseIntentId: intent.intentId,
        chainHasPosition: false,
      }),
      false
    );
    // Balance/tier responses carry no chain position: nothing to commit.
    assert.equal(
      shouldCommitSelectionRefresh({
        startEpoch: 9,
        currentEpoch: 9,
        selAtStart: "HEADS",
        selNow: "HEADS",
        chainHasPosition: false,
      }),
      true
    );
    assert.equal(intentSelectedState(intent), "heads-selected");
  });

  it("failed background work preserves intent without chain position", () => {
    const heads = createIntent("HEADS", 1, 1);
    const tails = createIntent("TAILS", 1, 1);
    assert.equal(failedRefreshState({ intent: heads, hasChainPosition: false }), "heads-selected");
    assert.equal(failedRefreshState({ intent: tails, hasChainPosition: false }), "tails-selected");
    // Chain truth wins: queued/matched states fall back to error handling.
    assert.equal(failedRefreshState({ intent: heads, hasChainPosition: true }), null);
    assert.equal(failedRefreshState({ intent: null, hasChainPosition: false }), null);
  });

  it("selection survives longer than every polling interval", () => {
    const intent: SelectionIntent = createIntent("HEADS", 1, 1);
    // Simulate hundreds of failed/active refresh cycles over time; the
    // intent presentation must never flip while the user holds it.
    for (let i = 0; i < 500; i++) {
      assert.equal(
        failedRefreshState({ intent, hasChainPosition: false }),
        "heads-selected"
      );
      assert.equal(intentSide(intent), "HEADS");
    }
  });

  it("intentional side change replaces intent (no stale lock)", () => {
    const first = createIntent("HEADS", 1, 1);
    const second = createIntent("TAILS", 1, 2);
    assert.notEqual(first.intentId, second.intentId);
    // Picking never "clears" via the terminal path; the handler replaces it.
    assert.equal(shouldClearIntentOn("user-pick"), false);
    assert.equal(intentSelectedState(second), "tails-selected");
  });

  it("single rule: passive branches keep intent, otherwise fallback", () => {
    const heads = createIntent("HEADS", 1, 1);
    // Every neutral/error fallback is overridden while intent is pending.
    for (const fallback of ["ready", "error", "price-unavailable", "insufficient-balance", "paused"] as const) {
      assert.equal(
        resolvePassiveSelectionView({ intent: heads, hasChainPosition: false, fallback }),
        "heads-selected"
      );
    }
    const tails = createIntent("TAILS", 10, 2);
    assert.equal(
      resolvePassiveSelectionView({ intent: tails, hasChainPosition: false, fallback: "ready" }),
      "tails-selected"
    );
    // No intent (or chain truth): the honest fallback stands.
    assert.equal(
      resolvePassiveSelectionView({ intent: null, hasChainPosition: false, fallback: "error" }),
      "error"
    );
    assert.equal(
      resolvePassiveSelectionView({ intent: heads, hasChainPosition: true, fallback: "ready" }),
      "ready"
    );
  });

  it("central commit: stale responses never overwrite newer intent", () => {
    const intent = createIntent("HEADS", 1, 6);
    const ctx = { intent, currentEpoch: 6, currentTier: 1, hasChainPosition: false };
    // Stale epoch: preserve even though the response proposes ready.
    const staleEpoch = commitPassiveState(
      { proposedState: "ready", reason: "refresh-idle-state", responseEpoch: 5, responseTier: 1, responseIntentId: intent.intentId, chainHasPosition: false },
      ctx
    );
    assert.equal(staleEpoch.state, "heads-selected");
    assert.equal(staleEpoch.stale, true);
    assert.equal(staleEpoch.preserved, true);
    // Stale tier (room probe answered for $10): preserve.
    const staleTier = commitPassiveState(
      { proposedState: "ready", reason: "room-gate", responseEpoch: 6, responseTier: 10, responseIntentId: intent.intentId, chainHasPosition: false },
      ctx
    );
    assert.equal(staleTier.state, "heads-selected");
    assert.equal(staleTier.stale, true);
    // Stale intent id (older refresh): preserve.
    const staleIntent = commitPassiveState(
      { proposedState: "ready", reason: "refresh-no-account", responseEpoch: 6, responseTier: 1, responseIntentId: 9999, chainHasPosition: false },
      ctx
    );
    assert.equal(staleIntent.state, "heads-selected");
    assert.equal(staleIntent.stale, true);
    // Fresh response, no intent: proposed commits unchanged.
    const freshEmpty = commitPassiveState(
      { proposedState: "ready", reason: "refresh-no-account", responseEpoch: 6, responseTier: 1, responseIntentId: null, chainHasPosition: false },
      { intent: null, currentEpoch: 6, currentTier: 1, hasChainPosition: false }
    );
    assert.equal(freshEmpty.state, "ready");
    assert.equal(freshEmpty.stale, false);
    assert.equal(freshEmpty.preserved, false);
    // Fresh response, intent pending: intent wins.
    const freshIntent = commitPassiveState(
      { proposedState: "ready", reason: "refresh-idle-state", responseEpoch: 6, responseTier: 1, responseIntentId: intent.intentId, chainHasPosition: false },
      ctx
    );
    assert.equal(freshIntent.state, "heads-selected");
    assert.equal(freshIntent.stale, false);
    assert.equal(freshIntent.preserved, true);
    // Chain truth always wins over intent.
    const chain = commitPassiveState(
      { proposedState: "ready", reason: "refresh-idle-state", responseEpoch: 6, responseTier: 1, responseIntentId: intent.intentId, chainHasPosition: false },
      { ...ctx, hasChainPosition: true }
    );
    assert.equal(chain.state, "ready");
    assert.equal(chain.preserved, false);
  });

  it("terminal events still clear intent", () => {
    for (const reason of ["user-cancel", "join-success", "join-terminal-error", "room-switch", "chain-proven"] as const) {
      assert.equal(shouldClearIntentOn(reason), true);
    }
  });
});
