"use client";

import { useEffect, useRef, useState } from "react";
import { IS_DEVNET, MAINNET_REAL_VALUE_ENABLED, PROJECT_TOKEN_MINT } from "./cluster";

/**
 * DEVNET-ONLY first-connect auto-grant (200 test tokens, one-time).
 * Non-blocking, never crashes gameplay: failures are swallowed except for
 * an optional small notice. Server ledger is authoritative; the
 * sessionStorage hint only avoids redundant POSTs within one tab session.
 */
export function useDevnetWelcomeTokens(
  address: string | null,
  onGranted: () => void,
  enabled = true
): { notice: string | null } {
  const [notice, setNotice] = useState<string | null>(null);
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!address || !enabled) return;
    if (!IS_DEVNET || MAINNET_REAL_VALUE_ENABLED) return;
    if (!PROJECT_TOKEN_MINT) return;
    const claimIdentity = `${PROJECT_TOKEN_MINT}:${address}`;
    if (attemptedRef.current.has(claimIdentity)) return;
    let hint = false;
    try {
      hint = sessionStorage.getItem(`welcome-tokens:${claimIdentity}`) === "1";
    } catch {
      hint = false;
    }
    if (hint) return;
    attemptedRef.current.add(claimIdentity);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/devnet/welcome-tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address }),
        });
        const body = (await res.json().catch(() => null)) as { status?: string } | null;
        if (cancelled) return;
        if (res.ok && body?.status === "granted") {
          try {
            sessionStorage.setItem(`welcome-tokens:${claimIdentity}`, "1");
          } catch {
            // ignore
          }
          onGranted();
        } else if (body?.status === "already-granted") {
          try {
            sessionStorage.setItem(`welcome-tokens:${claimIdentity}`, "1");
          } catch {
            // ignore
          }
        } else if (body?.status === "pending") {
          // Another request holds the reservation (or a retry is due):
          // do NOT mark the hint — the next connect retries the grant.
          attemptedRef.current.delete(claimIdentity);
        } else if (!res.ok && res.status !== 503) {
          setNotice(null);
        }
      } catch {
        // Non-blocking: wallet connection/game UI must not crash when the
        // faucet is unavailable.
        if (!cancelled) setNotice(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, onGranted, enabled]);

  return { notice };
}
