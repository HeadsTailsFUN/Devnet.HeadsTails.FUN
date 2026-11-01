/**
 * HT-FINAL-001: safe Devnet welcome-grant diagnostic codes.
 *
 * Operators could not read Vercel runtime logs (403), so the exact
 * WELCOME_GRANT_* failure was UNKNOWN. This module centralises the SAFE
 * enum returned by the authenticated Devnet-only diagnostic endpoint.
 * No secrets, raw env values, or transaction material ever leave the server.
 */

export type WelcomeGrantDiagnosticCode =
  | "WELCOME_GRANT_READY"
  | "WELCOME_GRANT_CONFIG_MISSING"
  | "WELCOME_GRANT_SIGNER_INVALID"
  | "WELCOME_GRANT_TREASURY_UNAVAILABLE"
  | "WELCOME_GRANT_SOL_LOW"
  | "WELCOME_GRANT_INSUFFICIENT_BALANCE"
  | "WELCOME_GRANT_ATA_FAILURE"
  | "WELCOME_GRANT_RPC_FAILURE"
  | "WELCOME_GRANT_SEND_FAILURE"
  | "WELCOME_GRANT_CONFIRMATION_FAILURE";

export const WELCOME_GRANT_DIAGNOSTIC_CODES: readonly WelcomeGrantDiagnosticCode[] = [
  "WELCOME_GRANT_READY",
  "WELCOME_GRANT_CONFIG_MISSING",
  "WELCOME_GRANT_SIGNER_INVALID",
  "WELCOME_GRANT_TREASURY_UNAVAILABLE",
  "WELCOME_GRANT_SOL_LOW",
  "WELCOME_GRANT_INSUFFICIENT_BALANCE",
  "WELCOME_GRANT_ATA_FAILURE",
  "WELCOME_GRANT_RPC_FAILURE",
  "WELCOME_GRANT_SEND_FAILURE",
  "WELCOME_GRANT_CONFIRMATION_FAILURE",
] as const;

/** Fields that are safe to expose to an authenticated Web Admin. */
export interface WelcomeGrantDiagnosticFacts {
  code: WelcomeGrantDiagnosticCode;
  /** Public faucet signer address only (never the secret). */
  faucetPubkey: string | null;
  /** Devnet test mint under diagnosis (public constant, never a secret). */
  mint: string | null;
  treasuryAta: string | null;
  faucetSolLamports: number | null;
  treasuryBalanceBaseUnits: string | null;
  rpcIsDedicated: boolean;
  rpcMissing: boolean;
  config: {
    supabaseUrlSet: boolean;
    serviceRoleSet: boolean;
    faucetKeySet: boolean;
    faucetEnabled: boolean;
    clusterIsDevnet: boolean;
    mintMatches: boolean;
  };
  recentFailed: number | null;
  detail: string;
}

/** Strip anything secret-like from an operator-facing detail string. */
export function safeDiagnosticDetail(raw: unknown): string {
  const s = raw instanceof Error ? raw.message : String(raw ?? "");
  return s
    .replace(/[A-Za-z0-9+/=]{40,}/g, "[redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
}
