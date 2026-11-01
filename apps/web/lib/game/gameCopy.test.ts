import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { queuePositionText } from "./uiGuards.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("simplified gameplay copy", () => {
  it("queue labels use simple game language", () => {
    assert.equal(queuePositionText("TAILS", 3), "#3 In Queue");
    assert.equal(queuePositionText("HEADS", 1), "#1 In Queue");
  });

  it("unknown position never invents a number", () => {
    assert.equal(queuePositionText("TAILS", null), "In Queue");
    assert.equal(queuePositionText("HEADS", undefined), "In Queue");
  });

  it("GameStatePanel uses Confirm / Leave and no Match Settled", () => {
    const src = readFileSync(join(root, "components", "game", "GameStatePanel.tsx"), "utf8");
    assert.ok(/>\s*Confirm\s*</.test(src), "Confirm button");
    assert.ok(/>\s*Leave\s*</.test(src), "Leave button");
    assert.ok(!src.includes("Leave queue (exact refund)"), "old Leave copy gone");
    assert.ok(!src.includes("Confirm") || !src.includes("join queue"), "no technical confirm suffix");
    assert.ok(!src.includes("Match Settled"), "Match Settled removed from normal UX");
    assert.ok(!src.includes("Match settled"), "no lowercase variant in normal UX");
    assert.ok(!src.includes("exact refund"), "no exact-refund jargon");
    assert.ok(!src.includes("permissionless"), "no infra jargon");
    assert.ok(src.includes("You Selected HEADS"), "simplified HEADS queue title");
    assert.ok(src.includes("You Selected TAILS"), "simplified TAILS queue title");
    assert.ok(src.includes("Waiting for a player..."), "simplified queue body");
    assert.ok(src.includes("Pick a side"), "simplified ready");
    assert.ok(src.includes("Match Found"), "simplified match");
    assert.ok(src.includes("Flipping..."), "simplified VRF wait");
    const live = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(live.includes("Payout sent"), "winner payout line");
    assert.ok(src.includes("settleLine"), "payout line rendered via settleLine");
  });

  it("LiveGameClient user-facing details avoid infra jargon", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(!src.includes("oldest player on the opposite side"), "old queue detail gone");
    assert.ok(!src.includes("exact refund"), "no exact refund");
    assert.ok(!src.includes("Match settled"), "no Match settled detail");
    assert.ok(!src.includes("requesting verifiable randomness"), "no VRF internals");
  });
});
