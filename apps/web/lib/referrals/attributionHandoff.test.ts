import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * HT-FINAL-002 regression: open referral link → connect → Profile Referrals
 * → Verify wallet → attribution POST fires → row created.
 *
 * Root cause was the parent/child session handoff: LiveGameClient's
 * attribution effect required `sessionWallet`, but Profile's
 * useAuthedFetch(... reload(true)) called ensureSession without notifying
 * the parent. Fixed with a centralized session event (no polling).
 */
describe("HT-FINAL-002 referral auth handoff", () => {
  it("ensureSession notifies the shared session event on success", () => {
    const src = readFileSync(join(root, "lib", "auth", "client.ts"), "utf8");
    assert.ok(src.includes("notifySessionEstablished"), "notifies on verify success");
    assert.ok(src.includes("sessionEvents"), "uses shared event module");
  });

  it("logout clears parent session state via event", () => {
    const src = readFileSync(join(root, "lib", "auth", "client.ts"), "utf8");
    assert.ok(src.includes("notifySessionCleared"), "clears on logout");
  });

  it("sessionEvents exposes subscribe helpers (no polling)", () => {
    const src = readFileSync(join(root, "lib", "auth", "sessionEvents.ts"), "utf8");
    assert.ok(src.includes("SESSION_ESTABLISHED_EVENT"), "established event");
    assert.ok(src.includes("subscribeSessionEstablished"), "subscribe helper");
    assert.ok(!src.includes("setInterval"), "no polling");
    assert.ok(!src.includes("setTimeout"), "no timer hacks");
  });

  it("LiveGameClient refreshes sessionWallet on the shared event", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("subscribeSessionEstablished"), "parent subscribes");
    assert.ok(src.includes("reloadSession()"), "parent refreshes session");
    assert.ok(!src.includes("setInterval(() => void currentSessionWallet"), "no session polling");
  });

  it("attribution effect still guards terminal vs retryable outcomes", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("/api/referrals/attribute"), "attribution POST fires");
    assert.ok(src.includes('"attributed"'), "terminal success clears");
    assert.ok(src.includes('"already-attributed"'), "immutable already-attributed clears");
    assert.ok(src.includes("refAttrRef.current = null"), "retryable keeps pending ref");
  });

  it("attribute API stays immutable + self-ref blocked + session-gated", () => {
    const src = readFileSync(join(root, "app", "api", "referrals", "attribute", "route.ts"), "utf8");
    assert.ok(src.includes("getSessionWallet"), "session-gated");
    assert.ok(src.includes("self referral blocked"), "self-ref blocked");
    assert.ok(src.includes("already-attributed"), "immutable");
  });
});
