import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  buildAuthMessage,
  hashToken,
  isChallengeFresh,
  newNonce,
  newSessionToken,
} from "./message.js";

describe("auth challenge", () => {
  it("message is human-readable and binds wallet+nonce+expiry", () => {
    const c = {
      nonce: "abc",
      domain: "HeadsTails.fun",
      wallet: "WALLET",
      cluster: "devnet",
      issuedAt: "2026-09-23T00:00:00.000Z",
      expiresAt: "2026-09-23T00:10:00.000Z",
    };
    const m = buildAuthMessage(c);
    assert.ok(m.includes("HeadsTails.fun"));
    assert.ok(m.includes("WALLET"));
    assert.ok(m.includes("abc"));
    assert.ok(m.includes("devnet"));
    assert.ok(m.toLowerCase().includes("no funds"));
  });

  it("challenge expiry enforced", () => {
    assert.equal(isChallengeFresh({ expiresAt: new Date(Date.now() + 60000).toISOString() }), true);
    assert.equal(isChallengeFresh({ expiresAt: new Date(Date.now() - 1000).toISOString() }), false);
    assert.equal(isChallengeFresh({ expiresAt: "not-a-date" }), false);
  });

  it("replay rejected: single-use nonces are unique", () => {
    // Nonces must be unpredictable and unique per challenge.
    const seen = new Set([newNonce(), newNonce(), newNonce()]);
    assert.equal(seen.size, 3);
  });
});

describe("ownership signatures (Ed25519)", () => {
  it("valid signature verifies against the wallet", () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const msg = new TextEncoder().encode("HeadsTails.fun — wallet verification\nWallet: " + wallet);
    const sig = nacl.sign.detached(msg, kp.secretKey);
    assert.equal(nacl.sign.detached.verify(msg, sig, bs58.decode(wallet)), true);
  });

  it("wrong-wallet signature rejected", () => {
    const a = nacl.sign.keyPair();
    const b = nacl.sign.keyPair();
    const msg = new TextEncoder().encode("hello");
    const sig = nacl.sign.detached(msg, a.secretKey);
    assert.equal(nacl.sign.detached.verify(msg, sig, b.publicKey), false);
  });

  it("tampered message rejected", () => {
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(new TextEncoder().encode("a"), kp.secretKey);
    assert.equal(nacl.sign.detached.verify(new TextEncoder().encode("b"), sig, kp.publicKey), false);
  });

  it("session tokens are opaque hashes", () => {
    const t = newSessionToken();
    assert.equal(t.length, 64);
    assert.equal(hashToken(t).length, 64);
    assert.notEqual(hashToken(t), t);
  });
});
