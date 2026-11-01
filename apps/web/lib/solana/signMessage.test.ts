import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  getSignMessageMethod,
  signMessageBytes,
} from "./signMessage.js";

function msgWallet(impl?: (...a: never[]) => Promise<unknown>): Wallet {
  return {
    name: "Phantom",
    features: {
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: (impl ?? (async () => [{ signedMessage: new Uint8Array([1]), signature: new Uint8Array(64) }])) as (
          ...a: never[]
        ) => Promise<unknown>,
      },
    },
    accounts: [],
  } as unknown as Wallet;
}

const ACC = { address: "A", chains: ["solana:devnet"], features: [] } as unknown as WalletAccount;

describe("solana:signMessage adapter (direct feature access)", () => {
  it("finds the direct method (no nested lookup)", () => {
    const w = msgWallet();
    assert.ok(typeof getSignMessageMethod(w) === "function");
    const entry = (w.features as Record<string, unknown>)["solana:signMessage"] as Record<string, unknown>;
    assert.equal(typeof entry["signMessage"], "function");
    assert.equal(entry["solana:signMessage"], undefined);
  });

  it("returns null when unsupported", () => {
    const bare = { name: "X", features: {}, accounts: [] } as unknown as Wallet;
    assert.equal(getSignMessageMethod(bare), null);
  });

  it("validates 64-byte signatures", async () => {
    const w = msgWallet();
    const sig = await signMessageBytes(w, ACC, new Uint8Array([9]));
    assert.equal(sig.length, 64);
    await assert.rejects(
      signMessageBytes(
        msgWallet(async () => [{ signedMessage: new Uint8Array([1]), signature: new Uint8Array([2]) }]),
        ACC,
        new Uint8Array([9])
      ),
      /invalid signature/
    );
    await assert.rejects(signMessageBytes(msgWallet(async () => []), ACC, new Uint8Array([9])), /unexpected/);
  });

  it("missing method throws a clear unsupported error", async () => {
    const bare = { name: "X", features: {}, accounts: [] } as unknown as Wallet;
    await assert.rejects(signMessageBytes(bare, ACC, new Uint8Array([9])), /SIGN_MESSAGE_UNSUPPORTED/);
  });
});
