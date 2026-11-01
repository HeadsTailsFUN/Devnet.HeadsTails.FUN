import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bountyGuidance, isValidSeverity, sanitizeTelegram, sanitizeText, validateBugInput } from "./validate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("bug reports + bounty", () => {
  it("severity validation (user severity)", () => {
    assert.equal(isValidSeverity("Critical"), true);
    assert.equal(isValidSeverity("Bogus"), false);
  });

  it("sanitization strips HTML", () => {
    assert.equal(sanitizeText("<b>hi</b>  there", 100), "hi there");
    assert.equal(sanitizeTelegram("@user_1"), "user_1");
    assert.equal(sanitizeTelegram("bad handle!"), null);
  });

  it("validate input requires description + severity", () => {
    assert.equal(validateBugInput({ description: "short", severity: "Low" }).ok, false);
    const good = validateBugInput({ description: "App crashes on join with wallet connected", severity: "High", telegram: "@tester" });
    assert.equal(good.ok, true);
  });

  it("bounty guidance tiers", () => {
    assert.ok(bountyGuidance("Low").includes("$10"));
    assert.ok(bountyGuidance("Critical").includes("$200"));
  });

  it("authenticated submit, rate-limited, sanitized", () => {
    const src = readFileSync(join(root, "app", "api", "bugs", "submit", "route.ts"), "utf8");
    assert.ok(src.includes("getSessionWallet"), "auth required");
    assert.ok(src.includes("rate limited") || src.includes("rateLimited"), "rate limit");
    assert.ok(src.includes("validateBugInput"), "validation");
  });

  it("no auto-payout (metadata only; owner or full-admin approval)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "bugs", "route.ts"), "utf8");
    assert.ok(!src.includes("sendTransaction"), "no auto transfer");
    assert.ok(src.includes("checkWebAdmin"), "bounty/payout metadata via web-admin check");
    assert.ok(!src.includes("checkStaff(req, true)"), "no strict owner gate on metadata actions");
    const mig = readFileSync(join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"), "utf8");
    assert.ok(mig.includes("bug_bounties"), "bounty table");
    assert.ok(!/sendTransaction|SystemProgram\.transfer/i.test(mig), "no auto-payout in migration");
  });

  it("profile Report Bug + admin Bug Reports tabs", () => {
    const profile = readFileSync(join(root, "components", "profile", "ProfileModal.tsx"), "utf8");
    assert.ok(profile.includes("Report Bug"), "profile tab");
    assert.ok(profile.includes("Submit Report"), "submit button");
    assert.ok(profile.includes("Telegram"), "telegram field");
    const admin = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    assert.ok(admin.includes("Bug Reports"), "admin nav");
  });
});
