import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  SETTLEMENT_MAX_ATTEMPTS,
  SETTLEMENT_RETRY_DELAYS_MS,
  SETTLEMENT_STEADY_RETRY_MS,
} from "./settle.js";
import { isUserReimbursableAction } from "../solana/sponsorGate.js";

describe("durable auto-settlement", () => {
  it("retry progression is 2s,3s,5s,5s,10s,15s,30s then bounded steady retries", () => {
    assert.deepEqual(SETTLEMENT_RETRY_DELAYS_MS, [2000, 3000, 5000, 5000, 10000, 15000, 30000]);
    assert.equal(SETTLEMENT_STEADY_RETRY_MS, 60000);
    assert.ok(SETTLEMENT_MAX_ATTEMPTS >= 30 && SETTLEMENT_MAX_ATTEMPTS <= 240);
  });

  it("no tight RPC loops (minimum delay is seconds, not ms)", () => {
    assert.ok(Math.min(...SETTLEMENT_RETRY_DELAYS_MS) >= 1000);
  });

  it("user reimbursement excludes match/claim/settle (server-settled)", () => {
    assert.equal(isUserReimbursableAction("join"), true);
    assert.equal(isUserReimbursableAction("cancel"), true);
    assert.equal(isUserReimbursableAction("match"), false);
    assert.equal(isUserReimbursableAction("claim"), false);
    assert.equal(isUserReimbursableAction("settle"), false);
  });
});
