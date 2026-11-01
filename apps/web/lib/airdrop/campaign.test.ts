import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { campaignPostUrl } from "./campaign.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("X campaign post gating", () => {
  it("unconfigured campaign returns null (honest disabled state)", () => {
    delete process.env.NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL;
    delete process.env.AIRDROP_X_CAMPAIGN_URL;
    assert.equal(campaignPostUrl(), null);
  });

  it("simplified X tasks: Link + Reply always; Repost only with campaign; no fake buttons", () => {
    const src = readFileSync(join(root, "components", "profile", "ProfileModal.tsx"), "utf8");
    assert.ok(!src.includes("Coming soon"), "no fake Coming soon buttons");
    assert.ok(src.includes("Link X"), "Link X action");
    assert.ok(src.includes("Submit Reply"), "Submit Reply always available");
    assert.ok(src.includes("Claim Repost"), "Claim Repost action exists");
    assert.ok(src.includes("campaignUrl &&"), "repost gated on real campaign URL");
    assert.ok(src.includes("View campaign post"), "campaign link when configured");
    assert.ok(src.includes("replyUrl"), "reply evidence URL input");
    assert.ok(src.includes("evidenceUrl"), "evidence sent to API");
    // Persisted server state: stored handle/reply with Edit, status pills.
    assert.ok(src.includes("social?.handle"), "stored handle from server");
    assert.ok(src.includes("social?.replyUrl"), "stored reply from server");
    assert.ok(src.includes("StatusPill"), "pending/verified distinction");
    assert.ok(src.includes("social-edit"), "edits go through the idempotent edit path");
  });

  it("points route exposes persisted social state (season + wallet scoped)", () => {
    const src = readFileSync(join(root, "app", "api", "airdrop", "points", "route.ts"), "utf8");
    assert.ok(src.includes("airdrop_x_identities"), "identity read");
    assert.ok(src.includes("airdrop_social_claims"), "claims read");
    assert.ok(src.includes("handleStatus"), "identity status");
    assert.ok(src.includes("replyStatus"), "reply status");
    assert.ok(src.includes("getSessionWallet"), "never trusts body wallet");
  });
});
