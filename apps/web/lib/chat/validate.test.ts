import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  CHAT_MAX_CHARS,
  CHAT_MAX_PER_MINUTE,
  CHAT_MIN_INTERVAL_MS,
  isSafeText,
  rateLimitCheck,
  validateBody,
} from "./validate.js";

describe("chat validation", () => {
  it("unauthenticated-style blank input rejected", () => {
    assert.equal(validateBody("   ").ok, false);
    assert.equal(validateBody("").ok, false);
    assert.equal(validateBody(123).ok, false);
  });

  it("authenticated send works for normal text + emoji", () => {
    const r = validateBody("hello degens 🎲");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.body, "hello degens 🎲");
  });

  it("message rate limit: 1/sec then 20/min", () => {
    const fast = rateLimitCheck({ lastSentAtMs: 1000, sentInLastMinute: 0 }, 1500);
    assert.equal(fast.ok, false);
    if (!fast.ok) assert.ok(fast.retryAfterMs > 0 && fast.retryAfterMs <= CHAT_MIN_INTERVAL_MS);
    const perMin = rateLimitCheck({ lastSentAtMs: 0, sentInLastMinute: CHAT_MAX_PER_MINUTE }, 61_000);
    assert.equal(perMin.ok, false);
    const ok = rateLimitCheck({ lastSentAtMs: 0, sentInLastMinute: 3 }, 61_000);
    assert.equal(ok.ok, true);
  });

  it("max length enforced in characters", () => {
    assert.equal(validateBody("x".repeat(CHAT_MAX_CHARS)).ok, true);
    assert.equal(validateBody("x".repeat(CHAT_MAX_CHARS + 1)).ok, false);
    assert.equal(validateBody("🎲".repeat(281)).ok, false);
  });

  it("HTML rendered as text (never executed)", () => {
    const evil = '<img src=x onerror=alert(1)>';
    const r = validateBody(evil);
    assert.equal(r.ok, true); // accepted as TEXT
    if (r.ok) assert.equal(r.body, evil); // stored verbatim; React escapes on render
    assert.equal(isSafeText(evil), true);
    assert.equal(isSafeText("a\0b"), false);
  });
});
