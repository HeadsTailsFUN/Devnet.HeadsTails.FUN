import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_DIAGNOSTIC_CODES,
  isGameDiagnosticCode,
} from "./gameDiagnostic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/**
 * HT-OBS micro-fix: runtime observability only — no gameplay, settlement,
 * referral, welcome-grant transfer, payout, program, or authority changes.
 * 1. Welcome-grant diagnostic card in Admin (Devnet, OWNER/FULL_ADMIN only).
 * 2. Safe GAME_* diagnostic enum on /api/admin/game + UI rendering.
 */
describe("HT-OBS welcome-grant diagnostic card", () => {
  const card = (): string =>
    readFileSync(join(root, "components", "admin", "WelcomeGrantDiagnosticCard.tsx"), "utf8");

  it("card calls the existing endpoint from the authenticated page session", () => {
    const src = card();
    assert.ok(src.includes("Check Welcome Grant"), "button copy");
    assert.ok(src.includes('fetch("/api/admin/welcome-grant-diagnostic"'), "calls existing endpoint");
    assert.ok(!src.includes("/api/devnet/welcome-tokens"), "never touches the transfer path");
  });

  it("card is Devnet-only and OWNER/FULL_ADMIN-only (fail-closed on Mainnet)", () => {
    const tabs = readFileSync(join(root, "components", "admin", "AdminTabsA.tsx"), "utf8");
    assert.ok(tabs.includes("canWebAdmin && IS_DEVNET"), "double gate at render site");
    assert.ok(tabs.includes("WelcomeGrantDiagnosticCard"), "card mounted in Overview");
    const page = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    assert.ok(
      page.includes("<OverviewTab canWebAdmin="),
      "page passes the web-admin capability (moderators excluded)"
    );
    const route = readFileSync(
      join(root, "app", "api", "admin", "welcome-grant-diagnostic", "route.ts"),
      "utf8"
    );
    assert.ok(route.includes("devnetAdminContext()"), "endpoint fail-closes off-Devnet");
    assert.ok(route.includes("checkWebAdmin"), "endpoint keeps OWNER/FULL_ADMIN auth");
  });

  it("card renders SAFE fields only (never secrets)", () => {
    const src = card();
    for (const f of [
      "code",
      "faucetPubkey",
      "mint",
      "faucetSolLamports",
      "treasuryBalanceBaseUnits",
      "rpcMissing",
      "rpcIsDedicated",
      "detail",
    ]) {
      assert.ok(src.includes(f), `renders safe field ${f}`);
    }
    assert.ok(!src.includes("secretB58"), "no faucet secret");
    assert.ok(!src.includes("privateKey"), "no private key material");
    assert.ok(!src.includes("SERVICE_ROLE_KEY"), "no service-role key");
    assert.ok(!src.includes("serviceRole }"), "service-role value never spread");
  });

  it("card shows HTTP status + safe error + Retry on failure", () => {
    const src = card();
    assert.ok(src.includes("HTTP ${"), "HTTP status shown");
    assert.ok(src.includes("Retry"), "retry affordance");
    assert.ok(src.includes('status: "error"'), "terminal error state");
    assert.ok(src.includes('status: "loading"'), "loading state (never stuck)");
  });

  it("diagnostic endpoint still blocks unauthenticated callers (401)", async () => {
    const { GET } = await import("../../app/api/admin/welcome-grant-diagnostic/route.js");
    const res = await GET(new Request("http://x/api/admin/welcome-grant-diagnostic"));
    assert.equal(res.status, 401);
  });

  it("diagnostic endpoint fail-closes on Mainnet (403, no session needed)", async () => {
    const { GET } = await import("../../app/api/admin/welcome-grant-diagnostic/route.js");
    // devnetAdminContext() runs synchronously at the top of GET, before any
    // await — so starting the call inside withEnv is sufficient for the gate
    // to observe the Mainnet cluster value.
    let pending: Promise<Response> | undefined;
    withEnv({ NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta" }, () => {
      pending = GET(new Request("http://x/api/admin/welcome-grant-diagnostic"));
    });
    assert.ok(pending, "request started inside the Mainnet env");
    const res = await pending;
    assert.equal(res.status, 403);
  });
});

describe("HT-OBS game safe diagnostic enum", () => {
  it("enum exposes exactly the safe machine-readable codes", () => {
    for (const code of [
      "GAME_RPC_UNAVAILABLE",
      "GAME_RPC_CONFIG_MISSING",
      "GAME_CONFIG_UNREADABLE",
      "GAME_PROGRAM_MISMATCH",
      "GAME_UNKNOWN_ERROR",
    ]) {
      assert.ok((GAME_DIAGNOSTIC_CODES as readonly string[]).includes(code), code);
    }
    assert.ok(isGameDiagnosticCode("GAME_RPC_CONFIG_MISSING"), "guard accepts codes");
    assert.ok(!isGameDiagnosticCode("E_CONNREFUSED"), "guard rejects raw errors");
    assert.ok(!isGameDiagnosticCode(null), "guard rejects null");
  });

  it("game route maps every failure to a code (never raw internals)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "game", "route.ts"), "utf8");
    for (const code of GAME_DIAGNOSTIC_CODES) {
      assert.ok(src.includes(`"${code}"`), `maps ${code}`);
    }
    assert.ok(!src.includes("e.message"), "no raw exception echo (RPC URLs can carry keys)");
    assert.ok(!src.includes(".stack"), "no stack-trace property echoed");
    assert.ok(!src.includes("SECRET"), "no secret env values");
    assert.ok(src.includes("checkStaff(req, false)"), "staff gate preserved (fail-closed)");
  });

  it("game route still fails closed unauthenticated (401 + diagnostic)", async () => {
    const { GET } = await import("../../app/api/admin/game/route.js");
    const res = await GET(new Request("http://x/api/admin/game"));
    assert.equal(res.status, 401);
    const b = (await res.json().catch(() => null)) as { diagnostic?: unknown } | null;
    assert.equal(b?.diagnostic, "GAME_AUTH_REQUIRED");
  });

  it("Overview + Game tabs render Diagnostic beneath the friendly message + Retry", () => {
    for (const f of ["AdminTabsA.tsx", "AdminTabsB.tsx"]) {
      const src = readFileSync(join(root, "components", "admin", f), "utf8");
      assert.ok(src.includes("Could not load on-chain game state."), `${f}: friendly copy`);
      assert.ok(src.includes("Diagnostic:"), `${f}: diagnostic code rendered`);
      assert.ok(src.includes("Retry"), `${f}: retry affordance`);
    }
  });
});
