"use client";

import bs58 from "bs58";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getSignMessageMethod } from "@/lib/solana/signMessage";
import { notifySessionCleared, notifySessionEstablished } from "@/lib/auth/sessionEvents";

export interface ChallengePayload {
  nonce: string;
  domain: string;
  wallet: string;
  cluster: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Ensure a wallet-ownership session exists (challenge → sign → verify).
 * Required for profile/chat/admin writes and restricted-QA gameplay admission.
 * Throws a human-readable error when signMessage is unsupported.
 */
export async function ensureSession(
  wallet: Wallet,
  account: WalletAccount
): Promise<{ wallet: string }> {
  // HT-FINAL-002: notify the shared session event on success so the parent
  // (LiveGameClient referral attribution) becomes aware immediately when
  // ANY child flow (Profile verify, airdrop claim, bug submit) establishes
  // a session. No polling.
  const address = account.address;
  const chRes = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: address }),
  });
  if (!chRes.ok) throw new Error("Could not start wallet verification. Try again.");
  const chBody = (await chRes.json().catch(() => null)) as {
    challenge?: ChallengePayload;
    message?: string;
  } | null;
  if (!chBody?.challenge || !chBody.message) {
    throw new Error("Could not start wallet verification. Try again.");
  }
  const sign = getSignMessageMethod(wallet);
  if (!sign) {
    throw new Error("This wallet cannot sign verification messages. Profile and chat writes are unavailable.");
  }
  let outputs: unknown;
  try {
    outputs = await sign({ account, message: new TextEncoder().encode(chBody.message) });
  } catch (e) {
    if (e instanceof Error && /reject|denied|declined|cancel/i.test(e.message)) {
      throw new Error("You rejected the verification request in your wallet.");
    }
    throw new Error("Wallet message signing failed. Try again.");
  }
  const first = (Array.isArray(outputs) ? outputs[0] : null) as { signature?: unknown } | null;
  const sig = first?.signature;
  if (!(sig instanceof Uint8Array) || sig.length !== 64) {
    throw new Error("Wallet returned an invalid verification signature.");
  }
  const vRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: address, signature: bs58.encode(sig), challenge: chBody.challenge }),
  });
  if (!vRes.ok) {
    const b = (await vRes.json().catch(() => null)) as { error?: string } | null;
    throw new Error(b?.error ?? "Wallet verification failed.");
  }
  notifySessionEstablished(address);
  return { wallet: address };
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  } finally {
    notifySessionCleared();
  }
}

export async function currentSessionWallet(): Promise<string | null> {
  try {
    const r = await fetch("/api/auth/session", { cache: "no-store" });
    if (!r.ok) return null;
    const b = (await r.json().catch(() => null)) as { wallet?: unknown } | null;
    return typeof b?.wallet === "string" ? b.wallet : null;
  } catch {
    return null;
  }
}
