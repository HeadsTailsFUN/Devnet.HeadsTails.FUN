/**
 * Devnet test-token faucet security gates (shared by the API route and
 * unit tests). Mainnet builds/configuration MUST fail closed.
 */

import { HTS_TOKEN_MINT, validHtsMint } from "./releaseToken";
export const DEVNET_TEST_MINT = HTS_TOKEN_MINT;
export const FAUCET_CLAIM_HTS = 10_000;
export const FAUCET_CLAIM_BASE_UNITS = BigInt(FAUCET_CLAIM_HTS) * BigInt(1_000_000);
export const FAUCET_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** Faucet signer must hold at least this much SOL to serve claims. */
export const FAUCET_MIN_SOL_LAMPORTS = BigInt(5_000_000);

export interface FaucetEnv {
  cluster?: string;
  faucetEnabled?: string;
  mainnetRealValue?: string;
  configuredMint?: string;
}

export type GateResult = { ok: true } | { ok: false; reason: string };

function isFalsyOff(value: string | undefined): boolean {
  return value !== "true";
}

export function evaluateFaucetGate(env: FaucetEnv): GateResult {
  const cluster = (env.cluster ?? "devnet").trim();
  if (cluster !== "devnet") {
    return { ok: false, reason: "faucet is devnet-only" };
  }
  if (env.faucetEnabled !== "true") {
    return { ok: false, reason: "faucet is disabled" };
  }
  if (!isFalsyOff(env.mainnetRealValue)) {
    return { ok: false, reason: "refusing: mainnet real value is enabled" };
  }
  if (!validHtsMint(DEVNET_TEST_MINT) || (env.configuredMint ?? "").trim() !== DEVNET_TEST_MINT) {
    return { ok: false, reason: "faucet mint is not the approved devnet test mint" };
  }
  return { ok: true };
}

export function isValidWallet(address: unknown): boolean {
  if (typeof address !== "string") return false;
  if (address.length < 32 || address.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
}
