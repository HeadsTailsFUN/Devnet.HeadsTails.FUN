import type { Wallet } from "@wallet-standard/base";

/**
 * Wallet registry deduplication.
 * Multiple Wallet Standard registrations can represent the same wallet brand
 * (e.g. Phantom EVM + Solana, Trust Wallet duplicates). Render one usable row
 * per visible wallet brand.
 */

function getFeatureNames(w: Wallet): string[] {
  try {
    return Object.keys((w as unknown as { features?: Record<string, unknown> }).features ?? {});
  } catch {
    return [];
  }
}

function getChains(w: Wallet): string[] {
  const accounts = ((w as unknown as { accounts?: Array<{ chains?: readonly string[] }> }).accounts ?? []) as Array<{
    chains?: readonly string[];
  }>;
  const out = new Set<string>();
  for (const a of accounts) {
    for (const c of a?.chains ?? []) out.add(c);
  }
  // Also surface chains from the connect feature when accounts are empty.
  return [...out];
}

/** Normalize brand identity: case-insensitive, punctuation/space-insensitive. */
export function normalizeWalletName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Canonical brand label for the normalized identity. */
export function canonicalBrandLabel(normalized: string): string {
  const map: Record<string, string> = {
    phantom: "Phantom",
    solflare: "Solflare",
    trustwallet: "Trust Wallet",
    trust: "Trust Wallet",
    backpack: "Backpack",
    ronin: "Ronin",
    coinbase: "Coinbase",
    glow: "Glow",
    slope: "Slope",
    exodus: "Exodus",
  };
  if (map[normalized]) return map[normalized];
  return normalized;
}

export interface WalletScore {
  supportsConnect: boolean;
  supportsSignTx: boolean;
  supportsSolanaChain: boolean;
  featureCount: number;
  accountCount: number;
  score: number;
}

/** Deterministic usability score; higher is more usable. */
export function scoreWallet(w: Wallet, expectedChain: string): WalletScore {
  const features = getFeatureNames(w);
  const supportsConnect = features.includes("standard:connect");
  const supportsSignTx = features.includes("solana:signTransaction");
  const chains = getChains(w);
  const supportsSolanaChain =
    chains.length === 0 ? true : chains.some((c) => c === expectedChain || c.startsWith("solana:"));
  const rawAccounts = (w as unknown as { accounts?: readonly unknown[] }).accounts;
  const accountCount = Array.isArray(rawAccounts) ? rawAccounts.length : (rawAccounts?.length ?? 0);
  // Weighted: connect (100) + signTx (100) + chain (50) + features + accounts.
  const score =
    (supportsConnect ? 100 : 0) +
    (supportsSignTx ? 100 : 0) +
    (supportsSolanaChain ? 50 : 0) +
    Math.min(features.length, 20) +
    Math.min(accountCount, 5);
  return {
    supportsConnect,
    supportsSignTx,
    supportsSolanaChain,
    featureCount: features.length,
    accountCount,
    score,
  };
}

/**
 * Deduplicate wallet registrations to one usable row per brand.
 * Deterministic: for each normalized brand, keep the instance with the best
 * score (connect + signing + chain + completeness); ties broken by name.
 */
export function dedupeWallets(wallets: readonly Wallet[], expectedChain: string): Wallet[] {
  const best = new Map<string, { wallet: Wallet; score: number }>();
  for (const w of wallets) {
    const name = (w as { name?: unknown }).name;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    const key = normalizeWalletName(name);
    if (!key) continue;
    const s = scoreWallet(w, expectedChain).score;
    const prev = best.get(key);
    if (!prev || s > prev.score || (s === prev.score && name < (prev.wallet as { name: string }).name)) {
      best.set(key, { wallet: w, score: s });
    }
  }
  // Prefer usable wallets first (have connect+sign), then alphabetical for stability.
  return [...best.values()]
    .sort((a, b) => {
      const an = (a.wallet as { name: string }).name;
      const bn = (b.wallet as { name: string }).name;
      if (b.score !== a.score) return b.score - a.score;
      return an.localeCompare(bn);
    })
    .map((e) => e.wallet);
}

/** Stable React key for a wallet row (brand + icon hash, not object identity). */
export function walletRowKey(w: Wallet): string {
  const name = (w as { name?: string }).name ?? "unknown";
  return `wallet-${normalizeWalletName(name)}`;
}

export function isWalletUsable(w: Wallet, expectedChain: string): boolean {
  const s = scoreWallet(w, expectedChain);
  return s.supportsConnect && s.supportsSignTx && s.supportsSolanaChain;
}
