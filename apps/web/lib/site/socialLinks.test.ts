import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOCIAL_LINKS } from "./socialLinks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("social links", () => {
  it("exact official links", () => {
    assert.equal(SOCIAL_LINKS.x, "https://x.com/HeadsTailsFun");
    assert.equal(SOCIAL_LINKS.telegram, "https://t.me/HeadsTailsFun");
    assert.equal(SOCIAL_LINKS.discord, "https://discord.gg/ytQBSWD75J");
  });

  it("header has X/Discord/Telegram left of wallet", () => {
    const src = readFileSync(
      join(root, "components", "brand", "AppHeader.tsx"),
      "utf8",
    );
    assert.ok(src.includes("SOCIAL_LINKS.x"), "header X");
    assert.ok(src.includes("SOCIAL_LINKS.telegram"), "header Telegram");
    assert.ok(src.includes("SOCIAL_LINKS.discord"), "header Discord");
    assert.ok(src.includes('target="_blank"'), "new tab");
    assert.ok(src.includes('rel="noopener noreferrer"'), "safe rel");
  });

  it("footer has Telegram beside X and Discord", () => {
    const src = readFileSync(
      join(root, "components", "brand", "AppFooter.tsx"),
      "utf8",
    );
    assert.ok(src.includes("SOCIAL_LINKS.x"), "footer X");
    assert.ok(src.includes("SOCIAL_LINKS.telegram"), "footer Telegram");
    assert.ok(src.includes("SOCIAL_LINKS.discord"), "footer Discord");
  });
});
