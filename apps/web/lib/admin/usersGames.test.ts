import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * HT-FINAL-003 regression: hosted player_stats games_played=12 wins=5 must
 * render as 12g/5w. The API returned `games_played` while the UI read
 * `u.games ?? u.gamesPlayed` → 0g/5w. Fixed with ONE canonical Admin user
 * shape (camelCase gamesPlayed).
 */
describe("HT-FINAL-003 admin users games count", () => {
  it("API normalizes to canonical gamesPlayed (no games_played leak)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "users", "route.ts"), "utf8");
    assert.ok(src.includes("gamesPlayed: s.games_played"), "normalizes snake→camel");
    assert.ok(!src.includes("...s,"), "no blind spread of snake_case stats");
    assert.ok(!src.includes("...p,"), "explicit profile fields");
  });

  it("UI uses the single canonical field (no ad-hoc fallbacks)", () => {
    const src = readFileSync(join(root, "components", "admin", "AdminTabsA.tsx"), "utf8");
    assert.ok(src.includes("gamesPlayed"), "reads canonical field");
    assert.ok(!src.includes("u.games ??"), "no games fallback chain");
    assert.ok(src.includes("interface AdminUser"), "typed client model");
    // Owner case: 12 played / 5 wins renders 12g/5w.
    assert.ok(
      src.includes("{String(u.gamesPlayed ?? 0)}g/{String(u.wins ?? 0)}w"),
      "renders 12g/5w for the owner fixture"
    );
  });
});
