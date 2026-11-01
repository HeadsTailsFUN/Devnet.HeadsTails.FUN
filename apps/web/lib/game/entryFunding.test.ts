import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  ExistingTokenAdapter,
  MockSolSwapAdapter,
  describeQuote,
} from "./entryFunding.js";

describe("entry funding adapters (Pay with SOL DEVNET MOCK)", () => {
  it("sufficient token defaults to Game Token path", async () => {
    const adapter = new ExistingTokenAdapter();
    const q = await adapter.quote(1, BigInt(1000000));
    assert.equal(q.method, "token");
    assert.equal(q.isMock, false);
    assert.equal(adapter.isExpired(q), false);
  });

  it("insufficient token offers SOL mock path", async () => {
    const adapter = new MockSolSwapAdapter();
    const q = await adapter.quote(1, BigInt(1000000));
    assert.equal(q.method, "sol");
    assert.equal(q.isMock, true);
  });

  it("devnet clearly says mock (never a fake real swap)", async () => {
    const adapter = new MockSolSwapAdapter();
    const q = await adapter.quote(1, BigInt(1000000));
    assert.match(q.source, /MOCK/);
    assert.match(describeQuote(q), /Pay with SOL/);
  });

  it("mock quote expiry handled fail-closed", async () => {
    const adapter = new MockSolSwapAdapter({ quoteTtlMs: 1 });
    const q = await adapter.quote(1, BigInt(1000000));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(adapter.isExpired(q), true);
  });

  it("room stake changes quote ($10 is 10x $1)", async () => {
    const adapter = new MockSolSwapAdapter();
    const q1 = await adapter.quote(1, BigInt(1000000));
    const q10 = await adapter.quote(10, BigInt(10000000));
    assert.equal(q10.requiredTokenBaseUnits, q1.requiredTokenBaseUnits * BigInt(10));
    assert.ok((q10.solLamports ?? BigInt(0)) > (q1.solLamports ?? BigInt(0)));
  });

  it("no custodial website-wallet transfer path introduced", async () => {
    // The mock adapter exposes quote-only state: no custodial recipient,
    // no transfer method, no secret handling.
    const adapter = new MockSolSwapAdapter();
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
    assert.ok(!keys.includes("transfer"));
    assert.ok(!keys.includes("sendToTreasury"));
    assert.ok(!keys.includes("custody"));
    const q = await adapter.quote(1, BigInt(1000000));
    assert.ok(!("recipient" in q) && !("treasury" in q));
  });
});

