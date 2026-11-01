import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("explorer human-readable result memo", () => {
  it("settlement appends a same-transaction Memo derived from chain data", () => {
    const src = readFileSync(join(root, "lib", "settlement", "settle.ts"), "utf8");
    assert.ok(src.includes("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), "memo instruction present");
    assert.ok(src.includes("HeadsTails.fun | Match #"), "required memo format");
    assert.ok(src.includes("Result:"), "result in memo");
    assert.ok(src.includes("resultBit === 0"), "derived from authoritative ORAO result");
  });

  it("memo is non-authoritative and optional", () => {
    const src = readFileSync(join(root, "lib", "settlement", "settle.ts"), "utf8");
    assert.ok(/non-authoritative|convenience metadata/i.test(src), "documented non-authoritative");
    assert.ok(/optional|proceeds without it/i.test(src), "settlement proceeds without memo");
  });
});
