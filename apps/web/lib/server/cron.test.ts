import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("autonomous matchmaking trigger", () => {
  it("vercel cron registered at a Hobby-valid daily schedule (backstop only)", () => {
    const p = join(webRoot, "vercel.json");
    assert.ok(existsSync(p), "vercel.json exists");
    const cfg = JSON.parse(readFileSync(p, "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
    const cron = (cfg.crons ?? []).find((c) => c.path === "/api/cron/maintain-rooms");
    assert.ok(cron, "maintain-rooms cron registered");
    // Hobby plan allows daily crons only — this is a backstop, NOT the
    // gameplay-cadence mechanism (see keeper HTTP maintenance loop).
    assert.equal(cron!.schedule, "0 2 * * *");
  });

  it("keeper runs room maintenance at gameplay cadence (primary mechanism)", () => {
    const run = readFileSync(
      join(webRoot, "..", "..", "packages", "keeper", "src", "run.ts"),
      "utf8"
    );
    assert.ok(run.includes("MAINTAIN_API_BASE_URL"), "keeper maintenance configurable");
    assert.ok(run.includes("maintain-room"), "keeper calls the room reconciler");
  });

  it("cron maintains BOTH tiers plus settlement reconcile", () => {
    const src = readFileSync(join(webRoot, "app", "api", "cron", "maintain-rooms", "route.ts"), "utf8");
    assert.ok(src.includes("maintainRoom(1)"), "tier 1 maintained");
    assert.ok(src.includes("maintainRoom(10)"), "tier 10 maintained");
    assert.ok(src.includes("reconcileUnresolved"), "settlement reconciled");
    assert.ok(src.includes("CRON_SECRET"), "cron auth");
  });

  it("browser crank is a fast path over the same reconciler", () => {
    const src = readFileSync(join(webRoot, "app", "api", "devnet", "match-crank-room", "route.ts"), "utf8");
    assert.ok(src.includes("maintainRoom"), "delegates to maintainRoom");
  });

  it("cross-room isolation: tiers never share heads (roomQueuePda includes tier byte)", () => {
    const src = readFileSync(join(webRoot, "..", "..", "packages", "game-sdk", "src", "pdas.ts"), "utf8");
    assert.ok(src.includes("Buffer.from([tierUsd])"), "tier byte in PDA seeds");
  });
});
