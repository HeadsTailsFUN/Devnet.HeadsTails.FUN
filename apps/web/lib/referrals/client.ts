"use client";

import { isValidReferralCode, normalizeReferralCode } from "./code";

const KEY = "ht_pending_ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Store ?ref=CODE as pending first-party attribution (30 days). */
export function storePendingReferralFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("ref");
    if (!raw || !isValidReferralCode(raw)) return;
    const code = normalizeReferralCode(raw);
    window.localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // ignore
  }
}

export function getPendingReferral(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; at?: number };
    if (!parsed.code || !isValidReferralCode(parsed.code)) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return normalizeReferralCode(parsed.code);
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
