import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
} from "@wallet-standard/features";
import type { SolanaSignTransactionFeature } from "@solana/wallet-standard-features";

/**
 * Wallet Standard adapter with the CORRECT feature shape.
 *
 * `wallet.features` already maps each feature name to its implementation
 * object, so access is DIRECT:
 *   wallet.features["standard:connect"].connect(...)
 *   wallet.features["solana:signTransaction"].signTransaction(...)
 *   wallet.features["standard:disconnect"].disconnect()
 *
 * There is NO nested `feature["standard:connect"]` lookup. A second lookup
 * always yields undefined and makes valid Phantom/Solflare registrations
 * appear unsupported.
 */

export type ConnectMethod = StandardConnectFeature["standard:connect"]["connect"];
export type DisconnectMethod = StandardDisconnectFeature["standard:disconnect"]["disconnect"];
export type SignMethod = SolanaSignTransactionFeature["solana:signTransaction"]["signTransaction"];

function entryOf(wallet: Wallet, name: string): Record<string, unknown> | null {
  try {
    const features = (wallet as unknown as { features?: unknown }).features as
      | Record<string, unknown>
      | undefined;
    const entry = features?.[name];
    if (!entry || typeof entry !== "object") return null;
    return entry as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Direct `standard:connect` method, or null when the wallet lacks it. */
export function getConnectMethod(wallet: Wallet): ConnectMethod | null {
  const entry = entryOf(wallet, "standard:connect");
  const method = entry?.["connect"];
  return typeof method === "function" ? (method as ConnectMethod) : null;
}

/** Direct `standard:disconnect` method, or null when the wallet lacks it. */
export function getDisconnectMethod(wallet: Wallet): DisconnectMethod | null {
  const entry = entryOf(wallet, "standard:disconnect");
  const method = entry?.["disconnect"];
  return typeof method === "function" ? (method as DisconnectMethod) : null;
}

/** Direct `solana:signTransaction` method, or null when the wallet lacks it. */
export function getSignMethod(wallet: Wallet): SignMethod | null {
  const entry = entryOf(wallet, "solana:signTransaction");
  const method = entry?.["signTransaction"];
  return typeof method === "function" ? (method as SignMethod) : null;
}

/**
 * Deterministically choose a compatible Solana signing account.
 * Never blindly takes accounts[0]: multi-chain wallets may list an
 * EVM/non-Solana account first.
 *
 * Preference: exact expected chain (e.g. `solana:devnet`) WITH
 * `solana:signTransaction` support, else any `solana:*` chain with signing
 * support. Returns null when no compatible Solana signing account exists.
 */
export function selectSolanaAccount(
  accounts: readonly WalletAccount[],
  expectedChain: string
): WalletAccount | null {
  const list = Array.isArray(accounts) ? accounts : [];
  const canSign = (a: WalletAccount): boolean => {
    try {
      const feats = (a as unknown as { features?: readonly unknown[] }).features;
      return Array.isArray(feats) && feats.includes("solana:signTransaction");
    } catch {
      return false;
    }
  };
  const chainsOf = (a: WalletAccount): readonly string[] => {
    try {
      return Array.isArray(a.chains) ? a.chains : [];
    } catch {
      return [];
    }
  };
  const exact = list.find((a) => chainsOf(a).includes(expectedChain) && canSign(a));
  if (exact) return exact;
  return list.find((a) => chainsOf(a).some((c) => c.startsWith("solana:")) && canSign(a)) ?? null;
}

/**
 * Normalize the official signing response.
 * Official contract: (...inputs) => Promise<readonly [{ signedTransaction }]>.
 * Some wallets historically returned a bare { signedTransaction } object.
 * Both shapes are accepted, then strictly validated.
 */
export function normalizeSigningOutput(raw: unknown): Uint8Array {
  let candidate: unknown = raw;
  // Official shape: array with exactly one output for a single transaction.
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new Error("WALLET_SIGNING_INVALID_OUTPUT: empty signing output");
    }
    if (raw.length !== 1) {
      throw new Error(
        `WALLET_SIGNING_INVALID_OUTPUT: expected exactly 1 signing result, got ${raw.length}`
      );
    }
    candidate = raw[0];
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("WALLET_SIGNING_INVALID_OUTPUT: signing result is not an object");
  }
  const signed = (candidate as Record<string, unknown>).signedTransaction;
  if (!(signed instanceof Uint8Array)) {
    // Some wallets return number[] or Buffer-like; coerce only if valid bytes.
    if (Array.isArray(signed) && signed.every((n) => typeof n === "number")) {
      const coerced = Uint8Array.from(signed as number[]);
      if (coerced.length === 0) {
        throw new Error("WALLET_SIGNING_INVALID_OUTPUT: signedTransaction is empty");
      }
      return coerced;
    }
    throw new Error("WALLET_SIGNING_INVALID_OUTPUT: signedTransaction is not valid transaction bytes");
  }
  if (signed.length === 0) {
    throw new Error("WALLET_SIGNING_INVALID_OUTPUT: signedTransaction is empty");
  }
  return signed;
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export interface WalletDiagnostics {
  name: string;
  features: string[];
  chains: string[];
  accountCount: number;
}

export interface AccountDiagnostics {
  address: string;
  chains: readonly string[];
  features: string[];
}

/** Safe diagnostics: names and feature lists only. Never keys or signatures. */
export function describeWalletForDiagnostics(wallet: Wallet): WalletDiagnostics {
  let name = "unknown";
  let features: string[] = [];
  let chains: string[] = [];
  let accountCount = 0;
  try {
    name = (wallet as { name?: unknown }).name as string;
  } catch {
    // ignore
  }
  try {
    features = Object.keys(
      (wallet as unknown as { features?: Record<string, unknown> }).features ?? {}
    );
  } catch {
    // ignore
  }
  try {
    const accounts = (wallet as unknown as { accounts?: readonly WalletAccount[] }).accounts ?? [];
    accountCount = accounts.length;
    const set = new Set<string>();
    for (const a of accounts) {
      for (const c of a?.chains ?? []) set.add(c);
    }
    chains = [...set];
  } catch {
    // ignore
  }
  return { name, features, chains, accountCount };
}

/** Safe per-account diagnostics: abbreviated address, chains, features. */
export function describeAccountForDiagnostics(account: WalletAccount): AccountDiagnostics {
  let address = "?";
  let chains: readonly string[] = [];
  let features: string[] = [];
  try {
    address = shortAddr(account.address);
  } catch {
    // ignore
  }
  try {
    chains = Array.isArray(account.chains) ? account.chains : [];
  } catch {
    // ignore
  }
  try {
    const f = (account as unknown as { features?: readonly unknown[] }).features;
    features = Array.isArray(f) ? (f as string[]) : [];
  } catch {
    // ignore
  }
  return { address, chains, features };
}
