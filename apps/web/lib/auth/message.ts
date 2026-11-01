import { createHash } from "node:crypto";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("hex");
}

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "ht_session";

export interface Challenge {
  nonce: string;
  domain: string;
  wallet: string;
  cluster: string;
  issuedAt: string;
  expiresAt: string;
}

export function newNonce(): string {
  return randomHex(32);
}

/** Human-readable message the wallet signs (proves ownership, no funds move). */
export function buildAuthMessage(c: Challenge): string {
  return [
    "HeadsTails.fun — wallet verification",
    "",
    `Wallet: ${c.wallet}`,
    `Nonce: ${c.nonce}`,
    `Domain: ${c.domain}`,
    `Cluster: ${c.cluster}`,
    `Issued: ${c.issuedAt}`,
    `Expires: ${c.expiresAt}`,
    "",
    "This signature only proves you own this wallet. No funds move.",
  ].join("\n");
}

export function isChallengeFresh(c: { expiresAt: string }, nowMs = Date.now()): boolean {
  const exp = Date.parse(c.expiresAt);
  return Number.isFinite(exp) && nowMs < exp;
}

/** Opaque session token (stored hashed server-side). */
export function newSessionToken(): string {
  return randomHex(32);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
