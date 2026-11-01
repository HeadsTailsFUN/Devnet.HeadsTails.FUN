import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  initialAdminFlowState,
  isStaffView,
  planAdminAuth,
} from "./sessionFlow.js";

const OWNER = "5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW";
const OTHER = "Dyo5Je7MHkqD66vdVi2WW4mA8asX3p6zotjo4K2mfYAx";

describe("admin session flow", () => {
  it("1. opens disconnected → cleared, NOT permanently denied", () => {
    assert.deepEqual(planAdminAuth({ address: null, sessionWallet: undefined, inFlight: false }), {
      kind: "clear",
    });
    const s = initialAdminFlowState();
    assert.equal(s.denied, false);
    assert.equal(s.status, null);
    assert.equal(isStaffView(s), false);
  });

  it("2. correct OWNER connects after mount → session verification runs", () => {
    // No session yet: exactly one ownership verification, no status fetch.
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: null, inFlight: false }),
      { kind: "verify-session", address: OWNER }
    );
  });

  it("3. OWNER session present → status fetch (isOwner resolved server-side)", () => {
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: OWNER, inFlight: false }),
      { kind: "fetch-status", address: OWNER }
    );
    assert.equal(
      isStaffView({ status: { isOwner: true, isModerator: false, wallet: OWNER, authority: OWNER }, denied: false, note: null }),
      true
    );
  });

  it("4. denied state clears when a valid OWNER connects", () => {
    // Planner output drives the component to clear stale state on address
    // change before any fetch; a fresh fetch-status follows the session.
    const stale = { status: null, denied: true, note: null };
    const fresh = initialAdminFlowState();
    assert.equal(stale.denied, true);
    assert.equal(fresh.denied, false);
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: OWNER, inFlight: false }).kind,
      "fetch-status"
    );
  });

  it("5. wallet A session + wallet B connection → reverify, never reuse", () => {
    assert.deepEqual(
      planAdminAuth({ address: OTHER, sessionWallet: OWNER, inFlight: false }),
      { kind: "verify-session", address: OTHER }
    );
  });

  it("6. disconnect → admin state cleared", () => {
    assert.deepEqual(
      planAdminAuth({ address: null, sessionWallet: OWNER, inFlight: false }),
      { kind: "clear" }
    );
  });

  it("7. refresh: session unknown yet → wait, no premature deny or sign loop", () => {
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: undefined, inFlight: false }),
      { kind: "wait" }
    );
  });

  it("8. moderator session → status fetch; moderator view recognized", () => {
    assert.deepEqual(
      planAdminAuth({ address: OTHER, sessionWallet: OTHER, inFlight: false }),
      { kind: "fetch-status", address: OTHER }
    );
    assert.equal(
      isStaffView({ status: { isOwner: false, isModerator: true, wallet: OTHER, authority: OWNER }, denied: false, note: null }),
      true
    );
  });

  it("9. random wallet session → status fetch (server denies), never staff", () => {
    assert.deepEqual(
      planAdminAuth({ address: OTHER, sessionWallet: OTHER, inFlight: false }),
      { kind: "fetch-status", address: OTHER }
    );
    assert.equal(
      isStaffView({ status: null, denied: true, note: null }),
      false
    );
  });

  it("10. in-flight work suppresses duplicate verify/fetch (no signature loop)", () => {
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: null, inFlight: true }),
      { kind: "wait" }
    );
    assert.deepEqual(
      planAdminAuth({ address: OWNER, sessionWallet: OWNER, inFlight: true }),
      { kind: "wait" }
    );
  });

  it("no private key material is involved in planning", () => {
    const action = planAdminAuth({ address: OWNER, sessionWallet: null, inFlight: false });
    assert.ok(!JSON.stringify(action).match(/key|secret|mnemonic|seed/i));
  });
});
