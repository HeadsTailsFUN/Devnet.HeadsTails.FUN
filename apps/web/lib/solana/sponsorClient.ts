"use client";

import { DEVNET_SPONSOR_UI_ENABLED, IS_DEVNET } from "./cluster";

/**
 * Client-side Devnet sponsor overlay (no secrets; server decides amounts).
 * UX: Connect → Get Test Tokens → Pick Side → Join. No manual SOL faucet step.
 */

export function isSponsorUiEnabled(): boolean {
  return IS_DEVNET && DEVNET_SPONSOR_UI_ENABLED;
}

export async function ensureSponsoredBalance(wallet: string): Promise<{
  ok: boolean;
  status?: string;
  reason?: string;
}> {
  if (!isSponsorUiEnabled()) return { ok: true, status: "disabled" };
  try {
    const res = await fetch("/api/devnet/sponsor/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    if (res.ok) {
      const b = (await res.json().catch(() => null)) as { status?: string } | null;
      return { ok: true, status: b?.status ?? "ok" };
    }
    const b = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, reason: b?.error ?? `prepare failed (${res.status})` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * User-paid actions only. `match`/`claim`/`settle` are intentionally
 * excluded: automatic settlement makes those direct server/sponsor
 * operations, so users never pay for (or receive reimbursement for) them.
 * The server rejects action=match/claim/settle.
 */
export type ReimbursableAction = "join" | "cancel";

/**
 * Best-effort sponsor matchmaking trigger after Join. Sends no game data:
 * the server derives everything from chain. Never fails the Join — the
 * player simply stays Queued and the keeper retries.
 */
export async function requestMatchCrank(): Promise<{ ok: boolean; status?: string }> {
  if (!isSponsorUiEnabled()) return { ok: true, status: "disabled" };
  try {
    const res = await fetch("/api/devnet/match-crank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const b = (await res.json().catch(() => null)) as { status?: string } | null;
    return { ok: res.ok, status: b?.status ?? "unknown" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
}

export async function requestReimbursement(  wallet: string,
  signature: string,
  action: ReimbursableAction
): Promise<{ ok: boolean; status?: string; reason?: string }> {
  if (!isSponsorUiEnabled()) return { ok: true, status: "disabled" };
  // Strip any embedded recovery suffix.
  const clean = signature.split("::")[0] ?? signature;
  try {
    const res = await fetch("/api/devnet/sponsor/reimburse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, signature: clean, action }),
    });
    const b = (await res.json().catch(() => null)) as {
      status?: string;
      error?: string;
    } | null;
    if (res.ok) return { ok: true, status: b?.status ?? "ok" };
    return { ok: false, reason: b?.error ?? `reimburse failed (${res.status})` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
