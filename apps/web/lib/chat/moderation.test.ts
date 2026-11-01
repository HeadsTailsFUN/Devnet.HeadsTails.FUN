import { test } from "node:test";
import assert from "node:assert/strict";
import { maskProfanity, recentMessages } from "./moderation";
test("mask explicit English/Persian words, preserve the rest of a message", () => {
  assert.equal(
    maskProfanity("GG, that SHIT was wild!"),
    "GG, that *** was wild!",
  );
  assert.equal(maskProfanity("سلام كير خداحافظ"), "سلام *** خداحافظ");
  assert.equal(maskProfanity("f.u.c.k this"), "*** this");
  assert.equal(maskProfanity("f u c k this"), "*** this");
  assert.equal(maskProfanity("f\u200du\u200dc\u200dk"), "***");
  assert.equal(maskProfanity("سلام ک ی ر خداحافظ"), "سلام *** خداحافظ");
  assert.equal(maskProfanity("ك.ي.ر"), "***");
});
test("ordinary substrings, Persian words and disagreement are not censored", () => {
  const text =
    "class assignment, Scunthorpe, classic, shell, کسی هست؟ I disagree, GG!";
  assert.equal(maskProfanity(text), text);
});
test("100-item window deduplicates and deterministically orders equal timestamps", () => {
  const rows = Array.from({ length: 130 }, (_, i) => ({
    id: String(i).padStart(3, "0"),
    createdAt: "2026-11-01T00:00:00Z",
  }));
  const result = recentMessages([...rows.reverse(), rows[0]]);
  assert.equal(result.length, 100);
  assert.equal(result[0].id, "030");
  assert.equal(result[99].id, "129");
});
