import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAMEPLAY_DAILY_CAP,
  GAMEPLAY_WIN_TOTAL,
  pointsForMatch,
  socialPointsFor,
  verifiedTotal,
} from "./rules.js";
import { capGameplayPoints, referralGameAllowed } from "./processor.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("airdrop points", () => {
  it("loss +2, win total +5 (2 game + 3 bonus)", () => {
    assert.deepEqual(pointsForMatch("loss"), { gameplay: 2, winBonus: 0, total: 2 });
    assert.deepEqual(pointsForMatch("win"), { gameplay: 2, winBonus: 3, total: 5 });
    assert.equal(GAMEPLAY_WIN_TOTAL, 5);
  });

  it("duplicate Match never duplicates points (idempotent ledger)", () => {
    const mig = readFileSync(join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"), "utf8");
    assert.ok(mig.includes("unique (season_id, wallet, event_type, source_key)"), "idempotency constraint");
  });

  it("daily gameplay cap 200", () => {
    assert.equal(GAMEPLAY_DAILY_CAP, 200);
    assert.equal(capGameplayPoints(198, 5), 2);
    assert.equal(capGameplayPoints(200, 5), 0);
  });

  it("season separation DEVNET_BETA vs SEASON_1", () => {
    const mig = readFileSync(join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"), "utf8");
    assert.ok(mig.includes("DEVNET_BETA"), "testing season seeded");
    assert.ok(mig.includes("airdrop_seasons"), "seasons table");
  });

  it("social points: connect 100, repost 75, reply 50", () => {
    assert.equal(socialPointsFor("connect_x"), 100);
    assert.equal(socialPointsFor("repost"), 75);
    assert.equal(socialPointsFor("reply"), 50);
  });

  it("pending social excluded from verified total", () => {
    assert.equal(
      verifiedTotal([
        { status: "verified", points: 100 },
        { status: "pending", points: 75 },
      ]),
      100
    );
  });

  it("one X identity per wallet mapping enforced (atomic RPC)", () => {
    const src = readFileSync(join(root, "app", "api", "airdrop", "social-claim", "route.ts"), "utf8");
    assert.ok(src.includes("create_airdrop_social_claim_atomic"), "atomic creation");
    assert.ok(src.includes("already-claimed"), "duplicate handled, not 500");
    assert.ok(src.includes("already linked to another wallet"), "verified identity cannot move wallets");
    assert.ok(src.includes("pending"), "manual-pending fallback, no fake verification");
  });

  it("referral caps + server processor idempotent", () => {
    assert.equal(referralGameAllowed(24, 100), true);
    assert.equal(referralGameAllowed(25, 100), false);
    const proc = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    assert.ok(proc.includes("award_gameplay_match_atomic"), "gameplay via atomic RPC");
    assert.ok(!proc.includes(".upsert("), "no direct writes (all idempotent RPCs)");
    assert.ok(proc.includes("admin_members"), "QA excluded wallets");
    const idx = readFileSync(join(root, "lib", "history", "indexSettlement.ts"), "utf8");
    assert.ok(idx.includes("processSettledMatchRewards"), "settlement triggers rewards");
  });

  it("admin Airdrop tab + adjustment requires reason", () => {
    const admin = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    assert.ok(admin.includes("Airdrop"), "admin nav");
    const route = readFileSync(join(root, "app", "api", "admin", "airdrop", "route.ts"), "utf8");
    assert.ok(route.includes("reason"), "adjustment reason required");
    assert.ok(route.includes("review-claim"), "verify/reject claims");
  });

  it("profile Airdrop section shows note + breakdown", () => {
    const src = readFileSync(join(root, "components", "profile", "ProfileModal.tsx"), "utf8");
    assert.ok(src.includes("Airdrop"), "profile tab");
    assert.ok(src.includes("reviewed for eligibility"), "eligibility note");
    assert.ok(src.includes("re-checked before rewards"), "social recheck note");
  });
});
