import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Pick Side loading copy removed", () => {
  it("LiveGameClient never initializes Loading placeholder", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(!src.includes('useState<string>("Loading'), "no Loading initial state");
    assert.ok(src.includes('"Pick Side"'), "ready default is Pick Side");
  });

  it("main status never exposes Live Devnet state", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(!src.includes("Live Devnet state"), "Live Devnet state removed from UX");
  });

  it("ready state shows Pick Side copy via GameStatePanel defaults", () => {
    const panel = readFileSync(join(root, "components", "game", "GameStatePanel.tsx"), "utf8");
    assert.ok(panel.includes("Pick a side"), "ready title");
    assert.ok(panel.includes("Waiting for a player..."), "queue body preserved");
  });

  it("genuine errors are not hidden", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("Insufficient SOL"), "sol error preserved");
    assert.ok(src.includes("Insufficient project tokens"), "token error preserved");
    const panel = readFileSync(join(root, "components", "game", "GameStatePanel.tsx"), "utf8");
    assert.ok(panel.includes("Action failed"), "error title preserved");
  });
});
