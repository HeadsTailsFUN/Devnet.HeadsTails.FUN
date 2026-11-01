import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { SolanaSignMessageFeature } from "@solana/wallet-standard-features";

/**
 * Direct `solana:signMessage` adapter (same architecture as connect/sign).
 * wallet.features["solana:signMessage"] IS { version, signMessage }.
 * No nested lookup.
 */
export type SignMessageMethod =
  SolanaSignMessageFeature["solana:signMessage"]["signMessage"];

export function getSignMessageMethod(wallet: Wallet): SignMessageMethod | null {
  try {
    const features = (wallet as unknown as { features?: Record<string, unknown> }).features;
    const entry = features?.["solana:signMessage"] as Record<string, unknown> | undefined;
    const method = entry?.["signMessage"];
    return typeof method === "function" ? (method as SignMessageMethod) : null;
  } catch {
    return null;
  }
}

/**
 * Sign a human-readable auth message with the given account.
 * Returns the raw Ed25519 signature bytes. Throws classified errors.
 */
export async function signMessageBytes(
  wallet: Wallet,
  account: WalletAccount,
  message: Uint8Array
): Promise<Uint8Array> {
  const sign = getSignMessageMethod(wallet);
  if (!sign) {
    throw new Error("SIGN_MESSAGE_UNSUPPORTED: wallet does not support solana:signMessage");
  }
  const outputs = await sign({ account, message });
  if (!Array.isArray(outputs) || outputs.length !== 1) {
    throw new Error("SIGN_MESSAGE_INVALID_OUTPUT: wallet returned an unexpected signing result");
  }
  const sig = (outputs[0] as { signature?: unknown } | null)?.signature;
  if (!(sig instanceof Uint8Array) || sig.length !== 64) {
    throw new Error("SIGN_MESSAGE_INVALID_OUTPUT: wallet returned an invalid signature");
  }
  return sig;
}
