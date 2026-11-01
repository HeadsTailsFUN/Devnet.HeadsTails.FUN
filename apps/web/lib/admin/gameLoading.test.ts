import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * HT-FINAL-004: Admin Overview Game + Game tab must never hang on infinite
 * Loading after a failed /api/admin/game request. UI supports
 * loading/success/error/retry with a safe generic copy.
 */
describe("HT-FINAL-004 admin game loading states", () => {
  it("OverviewTab supports loading/success/error/retry (no infinite Loading)", () => {
    const src = readFileSync(join(root, "components", "admin", "AdminTabsA.tsx"), "utf8");
    assert.ok(src.includes("AdminGameLoad"), "terminal state type");
    assert.ok(src.includes('status: "loading"'), "loading state");
    assert.ok(src.includes('status: "success"'), "success state");
    assert.ok(src.includes('status: "error"'), "error state");
    assert.ok(src.includes("Could not load on-chain game state."), "safe error copy");
    assert.ok(src.includes("Retry"), "retry affordance");
    assert.ok(src.includes("onClick={() => void loadGame()}"), "retry recovers");
  });

  it("GameTab supports loading/success/error/retry (no infinite Loading)", () => {
    const src = readFileSync(join(root, "components", "admin", "AdminTabsB.tsx"), "utf8");
    assert.ok(src.includes("AdminGameTabLoad"), "terminal state type");
    assert.ok(src.includes('status: "error"'), "error state");
    assert.ok(src.includes("Could not load on-chain game state."), "safe error copy");
    assert.ok(src.includes("Retry"), "retry affordance");
    assert.ok(src.includes("onClick={() => void load()}"), "retry recovers");
  });

  it("game API fails closed with safe statuses (401/403/503, no secrets)", async () => {
    const src = readFileSync(join(root, "app", "api", "admin", "game", "route.ts"), "utf8");
    assert.ok(src.includes("checkStaff(req, false)"), "staff gate preserved");
    // HT-OBS: failures go through the fail() helper (real 503s + safe
    // GAME_* diagnostic) — terminal responses, never a hang.
    assert.ok(src.includes("fail(503,"), "terminal 503 helper, not a hang");
    assert.ok(src.includes("diagnostic"), "machine-readable code attached");
    // The route reads RPC via the getServerConnection() helper (never echoes
    // keys); the JSON payload carries authority/paused/counters or a safe
    // error string only.
    assert.ok(!src.includes("process.env.SOLANA_SERVER_RPC_URL"), "no direct server-key read");
    assert.ok(!src.includes('"secret'), "no secret key in payload");
    // Unauthenticated access is denied (never a hanging success).
    const { GET } = await import("../../app/api/admin/game/route.js");
    const res = await GET(new Request("http://x/api/admin/game"));
    assert.ok([401, 403, 503].includes(res.status), `denied/unavailable, got ${res.status}`);
  });
});
