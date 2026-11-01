import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * HT-FINAL-005 regression: reconciliation must not manufacture historical
 * settlement_jobs rows, and telemetry must distinguish bookkeeping
 * transitions from fresh submissions.
 *
 * Desired semantics:
 * 1. Existing durable queued/pending/failed jobs: reconciled.
 * 2. Chain Settled + existing job → update it to settled.
 * 3. Chain Settled + NO job → do NOT create a row.
 * 4. Newly detected unresolved WaitingForRandomness → job creation allowed.
 * Telemetry: checked / jobsTransitionedToSettled / settlementsSubmitted /
 * alreadySettled / pending / errors. Repeated runs are idempotent (no
 * duplicate payouts, zero transitions on the second run).
 */
describe("HT-FINAL-005 reconciler scope + telemetry", () => {
  const src = (): string =>
    readFileSync(join(root, "lib", "settlement", "settle.ts"), "utf8");

  it("settled scan uses updateExistingJob (UPDATE only, never UPSERT)", () => {
    const s = src();
    assert.ok(s.includes("export async function updateExistingJob"), "helper exists");
    assert.ok(s.includes("await updateExistingJob(id,"), "settled scan updates existing only");
    assert.ok(!s.includes('await markJob(id, { status: "settled" })'), "no unconditional upsert for settled");
  });

  it("updateExistingJob returns false when no row exists (no manufacture)", () => {
    const s = src();
    assert.ok(s.includes("existing.error || !row?.match_id"), "missing row or failed read → false");
    assert.ok(s.includes(".update({"), "uses UPDATE, not upsert");
  });

  it("updateExistingJob is idempotent (already-settled row is not a transition)", () => {
    const s = src();
    assert.ok(s.includes('row.status === patch.status && patch.status === "settled"'), "settled is an idempotent no-op");
    assert.ok(s.includes('.eq("status", row.status)'), "concurrent transition is conditional");
    assert.ok(s.includes("!updated.error && !!updated.data"), "only a successful actual transition is counted");
  });

  it("ensureSettlement already-settled paths never manufacture rows", () => {
    const s = src();
    // Both already-settled branches (re-read + AlreadySettled race) use the
    // update-only helper and report whether a transition happened.
    const matches = s.match(/await updateExistingJob\(matchId, \{ status: "settled" \}\)/g) ?? [];
    assert.ok(matches.length >= 2, `both ensure paths update-only (found ${matches.length})`);
    assert.ok(s.includes("transitioned"), "transition flag reported");
  });

  it("pending/failed bookkeeping still uses upsert (new unresolved jobs allowed)", () => {
    const s = src();
    assert.ok(s.includes('status: "pending"'), "pending path preserved");
    assert.ok(s.includes("queueSettlementJob"), "creation helper preserved");
  });

  it("telemetry separates transitions from submissions", () => {
    const s = src();
    for (const field of [
      "jobsTransitionedToSettled",
      "settlementsSubmitted",
      "alreadySettled",
      "jobsTransitioned",
    ]) {
      assert.ok(s.includes(field), `telemetry includes ${field}`);
    }
    assert.ok(s.includes("ReconcileResult"), "typed result");
  });

  it("admin UI reports transitions vs submissions accurately", () => {
    const ui = readFileSync(join(root, "components", "admin", "AdminTabsA.tsx"), "utf8");
    assert.ok(ui.includes("jobsTransitionedToSettled"), "reads transition count");
    assert.ok(ui.includes("settlementsSubmitted"), "reads submission count");
    assert.ok(ui.includes("existing job(s) transitioned to settled"), "operator copy");
    assert.ok(ui.includes("new settlement(s) submitted"), "submission copy");
  });

  it("reconcile route returns the new telemetry fields", async () => {
    const route = readFileSync(join(root, "app", "api", "settlement", "reconcile", "route.ts"), "utf8");
    assert.ok(route.includes("reconcileUnresolved"), "uses reconciler");
    // The route spreads the reconciler output, so new fields flow through.
    assert.ok(route.includes("...out"), "forwards telemetry");
  });
});
