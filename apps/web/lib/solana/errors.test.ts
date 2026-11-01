import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyError, isRateLimitError, userMessageForCode } from "./errors.js";
import { normalizeSigningOutput } from "../../components/wallet/WalletProvider.js";

describe("wallet error classification", () => {
  it("maps 429 to RPC_RATE_LIMIT with retry message", () => {
    const e = new Error('429 : {"jsonrpc":"2.0","error":{"code":429,"message":"Connection rate limits exceeded"}}');
    assert.equal(isRateLimitError(e), true);
    const c = classifyError(e);
    assert.equal(c.code, "RPC_RATE_LIMIT");
    assert.equal(c.message, "Solana network is temporarily busy. Retrying…");
    assert.equal(c.retryable, true);
  });

  it("maps wallet rejection explicitly", () => {
    const c = classifyError(new Error("User rejected the request"));
    assert.equal(c.code, "WALLET_REJECTED");
  });

  it("never surfaces minified `e is not iterable`", () => {
    const c = classifyError(new TypeError("e is not iterable"));
    assert.equal(c.code, "WALLET_SIGNING_INVALID_OUTPUT");
    assert.ok(!c.message.includes("is not iterable"));
    assert.equal(
      c.message,
      "Your wallet could not sign this transaction correctly. Please reconnect and try again."
    );
  });

  it("maps unknown confirmation to checking status", () => {
    const c = classifyError(new Error("TRANSACTION_CONFIRMATION_UNKNOWN: timeout"));
    assert.equal(c.code, "TRANSACTION_CONFIRMATION_UNKNOWN");
    assert.equal(c.message, "Transaction submitted. Checking its on-chain status…");
  });

  it("accepts the official array signing shape", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = normalizeSigningOutput([{ signedTransaction: bytes }]);
    assert.ok(out instanceof Uint8Array);
    assert.equal(out.length, 3);
  });

  it("rejects empty signing output", () => {
    assert.throws(() => normalizeSigningOutput([]), /empty signing output/);
  });

  it("rejects malformed signing output without leaking internals", () => {
    const c = classifyError(new Error("WALLET_SIGNING_INVALID_OUTPUT: empty signing output"));
    assert.equal(c.code, "WALLET_SIGNING_INVALID_OUTPUT");
    assert.equal(userMessageForCode(c.code), "Your wallet could not sign this transaction correctly. Please reconnect and try again.");
  });

  it("rejects missing signedTransaction bytes", () => {
    assert.throws(() => normalizeSigningOutput([{}]), /signedTransaction/);
    assert.throws(() => normalizeSigningOutput([{ signedTransaction: new Uint8Array(0) }]), /empty/);
  });

  it("does not collapse everything into Something failed", () => {
    const codes = [
      "RPC_RATE_LIMIT",
      "WALLET_REJECTED",
      "WALLET_SIGNING_INVALID_OUTPUT",
      "TRANSACTION_CONFIRMATION_UNKNOWN",
    ] as const;
    for (const code of codes) {
      assert.notEqual(userMessageForCode(code), "Something failed");
    }
  });
});
