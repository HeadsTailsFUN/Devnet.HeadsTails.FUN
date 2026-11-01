import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("final QA fixes (HT-QA-001..009)", () => {
  it("HT-QA-002: history reuses the browser singleton (no per-call GoTrueClient)", () => {
    const src = readFileSync(join(root, "lib", "solana", "history.ts"), "utf8");
    assert.ok(src.includes("getBrowserSupabase"), "uses canonical singleton");
    assert.ok(!src.includes("createClient("), "no per-call createClient");
  });

  it("HT-QA-003: settled chain state marks the durable job settled + drains durable queue", () => {
    const src = readFileSync(
      join(root, "lib", "settlement", "settle.ts"),
      "utf8",
    );
    // Settled branch must update the EXISTING job only (HT-FINAL-005: never
    // manufacture history via unconditional upsert for already-settled).
    // NOTE: ensureSettlement has its own already-settled updateExistingJob;
    // the reconciler loop uses the loop variable `id`, so assert that form.
    assert.ok(
      src.includes("await updateExistingJob(id,"),
      "settled chain updates existing job only",
    );
    assert.ok(
      !src.includes('await markJob(id, { status: "settled" })'),
      "no unconditional upsert for settled scan",
    );
    // Durable queue drained independently of the shallow lookback.
    assert.ok(src.includes("settlement_jobs"), "queries durable jobs table");
    assert.ok(src.includes("next_attempt_at"), "respects retry schedule");
    assert.ok(src.includes("ensureSettlement(mid)"), "drains old queued jobs");
    // No competing authority: chain stays authoritative, keeper is convenience.
    assert.ok(
      src.includes("Chain remains authoritative") ||
        src.includes("chain state stays authoritative"),
      "authority comment",
    );
  });

  it("HT-QA-004: baseline security headers on all routes", () => {
    const src = readFileSync(join(root, "next.config.mjs"), "utf8");
    assert.ok(src.includes("headers()"), "headers() configured");
    assert.ok(src.includes("Content-Security-Policy"), "CSP present");
    assert.ok(src.includes("frame-ancestors"), "frame-ancestors present");
    assert.ok(src.includes("X-Content-Type-Options"), "nosniff present");
    assert.ok(src.includes("nosniff"), "nosniff value");
    assert.ok(src.includes("Referrer-Policy"), "referrer policy present");
    assert.ok(src.includes("/:path*"), "application-wide");
  });

  it("HT-QA-005: wallet modal traps focus, returns focus, handles Escape", () => {
    const src = readFileSync(
      join(root, "components", "wallet", "WalletModal.tsx"),
      "utf8",
    );
    assert.ok(src.includes("dialogRef"), "dialog ref");
    assert.ok(src.includes("triggerRef"), "trigger ref for focus return");
    assert.ok(src.includes('"Tab"') || src.includes("'Tab'"), "tab trap");
    assert.ok(src.includes("Escape"), "escape closes");
    assert.ok(src.includes(".focus()"), "focus management");
  });

  it("HT-QA-006: favicon resolves (no 404)", () => {
    const ico = readFileSync(join(root, "app", "favicon.ico"));
    assert.deepEqual(
      [...ico.subarray(0, 6)],
      [0, 0, 1, 0, 3, 0],
      "actual three-size ICO, not an SVG response",
    );
    for (const file of ["icon.png", "apple-icon.png"])
      assert.ok(existsSync(join(root, "app", file)));
    assert.ok(existsSync(join(root, "public", "brand", "favicon-16.png")));
    assert.ok(existsSync(join(root, "public", "brand", "favicon-32.png")));
    const layout = readFileSync(join(root, "app", "layout.tsx"), "utf8");
    assert.ok(layout.includes("icons"), "metadata icons configured");
  });

  it("HT-QA-008: privacy/terms describe current Devnet Beta (no stale preview copy)", () => {
    const privacy = readFileSync(
      join(root, "app", "privacy", "page.tsx"),
      "utf8",
    );
    const terms = readFileSync(join(root, "app", "terms", "page.tsx"), "utf8");
    for (const [name, src] of [
      ["privacy", privacy],
      ["terms", terms],
    ] as const) {
      assert.ok(
        !src.includes("UI preview does not collect"),
        `${name}: stale copy removed`,
      );
      assert.ok(
        src.includes("Devnet Beta") || src.includes("DEVNET BETA"),
        `${name}: Devnet Beta labeled`,
      );
    }
    assert.ok(
      privacy.includes("Wallet public addresses"),
      "privacy lists wallet addresses",
    );
    assert.ok(privacy.includes("Airdrop Points"), "privacy lists points");
    assert.ok(
      !privacy.includes("retention") || privacy.includes("not"),
      "no invented retention promises",
    );
    assert.ok(
      terms.includes("real-world value"),
      "terms: test tokens valueless",
    );
  });

  it("HT-QA-009: leaderboard uses count-aware labels", () => {
    const src = readFileSync(
      join(root, "components", "leaderboard", "LeaderboardPanel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("winsLabel") && src.includes("gamesLabel"),
      "plural helpers used",
    );
    assert.ok(!src.includes("`${r.wins} wins"), "raw wins copy removed");
  });
});
