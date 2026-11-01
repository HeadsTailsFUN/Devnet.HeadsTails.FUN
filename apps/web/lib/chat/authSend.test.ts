import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("P0 chat Send never opens Profile", () => {
  it("ChatPanel exposes async onEnsureAuth and never opens Profile", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    assert.ok(src.includes("onEnsureAuth"), "async auth callback exists");
    assert.ok(src.includes("Promise<boolean>"), "auth callback is async boolean");
    assert.ok(!src.includes("setProfileOpen"), "ChatPanel never touches Profile");
    assert.ok(!src.includes("setChatOpen(false)"), "ChatPanel never closes mobile chat");
    assert.ok(src.includes("Connect wallet to chat"), "compact wallet note preserved");
  });

  it("LiveGameClient wires inline auth-then-send (no Profile on Send)", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("ensureChatAuth"), "inline chat auth callback");
    assert.ok(src.includes("ensureSession(wallet, account)"), "uses existing ensureSession");
    assert.ok(src.includes("onEnsureAuth={ensureChatAuth}"), "ChatPanel gets inline auth");
    // Send path must not open Profile: no onNeedAuth profile wiring remains.
    assert.ok(!src.includes("onNeedAuth={() =>"), "no legacy profile-open wiring");
    // ChatPanel props blocks must not close chat or open profile on Send.
    // Only inspect the <ChatPanel ... /> props (up to the self-close), so the
    // surrounding dialog Close button and onSelectUser navigation are excluded.
    const chatBlocks = src
      .split("<ChatPanel")
      .slice(1)
      .map((b) => b.slice(0, b.indexOf("/>") + 2));
    for (const b of chatBlocks) {
      // onSelectUser navigation (username click -> public profile) is allowed
      // and still closes mobile chat; strip it before asserting the Send path.
      const sendProps = b.replace(/onSelectUser=\{[\s\S]*?\}\}/, "onSelectUser=STRIPPED");
      assert.ok(!sendProps.includes("setProfileOpen"), "Send path never opens Profile");
      assert.ok(!sendProps.includes("setChatOpen"), "mobile Chat stays open on Send");
      assert.ok(!sendProps.includes("onNeedAuth"), "no legacy auth callback wiring");
    }
    // Username click still opens public profile via inspectedWallet.
    assert.ok(src.includes("setInspectedWallet"), "username click still opens profile");
  });

  it("inline flow preserves draft, single send, no second click", () => {
    const src = readFileSync(join(root, "components", "chat", "ChatPanel.tsx"), "utf8");
    // Draft cleared only after confirmed success.
    const clearIdx = src.indexOf('setDraft("")');
    const okIdx = src.indexOf("if (!res.ok)");
    assert.ok(clearIdx > okIdx, "draft cleared after success");
    // Single-flight guard prevents double-click duplicates.
    assert.ok(src.includes("sendingRef.current"), "single-flight guard");
    // Rejected verification preserves draft (pending flag kept, early return).
    assert.ok(src.includes("pendingSendRef.current = true"), "preserves pending send on auth failure");
    // Enter key uses same send path.
    assert.ok(src.includes('e.key === "Enter"'), "Enter triggers send");
  });
});
