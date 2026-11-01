import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Wallet } from "@wallet-standard/base";
import {
  CAPABILITY_LABEL,
  compatibleInjectedWallets,
  isMobileUserAgent,
  mobileWalletActions,
  platformFromUserAgent,
  resolveInAppWalletView,
} from "./mobileWallets.js";

const PAGE = "https://headstails.fun/?room=10";
const REF = "https://headstails.fun";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fakeWallet(
  name: string,
  opts: { connect?: boolean; signTx?: boolean; chains?: string[] } = {}
): Wallet {
  const features: Record<string, unknown> = {};
  if (opts.connect !== false) features["standard:connect"] = { version: "1.0.0", connect: async () => ({ accounts: [] }) };
  if (opts.signTx !== false) features["solana:signTransaction"] = { version: "1.0.0", signTransaction: async () => [] };
  return {
    name,
    icon: "icon",
    chains: [],
    features,
    accounts: (opts.chains ?? ["solana:devnet"]).map((c) => ({
      address: "x",
      chains: [c],
      features: ["solana:signTransaction"],
      publicKey: new Uint8Array(32),
    })),
  } as unknown as Wallet;
}

describe("mobile wallets", () => {
  it("desktop UA is not mobile", () => {
    assert.equal(
      isMobileUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      ),
      false
    );
    assert.equal(platformFromUserAgent(null), "other");
  });

  it("detects iOS and Android", () => {
    assert.equal(
      platformFromUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      ),
      "ios"
    );
    assert.equal(
      platformFromUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
      ),
      "android"
    );
  });

  it("phantom uses universal link on iOS, intent URL on Android", () => {
    const ios = mobileWalletActions(PAGE, REF, "ios").find((a) => a.id === "phantom");
    assert.ok(ios?.href?.startsWith("https://phantom.app/ul/browse/"));
    assert.ok(ios?.href?.includes(encodeURIComponent(PAGE)));
    const android = mobileWalletActions(PAGE, REF, "android").find((a) => a.id === "phantom");
    assert.ok(android?.href?.startsWith("intent://ul/browse/"));
    assert.ok(android?.href?.includes("package=app.phantom"));
  });

  it("solflare and backpack use versioned browse links preserving page + ref", () => {
    for (const platform of ["ios", "android", "other"] as const) {
      const actions = mobileWalletActions(PAGE, REF, platform);
      const sf = actions.find((a) => a.id === "solflare");
      const bp = actions.find((a) => a.id === "backpack");
      assert.ok(sf?.href?.startsWith("https://solflare.com/ul/v1/browse/"));
      assert.ok(bp?.href?.startsWith("https://backpack.app/ul/v1/browse/"));
      for (const a of [sf, bp]) {
        assert.ok(a?.href?.includes(encodeURIComponent(PAGE)));
        assert.ok(a?.href?.includes(`ref=${encodeURIComponent(REF)}`));
      }
    }
  });

  it("labels never claim an app is installed", () => {
    for (const a of mobileWalletActions(PAGE, REF, "ios")) {
      assert.ok(!/installed|detected|available/i.test(a.label));
    }
  });

  it("curated list: 7 wallets in exact order, Ronin/Kraken/OKX removed", () => {
    const ids = mobileWalletActions(PAGE, REF, "ios").map((a) => a.id);
    assert.deepEqual(ids, [
      "phantom",
      "solflare",
      "backpack",
      "bitget",
      "metamask",
      "trust",
      "coinbase",
    ]);
    assert.ok(!ids.includes("ronin" as never));
    assert.ok(!ids.includes("kraken" as never));
    assert.ok(!ids.includes("okx" as never));
  });

  it("last three are Mainnet Only inert rows with no navigation", () => {
    const actions = mobileWalletActions(PAGE, REF, "ios");
    const tail = actions.slice(-3);
    assert.deepEqual(tail.map((a) => a.id), ["metamask", "trust", "coinbase"]);
    for (const a of tail) {
      assert.equal(a.inert, true);
      assert.equal(a.href, null);
      assert.equal(a.capability, "mainnet-only");
      assert.equal(CAPABILITY_LABEL[a.capability], "Mainnet Only");
      assert.ok(a.logo.length > 0, "keeps official local logo");
    }
  });

  it("Bitget does not falsely claim Devnet verification (Beta only)", () => {
    const bg = mobileWalletActions(PAGE, REF, "ios").find((a) => a.id === "bitget");
    assert.ok(bg && !bg.inert && bg.href);
    assert.equal(bg.capability, "beta");
    assert.equal(CAPABILITY_LABEL[bg.capability], "Beta");
  });

  it("normal Safari mobile: no injected provider -> curated list", () => {
    const view = resolveInAppWalletView([], "solana:devnet");
    assert.equal(view.mode, "none");
  });

  it("Solflare in-app browser: Solflare only", () => {
    const view = resolveInAppWalletView([fakeWallet("Solflare")], "solana:devnet");
    assert.equal(view.mode, "single");
    if (view.mode === "single") assert.match(view.walletName, /solflare/i);
    const compat = compatibleInjectedWallets([fakeWallet("Solflare")], "solana:devnet");
    assert.equal(compat.length, 1);
  });

  it("Phantom in-app browser: Phantom only", () => {
    const view = resolveInAppWalletView([fakeWallet("Phantom")], "solana:devnet");
    assert.equal(view.mode, "single");
    if (view.mode === "single") assert.match(view.walletName, /phantom/i);
  });

  it("Backpack in-app browser: Backpack only", () => {
    const view = resolveInAppWalletView([fakeWallet("Backpack")], "solana:devnet");
    assert.equal(view.mode, "single");
    if (view.mode === "single") assert.match(view.walletName, /backpack/i);
  });

  it("injected single-provider case suppresses generic list", () => {
    const view = resolveInAppWalletView(
      [fakeWallet("Solflare"), fakeWallet("EVM Only", { signTx: false, chains: ["eip155:1"] })],
      "solana:devnet"
    );
    // EVM-only registration is incompatible and ignored -> still single.
    assert.equal(view.mode, "single");
  });

  it("ambiguous multi-provider case never silently picks one", () => {
    const view = resolveInAppWalletView(
      [fakeWallet("Phantom"), fakeWallet("Solflare")],
      "solana:devnet"
    );
    assert.equal(view.mode, "multiple");
    if (view.mode === "multiple") assert.equal(view.walletNames.length, 2);
  });

  it("mobile modal is minimal: no heavy copy, no Copy Link, inert buttons", () => {
    const src = readFileSync(join(root, "components", "wallet", "WalletModal.tsx"), "utf8");
    assert.ok(!src.includes("Phone browsers can"), "heavy copy removed");
    assert.ok(!src.includes("Devnet play needs a wallet"), "heavy copy removed");
    assert.ok(!src.includes("Copy Link"), "no Copy Link");
    assert.ok(src.includes("Connect wallet"), "minimal title");
    // Inert rows use button + disabled semantics, no href navigation.
    assert.ok(src.includes('type="button"'), "buttons");
    assert.ok(src.includes("aria-disabled"), "disabled semantics");
  });
});
