import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createIntent,
  mayClearIntentForRefresh,
  shouldClearIntentOn,
} from "./selectionIntent.js";

describe("selection intent lock (reset/flicker fix)", () => {
  it("delayed refresh cannot clear HEADS selection", () => {
    const intent = createIntent("HEADS", 1, 5);
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: intent.intentId,
        chainHasPosition: false,
      }),
      false
    );
  });

  it("delayed refresh cannot clear TAILS selection", () => {
    const intent = createIntent("TAILS", 1, 5);
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: intent.intentId,
        chainHasPosition: false,
      }),
      false
    );
  });

  it("rapid confirm keeps selection (chain-proven clears explicitly)", () => {
    assert.equal(shouldClearIntentOn("user-pick"), false);
    assert.equal(shouldClearIntentOn("join-success"), true);
    assert.equal(shouldClearIntentOn("chain-proven"), true);
  });

  it("room switch intentionally resets selection", () => {
    assert.equal(shouldClearIntentOn("room-switch"), true);
  });

  it("stale async response from old room cannot mutate new room", () => {
    const intent = createIntent("HEADS", 10, 7);
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: intent.intentId,
        chainHasPosition: false,
      }),
      false
    );
  });

  it("chain-proven position always wins over intent", () => {
    const intent = createIntent("HEADS", 1, 5);
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: intent.intentId,
        chainHasPosition: true,
      }),
      true
    );
  });

  it("slow-mobile timing: mismatched intent id never clears", () => {
    const intent = createIntent("TAILS", 1, 9);
    assert.equal(
      mayClearIntentForRefresh({
        intent,
        responseTierUsd: 1,
        responseIntentId: intent.intentId + 1000,
        chainHasPosition: false,
      }),
      false
    );
  });
});
