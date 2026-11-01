import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  dedupeWallets,
  normalizeWalletName,
  scoreWallet,
  walletRowKey,
} from "./wallets.js";
import type { Wallet } from "@wallet-standard/base";

function fakeWallet(
  name: string,
  opts: { connect?: boolean; signTx?: boolean; chains?: string[]; features?: number } = {}
): Wallet {
  const features: Record<string, unknown> = {};
  if (opts.connect !== false) features["standard:connect"] = { version: "1.0.0", connect: async () => ({ accounts: [] }) };
  if (opts.signTx !== false) features["solana:signTransaction"] = { version: "1.0.0", signTransaction: async () => [] };
  for (let i = 0; i < (opts.features ?? 0); i++) features[`extra:${i}`] = {};
  return {
    name,
    icon: "",
    chains: [],
    features,
    accounts: (opts.chains ?? ["solana:devnet"]).map((c) => ({
      address: "x",
      chains: [c],
      features: [],
      publicKey: new Uint8Array(32),
    })),
  } as unknown as Wallet;
}

describe("wallet registry deduplication", () => {
  it("normalizes brand identities", () => {
    assert.equal(normalizeWalletName("Phantom"), "phantom");
    assert.equal(normalizeWalletName("Trust Wallet"), "trustwallet");
    assert.equal(normalizeWalletName("TRUST  wallet!!"), "trustwallet");
  });

  it("dedupes duplicate Phantom registrations deterministically", () => {
    const a = fakeWallet("Phantom", { features: 1 });
    const b = fakeWallet("Phantom", { features: 5 });
    const out = dedupeWallets([a, b], "solana:devnet");
    assert.equal(out.length, 1);
    assert.equal(out[0], b);
    // Order-independent.
    assert.equal(dedupeWallets([b, a], "solana:devnet")[0], b);
  });

  it("dedupes duplicate Trust Wallet registrations", () => {
    const out = dedupeWallets(
      [fakeWallet("Trust Wallet"), fakeWallet("Trust Wallet"), fakeWallet("Solflare")],
      "solana:devnet"
    );
    const names = out.map((w) => w.name);
    assert.equal(names.filter((n) => normalizeWalletName(n) === "trustwallet").length, 1);
    assert.ok(names.includes("Solflare"));
  });

  it("keeps a normal Solflare registry intact", () => {
    const out = dedupeWallets([fakeWallet("Solflare")], "solana:devnet");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Solflare");
  });

  it("prefers the instance with connect + signing support", () => {
    const bad = fakeWallet("Phantom", { connect: true, signTx: false });
    const good = fakeWallet("Phantom", { connect: true, signTx: true });
    const out = dedupeWallets([bad, good], "solana:devnet");
    assert.equal(out[0], good);
    assert.equal(scoreWallet(good, "solana:devnet").score > scoreWallet(bad, "solana:devnet").score, true);
  });

  it("uses stable keys (no random per-object identity)", () => {
    const a = fakeWallet("Phantom");
    const b = fakeWallet("Phantom");
    assert.equal(walletRowKey(a), walletRowKey(b));
    assert.equal(walletRowKey(a), "wallet-phantom");
  });

  it("renders one row per brand across Phantom/Solflare/Trust/Ronin/Backpack", () => {
    const all = [
      fakeWallet("Phantom"),
      fakeWallet("Phantom"),
      fakeWallet("Solflare"),
      fakeWallet("Trust Wallet"),
      fakeWallet("Trust Wallet"),
      fakeWallet("Ronin"),
      fakeWallet("Backpack"),
    ];
    const out = dedupeWallets(all, "solana:devnet");
    assert.equal(out.length, 5);
  });
});
