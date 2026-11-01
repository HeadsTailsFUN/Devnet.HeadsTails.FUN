import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeUsername, validateUsername } from "./username.js";
import { validateAvatar } from "./avatar.js";
import { displayRank, isValidRankOverride, rankForGames } from "../ranks.js";

describe("usernames", () => {
  it("accepts valid names, preserves case, normalizes for uniqueness", () => {
    const r = validateUsername("Degen_King7");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.normalized, "degen_king7");
    assert.equal(normalizeUsername("  ABC  "), "abc");
  });

  it("rejects bad lengths and characters", () => {
    assert.equal(validateUsername("ab").ok, false);
    assert.equal(validateUsername("a".repeat(19)).ok, false);
    assert.equal(validateUsername("no spaces").ok, false);
    assert.equal(validateUsername("hack<script>").ok, false);
    assert.equal(validateUsername(123).ok, false);
  });

  it("rejects reserved names case-insensitively", () => {
    for (const n of ["admin", "Admin", "MODERATOR", "headsTails", "support", "system"]) {
      assert.equal(validateUsername(n).ok, false, n);
    }
    assert.equal(validateUsername("administrator7").ok, true);
  });
});

describe("avatars", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

  it("accepts real JPEG/PNG/WEBP with matching MIME", () => {
    assert.deepEqual(validateAvatar(png, "image/png"), { ok: true, ext: "png" });
    assert.deepEqual(validateAvatar(jpg, "image/jpeg"), { ok: true, ext: "jpg" });
    assert.deepEqual(validateAvatar(webp, "image/webp"), { ok: true, ext: "webp" });
  });

  it("rejects SVG/HTML and mismatched content", () => {
    const svg = new TextEncoder().encode("<svg xmlns=    ");
    assert.equal(validateAvatar(svg, "image/svg+xml").ok, false);
    assert.equal(validateAvatar(svg, "image/png").ok, false);
    assert.equal(validateAvatar(png, "image/jpeg").ok, false);
  });

  it("rejects oversize and empty", () => {
    assert.equal(validateAvatar(new Uint8Array(0), "image/png").ok, false);
    assert.equal(validateAvatar(new Uint8Array(2 * 1024 * 1024 + 1), "image/png").ok, false);
  });
});

describe("ranks", () => {
  it("exact thresholds 10/100/1000", () => {
    assert.equal(rankForGames(0), "ROOKIE");
    assert.equal(rankForGames(9), "ROOKIE");
    assert.equal(rankForGames(10), "PLAYER");
    assert.equal(rankForGames(99), "PLAYER");
    assert.equal(rankForGames(100), "VETERAN");
    assert.equal(rankForGames(999), "VETERAN");
    assert.equal(rankForGames(1000), "LEGEND");
    assert.equal(rankForGames(5000), "LEGEND");
  });

  it("manual override changes display only", () => {
    const d = displayRank(5, "LEGEND");
    assert.equal(d.tier, "LEGEND");
    assert.equal(displayRank(5, "AUTO").tier, "ROOKIE");
    assert.equal(displayRank(5, null).tier, "ROOKIE");
    assert.equal(displayRank(2000, null).tier, "LEGEND");
    assert.equal(isValidRankOverride("auto"), true);
    assert.equal(isValidRankOverride("bogus"), false);
  });
});
