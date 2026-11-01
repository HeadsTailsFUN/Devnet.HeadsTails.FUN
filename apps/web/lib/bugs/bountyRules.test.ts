import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBountyInput, validatePayoutInput, validateTriageInput } from "./adminValidate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIG = "5".repeat(88);

describe("bug bounty rules (validation before DB)", () => {
  it("invalid status fails", () => {
    assert.equal(validateTriageInput({ status: "bogus" }).ok, false);
    assert.equal(validateTriageInput({ status: "triaged" }).ok, true);
  });

  it("invalid severity fails", () => {
    assert.equal(validateTriageInput({ admin_severity: "Extreme" }).ok, false);
    assert.equal(validateTriageInput({ admin_severity: "High" }).ok, true);
  });

  it("invalid reward type fails", () => {
    assert.equal(validateBountyInput({ reward_type: "eth" }).ok, false);
    assert.equal(validateBountyInput({ reward_type: "sol" }).ok, true);
  });

  it("mark paid without signature fails", () => {
    const out = validatePayoutInput({ reward_type: "sol", reward_amount_base_units: "100" });
    assert.equal(out.ok, false);
  });

  it("mark paid without amount fails", () => {
    const out = validatePayoutInput({ reward_type: "sol", payout_signature: SIG });
    assert.equal(out.ok, false);
    const zero = validatePayoutInput({ reward_type: "sol", reward_amount_base_units: "0", payout_signature: SIG });
    assert.equal(zero.ok, false);
  });

  it("mark paid without mint fails for project_token, passes for sol", () => {
    assert.equal(
      validatePayoutInput({ reward_type: "project_token", reward_amount_base_units: "100", payout_signature: SIG }).ok,
      false
    );
    assert.equal(
      validatePayoutInput({
        reward_type: "project_token",
        reward_amount_base_units: "100",
        payout_signature: SIG,
        reward_mint: "Mint111111111111111111111111111111111111111",
      }).ok,
      true
    );
    assert.equal(
      validatePayoutInput({ reward_type: "sol", reward_amount_base_units: "100", payout_signature: SIG }).ok,
      true
    );
  });

  it("valid payout metadata passes with server-side paid_at", () => {
    const out = validatePayoutInput({ reward_type: "sol", reward_amount_base_units: "2500000", payout_signature: SIG });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.patch.status, "paid");
      assert.ok(out.patch.paid_at, "paid_at set server-side");
    }
  });

  it("admin route checks every mutation error (no false success)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "bugs", "route.ts"), "utf8");
    assert.ok(src.includes("validateTriageInput"), "triage validated");
    assert.ok(src.includes("validateBountyInput"), "bounty validated");
    assert.ok(src.includes("validatePayoutInput"), "payout validated");
    const unchecked = (src.match(/await db\.from\("bug_(reports|bounties)"\)\.(update|upsert)/g) ?? []).length;
    const checked = (src.match(/if \(error\) return NextResponse\.json\(\{ error:/g) ?? []).length;
    assert.ok(unchecked > 0 && checked >= unchecked, "every mutation error-checked");
  });
});
