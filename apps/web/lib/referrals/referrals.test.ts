import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidReferralCode, normalizeReferralCode, referralCodeForWallet } from "./code.js";
import {
  canAttribute,
  isSelfReferral,
  qualificationRewards,
  referredGamePoints,
  shouldQualify,
  withinDailyCap,
  REFERRAL_MAX_PER_INVITEE_PER_DAY,
  REFERRAL_MAX_PER_REFERRER_PER_DAY,
} from "./logic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("referrals", () => {
  it("stable unique code per wallet", () => {
    const a = referralCodeForWallet("WalletA");
    const b = referralCodeForWallet("WalletB");
    assert.equal(a, referralCodeForWallet("WalletA"));
    assert.notEqual(a, b);
    assert.ok(isValidReferralCode(a));
    assert.equal(normalizeReferralCode(a.toLowerCase()), a);
  });

  it("self-referral blocked", () => {
    assert.equal(isSelfReferral("W", "W"), true);
    assert.equal(isSelfReferral("A", "B"), false);
  });

  it("attribution immutable (never overwrite)", () => {
    assert.equal(canAttribute(null), true);
    assert.equal(canAttribute("Someone"), false);
  });

  it("qualification at 3 eligible settled games", () => {
    assert.equal(shouldQualify(2), false);
    assert.equal(shouldQualify(3), true);
    assert.deepEqual(qualificationRewards(), { invitee: 25, referrer: 50 });
    assert.equal(referredGamePoints(), 2);
  });

  it("daily caps enforced", () => {
    assert.equal(withinDailyCap(24, REFERRAL_MAX_PER_INVITEE_PER_DAY), true);
    assert.equal(withinDailyCap(25, REFERRAL_MAX_PER_INVITEE_PER_DAY), false);
    assert.equal(withinDailyCap(499, REFERRAL_MAX_PER_REFERRER_PER_DAY), true);
    assert.equal(withinDailyCap(500, REFERRAL_MAX_PER_REFERRER_PER_DAY), false);
  });

  it("API derives referrer server-side, session-gated, RLS", () => {
    const src = readFileSync(join(root, "app", "api", "referrals", "attribute", "route.ts"), "utf8");
    assert.ok(src.includes("getSessionWallet"), "verified session");
    assert.ok(src.includes('from("referral_codes")'), "server-side code resolution");
    assert.ok(src.includes("self referral blocked"), "self-ref blocked");
    assert.ok(src.includes("already-attributed"), "immutable attribution");
    const mig = readFileSync(join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql"), "utf8");
    assert.ok(mig.includes("referral_attributions"), "migration has attributions");
    assert.ok(mig.includes("row level security") || mig.includes("enable row level security"), "RLS on");
  });

  it("admin Referrals tab exists", () => {
    const admin = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    assert.ok(admin.includes("Referrals"), "admin nav has Referrals");
    const tabs = readFileSync(join(root, "components", "admin", "AdminTabsC.tsx"), "utf8");
    assert.ok(tabs.includes("ReferralsTab"), "referrals admin component");
  });

  it("profile has Referrals section with copy + stats", () => {
    const src = readFileSync(join(root, "components", "profile", "ProfileModal.tsx"), "utf8");
    assert.ok(src.includes("Referrals"), "profile tab");
    assert.ok(src.includes("Copy"), "copy button");
    assert.ok(src.includes("Qualified"), "qualified stat");
  });

  // Retry-safe attribution: pending ref clears ONLY on terminal success.
  it("client clears pending ref only on attributed/already-attributed (never on retryable HTTP)", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(!src.includes(".then(() => m.clearPendingReferral())"), "no blind clear on fetch resolve");
    assert.ok(src.includes('"attributed"'), "clears on attributed");
    assert.ok(src.includes('"already-attributed"'), "clears on already-attributed");
    assert.ok(src.includes("self referral"), "self-ref terminal clear");
    assert.ok(src.includes("refAttrRef.current = null"), "retryable failure resets in-flight guard, keeps storage");
  });

  it("mine exposes invitee progress + pending invites (verified gameplay_match count)", () => {
    const src = readFileSync(join(root, "app", "api", "referrals", "mine", "route.ts"), "utf8");
    assert.ok(src.includes("myReferral"), "invitee progress block");
    assert.ok(src.includes("pendingInvites"), "pending invites count");
    assert.ok(src.includes('eq("event_type", "gameplay_match")'), "counts gameplay_match markers");
    const proc = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    assert.ok(proc.includes('eq("event_type", "gameplay_match")'), "processor counts markers, not just positive points");
    const ui = readFileSync(join(root, "components", "profile", "ProfileModal.tsx"), "utf8");
    assert.ok(ui.includes("eligible games completed"), "invitee progress copy");
    assert.ok(ui.includes("pending qualification"), "referrer pending copy");
  });
});
