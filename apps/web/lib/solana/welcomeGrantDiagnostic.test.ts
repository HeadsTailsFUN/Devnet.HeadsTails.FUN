import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WELCOME_GRANT_DIAGNOSTIC_CODES,
  safeDiagnosticDetail,
} from "./welcomeGrantDiagnostic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("HT-FINAL-001 welcome-grant diagnostic (safe, devnet-only, web-admin)", () => {
  it("exposes the full safe enum (no invented codes)", () => {
    for (const code of [
      "WELCOME_GRANT_CONFIG_MISSING",
      "WELCOME_GRANT_SIGNER_INVALID",
      "WELCOME_GRANT_TREASURY_UNAVAILABLE",
      "WELCOME_GRANT_SOL_LOW",
      "WELCOME_GRANT_INSUFFICIENT_BALANCE",
      "WELCOME_GRANT_ATA_FAILURE",
      "WELCOME_GRANT_RPC_FAILURE",
      "WELCOME_GRANT_SEND_FAILURE",
      "WELCOME_GRANT_CONFIRMATION_FAILURE",
    ]) {
      assert.ok(
        (WELCOME_GRANT_DIAGNOSTIC_CODES as readonly string[]).includes(code),
        `enum includes ${code}`
      );
    }
  });

  it("route is devnet-only + web-admin gated + fail-closed on mainnet", async () => {
    const src = readFileSync(
      join(root, "app", "api", "admin", "welcome-grant-diagnostic", "route.ts"),
      "utf8"
    );
    assert.ok(src.includes("devnetAdminContext()"), "devnet gate");
    assert.ok(src.includes("checkWebAdmin"), "owner/full-admin gate");
    assert.ok(src.includes("status: 403"), "fail-closed denial");
  });

  it("route never exposes secrets or raw env values in the response", () => {
    const src = readFileSync(
      join(root, "app", "api", "admin", "welcome-grant-diagnostic", "route.ts"),
      "utf8"
    );
    // The route must READ env presence server-side but never ECHO values:
    // the JSON payload carries presence booleans + public address only.
    assert.ok(src.includes("supabaseUrlSet"), "presence boolean");
    assert.ok(src.includes("faucetKeySet"), "presence boolean");
    assert.ok(src.includes("faucetPubkey"), "public address only");
    // No secret value flows into the JSON response (facts/detail only).
    assert.ok(!src.includes("secretB58 }"), "secret never spread into response");
    assert.ok(!src.includes("serviceRole }"), "service-role never spread into response");
    assert.ok(!src.includes('"secret'), "no secret key in payload");
    assert.ok(!src.includes('"serviceRole'), "no service-role key in payload");
  });

  it("transfer route classifies CONFIG_MISSING with the shared code", () => {
    const src = readFileSync(
      join(root, "app", "api", "devnet", "welcome-tokens", "route.ts"),
      "utf8"
    );
    assert.ok(src.includes("WELCOME_GRANT_CONFIG_MISSING"), "config code logged");
    assert.ok(src.includes("transfer failed"), "browser stays generic");
  });

  it("safeDiagnosticDetail redacts long secrets and newlines", () => {
    const long = `treasury ${"A".repeat(60)} failed\nwith newline`;
    const safe = safeDiagnosticDetail(new Error(long));
    assert.ok(!safe.includes("A".repeat(60)), "long token redacted");
    assert.ok(!safe.includes("\n"), "newlines stripped");
    assert.ok(safe.length <= 200, "bounded length");
  });
});
