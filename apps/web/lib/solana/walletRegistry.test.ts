import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mobileWalletActions } from "./mobileWallets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "https://headstails.fun/?room=10";
const REF = "https://headstails.fun";

describe("mobile wallet registry (7 curated wallets)", () => {
  it("ordered registry has exactly the 7 requested wallets, no duplicates", () => {
    for (const platform of ["ios", "android", "other"] as const) {
      const actions = mobileWalletActions(PAGE, REF, platform);
      const ids = actions.map((a) => a.id);
      assert.deepEqual(ids, [
        "phantom",
        "solflare",
        "backpack",
        "bitget",
        "metamask",
        "trust",
        "coinbase",
      ]);
      assert.equal(new Set(ids).size, 7, "no duplicate providers");
      const labels = actions.map((a) => a.label);
      assert.equal(new Set(labels).size, 7);
    }
  });

  it("Ronin/Kraken/OKX removed entirely", () => {
    const src = readFileSync(join(root, "lib", "solana", "mobileWallets.ts"), "utf8");
    const ids = mobileWalletActions(PAGE, REF, "ios").map((a) => a.id);
    assert.ok(!(ids as string[]).includes("ronin"));
    assert.ok(!(ids as string[]).includes("kraken"));
    assert.ok(!(ids as string[]).includes("okx"));
    // No render of removed wallets from the curated builder.
    assert.ok(!/\"ronin\"|'ronin'/.test(JSON.stringify(ids)));
  });

  it("Nightly opens the current page in its in-app Solana Devnet browser", () => {
    for (const platform of ["ios", "android"] as const) {
      const nightly = mobileWalletActions(PAGE, REF, platform, true).find((a) => a.id === "nightly");
      assert.ok(nightly?.href);
      const link = new URL(nightly.href);
      assert.equal(link.origin + link.pathname, "https://nightly.app/v1");
      assert.equal(link.searchParams.get("network"), "solana");
      assert.equal(link.searchParams.get("cluster"), "devnet");
      assert.equal(link.searchParams.get("url"), PAGE);
      assert.equal(nightly.capability, "available");
      assert.ok(existsSync(join(root, "public", nightly.logo)));
    }
  });

  it("labels never claim installation; official routes only", () => {
    for (const a of mobileWalletActions(PAGE, REF, "ios")) {
      assert.ok(!/installed|detected|available|copy link/i.test(a.label), a.label);
    }
    const ios = mobileWalletActions(PAGE, REF, "ios");
    const phantom = ios.find((a) => a.id === "phantom")!;
    assert.ok(phantom.href?.startsWith("https://phantom.app/ul/browse/"));
    assert.ok(phantom.href?.includes(encodeURIComponent(PAGE)));
    const android = mobileWalletActions(PAGE, REF, "android");
    assert.ok(android.find((a) => a.id === "phantom")!.href?.startsWith("intent://ul/browse/"));
    const sf = ios.find((a) => a.id === "solflare")!;
    const bp = ios.find((a) => a.id === "backpack")!;
    assert.ok(sf.href?.startsWith("https://solflare.com/ul/v1/browse/"));
    assert.ok(bp.href?.startsWith("https://backpack.app/ul/v1/browse/"));
    const bitget = ios.find((a) => a.id === "bitget")!;
    assert.ok(bitget.href?.startsWith("bitkeep://bkconnect?action=DApp&url="), bitget.href ?? "");
    assert.equal(bitget.kind, "deeplink-official");
    // Last three are inert: no href, no navigation.
    for (const id of ["metamask", "trust", "coinbase"] as const) {
      const a = ios.find((x) => x.id === id)!;
      assert.equal(a.inert, true);
      assert.equal(a.href, null);
      assert.equal(a.kind, "inert");
    }
  });

  it("no Copy Link in the wallet modal", () => {
    const modal = readFileSync(join(root, "components", "wallet", "WalletModal.tsx"), "utf8");
    assert.ok(!modal.includes("Copy page link"), "Copy Link removed");
    assert.ok(!modal.includes("clipboard.writeText"), "no copy-link handler");
    assert.ok(!modal.includes("Copy Link"), "no Copy Link text");
  });

  it("every row uses a local logo asset (no hotlinks)", () => {
    for (const a of mobileWalletActions(PAGE, REF, "ios")) {
      assert.ok(a.logo.startsWith("/assets/wallets/"), `${a.id} logo is local`);
      assert.ok(!a.logo.startsWith("http"), `${a.id} never hotlinked`);
    }
    for (const f of [
      "phantom.svg",
      "solflare.svg",
      "trust.svg",
      "metamask.svg",
      "coinbase.svg",
      "backpack.ico",
      "bitget.svg",
    ]) {
      assert.ok(existsSync(join(root, "public", "assets", "wallets", f)), `vendored ${f}`);
    }
  });

  it("limited wallets carry honest capability states", () => {
    const byId = Object.fromEntries(mobileWalletActions(PAGE, REF, "ios").map((a) => [a.id, a]));
    assert.equal(byId.phantom.capability, "available");
    assert.equal(byId.solflare.capability, "available");
    assert.equal(byId.backpack.capability, "available");
    assert.equal(byId.bitget.capability, "beta");
    assert.equal(byId.metamask.capability, "mainnet-only");
    assert.equal(byId.trust.capability, "mainnet-only");
    assert.equal(byId.coinbase.capability, "mainnet-only");
    const modal = readFileSync(join(root, "components", "wallet", "WalletModal.tsx"), "utf8");
    assert.ok(modal.includes("CAPABILITY_LABEL"), "badges rendered");
  });

  it("unsupported providers are not falsely marked playable (Keplr)", () => {
    const modal = readFileSync(join(root, "components", "wallet", "WalletModal.tsx"), "utf8");
    assert.ok(!/keplr/i.test(modal), "no Keplr row without verified Solana signing");
  });
});
