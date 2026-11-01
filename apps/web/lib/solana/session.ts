/**
 * Wallet session persistence: remember the explicitly selected provider so a
 * page refresh can silently restore a previously authorized wallet.
 *
 * Rules:
 * - Only the wallet the user EXPLICITLY chose is remembered.
 * - Refresh restores that provider silently (no auto-select of arbitrary wallets).
 * - Explicit Disconnect clears the preference and prevents auto-restore.
 */

export const REMEMBERED_WALLET_KEY = "headstails.remembered-wallet";
export const PENDING_SIG_KEY = "headstails.pending-sig";

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberWallet(walletName: string): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(REMEMBERED_WALLET_KEY, walletName);
  } catch {
    // Storage full/blocked: session restore simply won't happen.
  }
}

export function forgetWallet(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(REMEMBERED_WALLET_KEY);
  } catch {
    // ignore
  }
}

export function getRememberedWallet(): string | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const v = s.getItem(REMEMBERED_WALLET_KEY);
    return v && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Temporarily persist a submitted signature for recovery across refresh. */
export function persistPendingSignature(action: string, signature: string): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(PENDING_SIG_KEY, JSON.stringify({ action, signature, at: Date.now() }));
  } catch {
    // ignore
  }
}

export function getPendingSignature(): { action: string; signature: string; at: number } | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(PENDING_SIG_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { action?: unknown; signature?: unknown; at?: unknown };
    if (typeof p.action !== "string" || typeof p.signature !== "string") return null;
    // Expire after 10 minutes; recovery is bounded.
    const at = typeof p.at === "number" ? p.at : 0;
    if (Date.now() - at > 10 * 60 * 1000) {
      s.removeItem(PENDING_SIG_KEY);
      return null;
    }
    return { action: p.action, signature: p.signature, at };
  } catch {
    return null;
  }
}

export function clearPendingSignature(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(PENDING_SIG_KEY);
  } catch {
    // ignore
  }
}
