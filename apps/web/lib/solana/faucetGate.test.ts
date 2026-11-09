import "../test/hts-release-env";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEVNET_TEST_MINT,
  FAUCET_CLAIM_BASE_UNITS,
  evaluateFaucetGate,
  isValidWallet,
} from "./faucetGate.js";

const GOOD = {
  cluster: "devnet",
  faucetEnabled: "true",
  mainnetRealValue: "false",
  configuredMint: DEVNET_TEST_MINT,
};

describe("faucet gates", () => {
  it("allows the approved devnet configuration", () => {
    assert.deepEqual(evaluateFaucetGate(GOOD), { ok: true });
  });

  it("fails closed on mainnet cluster", () => {
    const r = evaluateFaucetGate({ ...GOOD, cluster: "mainnet-beta" });
    assert.equal(r.ok, false);
  });

  it("fails closed when disabled", () => {
    assert.equal(
      evaluateFaucetGate({ ...GOOD, faucetEnabled: "false" }).ok,
      false
    );
    assert.equal(
      evaluateFaucetGate({ ...GOOD, faucetEnabled: undefined }).ok,
      false
    );
  });

  it("fails closed when mainnet real value is enabled", () => {
    assert.equal(
      evaluateFaucetGate({ ...GOOD, mainnetRealValue: "true" }).ok,
      false
    );
  });

  it("fails closed on any other mint", () => {
    assert.equal(
      evaluateFaucetGate({ ...GOOD, configuredMint: "So11111111111111111111111111111111111111112" })
        .ok,
      false
    );
    assert.equal(
      evaluateFaucetGate({ ...GOOD, configuredMint: "" }).ok,
      false
    );
    assert.equal(
      evaluateFaucetGate({ ...GOOD, configuredMint: undefined }).ok,
      false
    );
  });

  it("pins the exact claim amount", () => {
    assert.equal(FAUCET_CLAIM_BASE_UNITS, BigInt(10_000_000_000));
  });

  it("never accepts the historical mint as the new HTS release", () => {
    assert.equal(evaluateFaucetGate({ ...GOOD, configuredMint: "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh" }).ok, false);
  });

  it("validates wallet addresses strictly", () => {
    assert.equal(isValidWallet("DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy"), true);
    assert.equal(isValidWallet("not-a-wallet"), false);
    assert.equal(isValidWallet(""), false);
    assert.equal(isValidWallet(undefined), false);
    assert.equal(isValidWallet(123), false);
    assert.equal(
      isValidWallet("DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy!"),
      false
    );
  });
});
