"use client";

/**
 * HT-FINAL-002: centralized wallet-session change notifications.
 *
 * Root cause: LiveGameClient's referral attribution effect required
 * `sessionWallet`, but Profile's `useAuthedFetch(... reload(true))` called
 * `ensureSession` without notifying the parent — so attribution never fired
 * after Profile verify. No polling: any child flow that establishes a
 * wallet session notifies the parent immediately via this event.
 */

export const SESSION_ESTABLISHED_EVENT = "ht:session-established";
export const SESSION_CLEARED_EVENT = "ht:session-cleared";

export function notifySessionEstablished(wallet?: string): void {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent<string | undefined>(SESSION_ESTABLISHED_EVENT, {
          detail: wallet,
        })
      );
    }
  } catch {
    // notifications must never break auth
  }
}

export function notifySessionCleared(): void {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(SESSION_CLEARED_EVENT));
    }
  } catch {
    // ignore
  }
}

export function subscribeSessionEstablished(listener: (wallet?: string) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }
  const handler = (e: Event): void => {
    listener((e as CustomEvent<string | undefined>).detail);
  };
  window.addEventListener(SESSION_ESTABLISHED_EVENT, handler);
  return () => window.removeEventListener(SESSION_ESTABLISHED_EVENT, handler);
}

export function subscribeSessionCleared(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }
  const handler = (): void => {
    listener();
  };
  window.addEventListener(SESSION_CLEARED_EVENT, handler);
  return () => window.removeEventListener(SESSION_CLEARED_EVENT, handler);
}
