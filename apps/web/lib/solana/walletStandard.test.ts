import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  describeAccountForDiagnostics,
  describeWalletForDiagnostics,
  getConnectMethod,
  getDisconnectMethod,
  getSignMethod,
  normalizeSigningOutput,
  selectSolanaAccount,
} from "./walletStandard.js";

const DEVNET = "solana:devnet";

function account(
  address: string,
  chains: string[],
  features: string[] = ["solana:signTransaction"]
): WalletAccount {
  return {
    address,
    publicKey: new Uint8Array(32),
    chains,
    features,
  } as unknown as WalletAccount;
}

/** Real Wallet Standard shape: entry IS { version, connect }. No nesting. */
function connectWallet(accounts: WalletAccount[], connectImpl?: (...a: never[]) => Promise<unknown>): Wallet {
  return {
    name: "Phantom",
    icon: "",
    chains: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: (connectImpl ?? (async () => ({ accounts }))) as (...a: never[]) => Promise<unknown>,
      },
    },
    accounts,
  } as unknown as Wallet;
}

/** Real shape: entry IS { version, signTransaction }. No nesting. */
function signWallet(
  signImpl: (...a: never[]) => Promise<unknown>,
  accounts: WalletAccount[] = [account("A", [DEVNET])]
): Wallet {
  return {
    name: "Solflare",
    icon: "",
    chains: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts }) },
      "solana:signTransaction": { version: "1.0.0", signTransaction: signImpl },
    },
    accounts,
  } as unknown as Wallet;
}

describe("wallet standard feature invocation", () => {
  it("1. direct standard:connect shape connects successfully", async () => {
    const accs = [account("A111", [DEVNET])];
    const w = connectWallet(accs);
    const connect = getConnectMethod(w);
    assert.ok(typeof connect === "function");
    const out = (await connect!()) as { accounts: readonly WalletAccount[] };
    assert.equal(out.accounts.length, 1);
  });

  it("2. no nested feature[standard:connect] lookup is required", () => {
    const w = connectWallet([account("A111", [DEVNET])]);
    const entry = (w.features as Record<string, unknown>)["standard:connect"] as Record<string, unknown>;
    // The entry itself carries connect; a nested entry must NOT be needed.
    assert.equal(typeof entry["connect"], "function");
    assert.equal((entry as Record<string, unknown>)["standard:connect"], undefined);
    assert.ok(getConnectMethod(w));
  });

  it("3. direct solana:signTransaction shape exposes the signing method", () => {
    const w = signWallet(async () => [{ signedTransaction: new Uint8Array([9]) }]);
    const sign = getSignMethod(w);
    assert.ok(typeof sign === "function");
  });

  it("4. no nested feature[solana:signTransaction] lookup is required", () => {
    const w = signWallet(async () => []);
    const entry = (w.features as Record<string, unknown>)["solana:signTransaction"] as Record<string, unknown>;
    assert.equal(typeof entry["signTransaction"], "function");
    assert.equal((entry as Record<string, unknown>)["solana:signTransaction"], undefined);
    assert.ok(getSignMethod(w));
  });

  it("missing features yield null (unsupported), not a crash", () => {
    const bare = { name: "X", features: {}, accounts: [] } as unknown as Wallet;
    assert.equal(getConnectMethod(bare), null);
    assert.equal(getSignMethod(bare), null);
    assert.equal(getDisconnectMethod(bare), null);
  });

  it("5. official array signing response normalizes correctly", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = normalizeSigningOutput([{ signedTransaction: bytes }]);
    assert.ok(out instanceof Uint8Array);
    assert.equal(out.length, 3);
  });

  it("6. empty signing response rejected", () => {
    assert.throws(() => normalizeSigningOutput([]), /empty signing output/);
  });

  it("7. malformed signing response rejected", () => {
    assert.throws(() => normalizeSigningOutput([{}]), /signedTransaction/);
    assert.throws(() => normalizeSigningOutput([{ signedTransaction: new Uint8Array(0) }]), /empty/);
    assert.throws(() => normalizeSigningOutput(null), /not an object/);
  });

  it("8. multi-account wallet: non-Solana first, Solana Devnet second -> selects second", () => {
    const accs = [
      account("0xevm", ["eip155:1"], []),
      account("So1Devnet", [DEVNET]),
    ];
    const chosen = selectSolanaAccount(accs, DEVNET);
    assert.ok(chosen);
    assert.equal(chosen?.address, "So1Devnet");
  });

  it("9. exact solana:devnet preferred over other Solana chains", () => {
    const accs = [
      account("Mainnet", ["solana:mainnet"]),
      account("Devnet", [DEVNET]),
    ];
    assert.equal(selectSolanaAccount(accs, DEVNET)?.address, "Devnet");
    // Order-independent: devnet second still wins.
    assert.equal(selectSolanaAccount([accs[1], accs[0]], DEVNET)?.address, "Devnet");
  });

  it("10. wallet with connect but no Solana signing account rejected cleanly", () => {
    const w = connectWallet([account("0xevm", ["eip155:1"], [])]);
    assert.ok(getConnectMethod(w));
    const out = selectSolanaAccount(
      (w.accounts ?? []) as readonly WalletAccount[],
      DEVNET
    );
    assert.equal(out, null);
  });

  it("account without signTransaction feature is skipped", () => {
    const accs = [account("NoSign", [DEVNET], ["solana:signAndSendTransaction"])];
    assert.equal(selectSolanaAccount(accs, DEVNET), null);
  });

  it("11. direct standard:disconnect shape works", async () => {
    let called = false;
    const w = {
      name: "Phantom",
      features: {
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { called = true; } },
      },
      accounts: [],
    } as unknown as Wallet;
    const disc = getDisconnectMethod(w);
    assert.ok(typeof disc === "function");
    await disc!();
    assert.equal(called, true);
  });

  it("12/13. remember/disconnect + silent-restore contract unchanged (session persistence)", async () => {
    // Contract lives in session.ts (covered by session.test.ts); here we pin
    // the provider-visible behavior: silent connect passes { silent: true }.
    let seen: unknown = "unset";
    const w = connectWallet([account("A", [DEVNET])], (async (input?: unknown) => {
      seen = input;
      return { accounts: [account("A", [DEVNET])] };
    }) as (...a: never[]) => Promise<unknown>);
    const connect = getConnectMethod(w);
    assert.ok(connect);
    await connect!({ silent: true } as never);
    assert.deepEqual(seen, { silent: true });
  });

  it("14. Phantom duplicate dedupe unchanged", async () => {
    const { dedupeWallets } = await import("./wallets.js");
    const mk = (extra = 0): Wallet =>
      ({
        name: "Phantom",
        icon: "",
        chains: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) },
          ...(extra > 0 ? { "extra:0": {} } : {}),
        },
        accounts: [],
      }) as unknown as Wallet;
    const out = dedupeWallets([mk(0), mk(1)], DEVNET);
    assert.equal(out.length, 1);
  });

  it("15. Solflare detection unchanged (direct shape detected)", () => {
    const w = signWallet(async () => [{ signedTransaction: new Uint8Array([1]) }]);
    (w as { name: string }).name = "Solflare";
    assert.ok(getConnectMethod(w));
    assert.ok(getSignMethod(w));
    const d = describeWalletForDiagnostics(w);
    assert.equal(d.name, "Solflare");
    assert.ok(d.features.includes("solana:signTransaction"));
  });

  it("diagnostics expose names/features only, never keys", () => {
    const w = signWallet(async () => []);
    const d = describeWalletForDiagnostics(w);
    assert.ok(!JSON.stringify(d).includes("111"));
    const a = describeAccountForDiagnostics(account("DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy", [DEVNET]));
    assert.equal(a.address, "DZZ2…SvNy");
    assert.deepEqual(a.chains, [DEVNET]);
  });
});
