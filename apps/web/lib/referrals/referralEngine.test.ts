import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { referralCapsAllow, referralRewardForGameCount } from "./logic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("referral engine (exact schedule)", () => {
  it("game #1: nothing", () => {
    assert.deepEqual(referralRewardForGameCount(1), { qualify: false, perGame: false });
  });

  it("game #2: nothing", () => {
    assert.deepEqual(referralRewardForGameCount(2), { qualify: false, perGame: false });
  });

  it("game #3: qualification only (no +2)", () => {
    assert.deepEqual(referralRewardForGameCount(3), { qualify: true, perGame: false });
  });

  it("game #4: first +2 (no re-qualification)", () => {
    assert.deepEqual(referralRewardForGameCount(4), { qualify: false, perGame: true });
  });

  it("game #5: +2 continues", () => {
    assert.deepEqual(referralRewardForGameCount(5), { qualify: false, perGame: true });
  });

  it("per-invitee caps are independent (A=25 blocked, B allowed)", () => {
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 25, referrerRecurringPointsToday: 50 }),
      false,
      "A at cap blocked"
    );
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 0, referrerRecurringPointsToday: 50 }),
      true,
      "B independent allowed"
    );
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 24, referrerRecurringPointsToday: 0 }),
      true,
      "24 recurring events + qualification row still allowed once"
    );
  });

  it("recurring cap is prospective: 498 allowed, 499 blocked (no 501)", () => {
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 0, referrerRecurringPointsToday: 498 }),
      true,
      "498 + 2 = 500 fits"
    );
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 0, referrerRecurringPointsToday: 499 }),
      false,
      "499 + 2 = 501 blocked"
    );
    assert.equal(
      referralCapsAllow({ inviteeGameEventsToday: 0, referrerRecurringPointsToday: 500 }),
      false
    );
  });

  it("qualification +50 is guaranteed (excluded from the recurring cap)", () => {
    // The +50 path never consults referralCapsAllow: only the Game schema
    // (referralRewardForGameCount) gates it. Source-level proof:
    const src = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    const qualifyBlock = src.slice(src.indexOf("referral_qualify_referrer") - 2000, src.indexOf("referral_qualify_referrer"));
    assert.ok(!qualifyBlock.includes("referralCapsAllow"), "+50 never capped");
  });

  it("processor implements game#4 rule + atomic referral_game-only caps", () => {
    const src = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    assert.ok(src.includes("referralRewardForGameCount"), "exact schedule, not games >= 3");
    assert.ok(!/if \(games >= 3\)/.test(src), "old game#3 double-reward gone");
    assert.ok(src.includes("award_referral_game_atomic"), "per-game via atomic RPC");
    assert.ok(src.includes("qualify_referral_atomic"), "qualification via atomic RPC");
    assert.ok(src.includes("reward_exclusions"), "QA/abuse exclusion table");
    const sql = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"),
      "utf8"
    );
    assert.ok(sql.includes("and event_type = 'referral_game'"), "cap query restricted to referral_game in SQL");
    assert.ok(sql.includes("metadata->>'invitee' = p_invitee"), "per-invitee independence in SQL");
  });

  it("profile referral points are season-scoped", () => {
    const src = readFileSync(join(root, "app", "api", "referrals", "mine", "route.ts"), "utf8");
    assert.ok(src.includes('eq("season_id"'), "season filter on ledger sum");
    assert.ok(src.includes("season"), "season echoed for regression");
  });
});
