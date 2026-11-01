/**
 * Devnet-only SOL sponsor gates + limits (shared by API routes and tests).
 * Mainnet must NEVER use this: fail closed on any mainnet signal.
 *
 * Operational target 0.02 SOL: brand-new zero-SOL wallets must be able to
 * execute the first HeadsTails action (PlayerState + QueueEntry rent paid by
 * the player, plus fees/ORAO/buffer). Never use a fixed 0.002 SOL target.
 */

export const SPONSOR_OPERATIONAL_TARGET_LAMPORTS = 20_000_000; // 0.02 SOL safe operational target
/** Back-compat alias: previous 0.002 SOL constant now equals the safe target. */
export const SPONSOR_MIN_OPERATIONAL_LAMPORTS = SPONSOR_OPERATIONAL_TARGET_LAMPORTS;
export const SPONSOR_MAX_PREFUND_LAMPORTS = 20_000_000; // 0.02 SOL max per pre-fund (zero -> target in one go)
export const SPONSOR_MAX_REIMBURSE_PER_ACTION_LAMPORTS = 50_000_000; // 0.05 SOL cap/action
export const SPONSOR_DAILY_CAP_LAMPORTS = 500_000_000; // 0.5 SOL / wallet / day
/** Global daily outflow safety cap (all wallets). Configurable server-side. */
export const SPONSOR_GLOBAL_DAILY_CAP_DEFAULT_LAMPORTS = 2_000_000_000; // 2 SOL/day default
export const SPONSOR_ALLOWED_ACTIONS = [
  "join",
  "cancel",
  "match",
  "claim",
  "settle",
] as const;
export type SponsorAction = (typeof SPONSOR_ALLOWED_ACTIONS)[number];

/**
 * Pinned Devnet sponsor/keeper signer (public key only; secret stays server-only).
 * The match crank fails closed unless the loaded secret derives this key.
 */
import { HTS_SERVICE_SIGNER, validServiceSigner } from "./releaseToken";
export const EXPECTED_SPONSOR_PUBKEY = validServiceSigner(HTS_SERVICE_SIGNER) ? HTS_SERVICE_SIGNER : "";

/**
 * User-paid actions eligible for reimbursement. Only actions the user
 * actually pays for: Join + Cancel. `match`/`claim`/`settle` are direct
 * server/sponsor operations under automatic settlement — users never sign
 * them, so reimbursement requests for those are rejected.
 */
export const USER_REIMBURSABLE_ACTIONS = ["join", "cancel"] as const;
export type UserReimbursableAction = (typeof USER_REIMBURSABLE_ACTIONS)[number];

export function isUserReimbursableAction(a: unknown): a is UserReimbursableAction {
  return (
    typeof a === "string" &&
    (USER_REIMBURSABLE_ACTIONS as readonly string[]).includes(a)
  );
}

export interface SponsorEnv {
  cluster?: string;
  sponsorEnabled?: string;
  mainnetRealValue?: string;
}

export type GateResult = { ok: true } | { ok: false; reason: string };

export function evaluateSponsorGate(env: SponsorEnv): GateResult {
  const cluster = (env.cluster ?? "devnet").trim();
  if (cluster !== "devnet") return { ok: false, reason: "sponsor is devnet-only" };
  if (env.sponsorEnabled !== "true") return { ok: false, reason: "sponsor is disabled" };
  if (env.mainnetRealValue === "true") {
    return { ok: false, reason: "refusing: mainnet real value is enabled" };
  }
  return { ok: true };
}

/** Build-time/runtime assertion: never enable sponsor with Mainnet. */
export function assertSponsorSafeOrThrow(opts: {
  cluster: string;
  sponsorEnabled: boolean;
  mainnetRealValue: boolean;
}): void {
  if (opts.sponsorEnabled && (opts.cluster === "mainnet-beta" || opts.mainnetRealValue)) {
    throw new Error(
      "FATAL: DEVNET_SOL_SPONSOR_ENABLED must never be true with mainnet cluster or MAINNET_REAL_VALUE_ENABLED."
    );
  }
}

export function isValidSponsorAction(a: unknown): a is SponsorAction {
  return typeof a === "string" && (SPONSOR_ALLOWED_ACTIONS as readonly string[]).includes(a);
}

export function isValidWallet(address: unknown): boolean {
  if (typeof address !== "string") return false;
  if (address.length < 32 || address.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
}

export function isValidSignature(sig: unknown): boolean {
  if (typeof sig !== "string") return false;
  if (sig.length < 80 || sig.length > 100) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(sig);
}

/**
 * Pre-fund amount to reach the safe operational target.
 * - wallet 0 SOL -> full target (~0.02 SOL)
 * - wallet 0.005 SOL -> only the difference
 * - wallet >= target -> 0 (no pre-fund)
 * Existing balance never blocks later reimbursement.
 */
export function computePrefundLamports(currentLamports: number | null): number {
  if (currentLamports === null || !Number.isFinite(currentLamports)) {
    return SPONSOR_OPERATIONAL_TARGET_LAMPORTS;
  }
  if (currentLamports >= SPONSOR_OPERATIONAL_TARGET_LAMPORTS) return 0;
  const need = SPONSOR_OPERATIONAL_TARGET_LAMPORTS - Math.max(0, Math.floor(currentLamports));
  return Math.min(need, SPONSOR_MAX_PREFUND_LAMPORTS);
}

/** Action-aware estimate (fee + rent + ORAO + buffer) — informational. */
export function estimateActionCostLamports(
  action: SponsorAction
): { fee: number; rent: number; buffer: number; total: number } {
  const fee = 10_000;
  let rent = 0;
  if (action === "join") rent = 4_500_000; // PlayerState + QueueEntry
  else if (action === "match") rent = 3_500_000; // Match PDA + VRF request share
  else if (action === "claim" || action === "settle") rent = 500_000; // possible winner ATA
  const buffer = 5_000_000;
  return { fee, rent, buffer, total: fee + rent + buffer };
}

/** Global daily outflow cap (server-configurable). */
export function getGlobalDailyCapLamports(): number {
  const raw = process.env.DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n > 0) return n;
    throw new Error("Invalid Devnet sponsor daily cap");
  }
  return SPONSOR_GLOBAL_DAILY_CAP_DEFAULT_LAMPORTS;
}
