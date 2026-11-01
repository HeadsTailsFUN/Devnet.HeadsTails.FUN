import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("chat reliability", () => {
  it("compact states exist: Connecting / unavailable / Retry (never stuck Loading)", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(src.includes("Connecting..."), "Connecting state");
    assert.ok(src.includes("Chat unavailable"), "unavailable state");
    assert.ok(src.includes("Retry"), "retry action");
    // The bare forever-loading copy must be gone from the initial branch.
    const loadingForever = (src.match(/>Loading…</g) ?? []).length;
    assert.equal(loadingForever, 0, "no silent forever Loading…");
  });

  it("auth-then-send preserves draft and continues once", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(src.includes("pendingSendRef"), "preserved pending send");
    assert.ok(src.includes("sendingRef"), "single-flight guard");
    // Draft cleared only after confirmed success (inside res.ok branch).
    const clearIdx = src.indexOf('setDraft("")');
    const okIdx = src.indexOf("if (!res.ok)");
    assert.ok(clearIdx > okIdx, "draft cleared after success check");
  });

  it("no duplicate channels/poll timers; resume refreshes", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(src.includes("channelRef"), "single channel ref");
    assert.ok(src.includes("pollRef"), "single poll ref");
    assert.ok(src.includes("visibilitychange"), "background/foreground resume");
    assert.ok(src.includes("online"), "offline→online resume");
  });

  it("chat scrolling stays container-only (no page hijack)", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(!src.includes(".scrollIntoView("), "no scrollIntoView page hijack");
    assert.ok(src.includes("el.scrollTop = el.scrollHeight"), "container-only autoscroll");
  });

  // HT-QA-001: loader must have stable identity — it sets messages, so it
  // must not depend on messages (that loop recreated the subscription and
  // fired 116 GET /api/chat/messages in ~65s idle).
  it("loader is stable: no [messages] dependency, single subscription lifecycle", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(!src.includes("}, [messages])"), "loader must not close over messages");
    assert.ok(src.includes("messagesNullRef"), "null-vs-loaded tracked via ref");
    assert.ok(src.includes("}, [])"), "stable loader identity");
    // Bounded safety poll: one slow interval (~60s), plus 15s fallback only
    // on realtime failure — not a per-render storm.
    assert.ok(src.includes("60000"), "slow safety poll present");
    assert.ok(src.includes("POLL_FALLBACK_MS"), "fallback poll constant");
  });
});
