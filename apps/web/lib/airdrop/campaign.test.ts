import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { campaignPostUrl, normalizeCampaignUrl } from "./campaign.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("X campaign post gating", () => {
  it("unconfigured campaign returns null (honest disabled state)", () => {
    delete process.env.NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL;
    delete process.env.AIRDROP_X_CAMPAIGN_URL;
    assert.equal(campaignPostUrl(), null);
  });

  it("accepts official post links and rejects spoofed hosts, profiles, credentials and other accounts",()=>{
    assert.equal(normalizeCampaignUrl("https://twitter.com/HeadsTailsFun/status/123?s=20"),"https://x.com/HeadsTailsFun/status/123");
    for(const url of ["javascript:alert(1)","http://x.com/HeadsTailsFun/status/123","https://x.com.evil.invalid/HeadsTailsFun/status/123","https://u:p@x.com/HeadsTailsFun/status/123","https://x.com/other/status/123","https://x.com/HeadsTailsFun"])assert.equal(normalizeCampaignUrl(url),null);
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
