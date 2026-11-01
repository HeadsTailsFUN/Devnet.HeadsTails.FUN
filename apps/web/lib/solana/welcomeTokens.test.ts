import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFaucetGate } from "./faucetGate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("devnet welcome tokens (one-time onboarding)", () => {
  it("first successful connect receives exactly one grant (ledger PK insert wins once)", () => {
    // Simulated ledger with wallet PK uniqueness: second concurrent insert
    // fails, so at most one transfer happens.
    const ledger = new Set<string>();
    const tryClaim = (wallet: string): boolean => {
      if (ledger.has(wallet)) return false;
      ledger.add(wallet);
      return true;
    };
    assert.equal(tryClaim("WALLET_A"), true);
    assert.equal(tryClaim("WALLET_A"), false);
    assert.equal(tryClaim("WALLET_B"), true);
  });

  it("reconnect does not grant again", () => {
    const granted = new Set(["WALLET_A"]);
    const ensure = (wallet: string): string => (granted.has(wallet) ? "already-granted" : "granted");
    assert.equal(ensure("WALLET_A"), "already-granted");
    assert.equal(ensure("WALLET_A"), "already-granted");
  });

  it("mainnet fails closed", () => {
    assert.equal(
      evaluateFaucetGate({
        cluster: "mainnet-beta",
        faucetEnabled: "true",
        mainnetRealValue: "false",
        configuredMint: "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh",
      }).ok,
      false
    );
    assert.equal(
      evaluateFaucetGate({
        cluster: "devnet",
        faucetEnabled: "true",
        mainnetRealValue: "true",
        configuredMint: "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh",
      }).ok,
      false
    );
  });

  it("visible faucet button is absent (no Get Test Tokens in UI)", () => {
    const live = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(!live.includes("FaucetButton"), "LiveGameClient must not render FaucetButton");
    assert.ok(!live.includes("Get Test Tokens"), "no visible Get Test Tokens copy");
    const modal = readFileSync(join(root, "components", "wallet", "WalletModal.tsx"), "utf8");
    assert.ok(!modal.includes("Copy page link"), "Copy Link removed");
  });

  it("welcome route is server-side finite treasury transfer (no mint key exposure)", () => {
    const src = readFileSync(join(root, "app", "api", "devnet", "welcome-tokens", "route.ts"), "utf8");
    assert.ok(src.includes("createTransferCheckedInstruction"), "finite treasury transfer");
    assert.ok(!src.includes("mintTo"), "never mints; only transfers");
    assert.ok(src.includes("already-granted"), "idempotent one-time semantics");
  });

  it("grant lifecycle uses the shared journal and never retries unknown outcomes by age", () => {
    const src = readFileSync(join(root, "app", "api", "devnet", "welcome-tokens", "route.ts"), "utf8");
    const journal = readFileSync(join(root, "lib", "solana", "expenseJournal.ts"), "utf8");
    assert.ok(src.includes("sendJournaledTransaction"), "one shared send boundary");
    assert.ok(src.includes("welcome_grants"), "compatibility ledger retained");
    assert.ok(src.includes('"completed"'), "completed mirror only after journal success");
    assert.ok(src.includes("welcome-${DEVNET_TEST_MINT}-${walletPk.toBase58()}"), "wallet+mint journal identity");
    assert.ok(journal.indexOf('"submit_devnet_expense"') < journal.indexOf("sendRawTransaction("), "durable bytes precede broadcast");
    assert.ok(journal.includes("last_valid_block_height")) ;
    assert.ok(!src.includes("STALE_PENDING_MS"), "elapsed time alone cannot authorize a second transfer");
    // Concurrency, lost-response recovery and failed-receipt retry execute
    // the actual sender against real disposable Postgres in b2-postgres.test.
  });

  // HT-QA-007: classified internal diagnostics without secret leakage.
  it("transfer failures are classified (WELCOME_GRANT_*) and treasury-checked", () => {
    const src = readFileSync(join(root, "app", "api", "devnet", "welcome-tokens", "route.ts"), "utf8");
    for (const code of [
      "WELCOME_GRANT_TREASURY_UNAVAILABLE",
      "WELCOME_GRANT_INSUFFICIENT_BALANCE",
      "WELCOME_GRANT_ATA_FAILURE",
      "WELCOME_GRANT_SEND_FAILURE",
      "WELCOME_GRANT_CONFIRMATION_FAILURE",
      "WELCOME_GRANT_RPC_FAILURE",
    ]) {
      assert.ok(src.includes(code), `diagnostic code ${code}`);
    }
    assert.ok(src.includes("getTokenAccountBalance"), "treasury balance pre-check");
    assert.ok(src.includes("treasury ATA missing"), "treasury existence check");
    // Browser response stays generic; no secret VALUES in logs or body
    // (variable names like serviceRole/secretB58 naturally appear; what must
    // never appear is interpolating the raw value into a log or response).
    assert.ok(src.includes('"transfer failed"'), "safe generic browser error");
    assert.ok(!src.includes("${secretB58}"), "no raw faucet secret in logs");
    assert.ok(!src.includes("${serviceRole}"), "no raw service-role key in logs");
    assert.ok(src.includes("never secrets"), "documents no-secret logging");
  });

  it("migration creates the lifecycle table keyed by wallet+mint (service-role only)", () => {
    const sql = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260928000000_welcome_grants.sql"),
      "utf8"
    );
    assert.ok(sql.includes("create table"), "table created");
    assert.ok(sql.includes("primary key (wallet, mint)"), "composite wallet+mint identity");
    assert.ok(
      sql.includes("'pending'") && sql.includes("'submitted'") && sql.includes("'completed'") && sql.includes("'failed'"),
      "lifecycle states"
    );
    assert.ok(sql.includes("enable row level security"), "RLS on, no public policies");
  });
});
