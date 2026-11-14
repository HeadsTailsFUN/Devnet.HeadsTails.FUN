"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { currentSessionWallet, ensureSession } from "@/lib/auth/client";

/** Personal data stays bound to the connected address, including late responses. */
export function useRewardResource<T>(url: string | null, wallet: Wallet | null, account: WalletAccount | null) {
  const identity = account?.address ?? "";
  const [result, setResult] = useState<{ identity: string; data: T } | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(!!identity);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async (withVerify = false) => {
    const request = ++generation.current;
    if (!url || !identity || !wallet || !account) {
      setResult(null); setLoading(false); setNeedsAuth(false); return;
    }
    setLoading(true); setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (withVerify) await ensureSession(wallet, account);
      if (request !== generation.current) return;
      if (await currentSessionWallet() !== identity) {
        if (request === generation.current) { setResult(null); setNeedsAuth(true); }
        return;
      }
      if (request !== generation.current) return;
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (request !== generation.current) return;
      if (response.status === 401) { setResult(null); setNeedsAuth(true); return; }
      if (!response.ok) throw new Error("Rewards are temporarily unavailable. Please try again.");
      const data = await response.json() as T;
      if (["/api/airdrop/points", "/api/referrals/mine"].includes(url) &&
          (data as { wallet?: string } | null)?.wallet !== identity) {
        throw new Error("Your wallet session changed. Verify the connected wallet and try again.");
      }
      if (request === generation.current) { setResult({ identity, data }); setNeedsAuth(false); }
    } catch (failure) {
      if (request === generation.current) {
        setResult(null);
        setError(failure instanceof Error ? failure.message : "Could not load rewards.");
      }
    } finally {
      clearTimeout(timeout);
      if (request === generation.current) setLoading(false);
    }
  }, [url, identity, wallet, account]);
  useEffect(() => {
    const requestGeneration = generation;
    setResult(null); setNeedsAuth(false); setError(null);
    void reload();
    return () => { requestGeneration.current++; };
  }, [reload]);
  return { data: result?.identity === identity ? result.data : null, needsAuth, loading, error, reload };
}
