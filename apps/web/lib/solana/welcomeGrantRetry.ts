/**
 * Welcome-grant unknown-confirmation safety (pure, unit-tested).
 *
 * Failure mode: sendRawTransaction returns a signature (the transaction may
 * have landed), then confirmTransaction throws/times out. Naively marking
 * the grant `failed` and sending another transfer on retry would DOUBLE-grant
 * (two 20-token transfers) if the first transaction actually landed.
 *
 * Lifecycle: pending -> submitted(signature) -> completed | failed.
 * The signature is persisted BEFORE confirmation is awaited. On an unknown
 * outcome the previous signature is re-checked via getSignatureStatuses:
 * - confirmed -> completed (no new transfer)
 * - failed/expired -> safe to send a replacement
 * - unknown + fresh -> return pending; NEVER send while it may still land
 * - unknown + stale -> still wait: expiry cannot prove that it did not
 *   ALREADY land. The B2 journal preserves signed bytes before sending.
 */

export const STALE_PENDING_MS = 10 * 60 * 1000;
/** Margin far beyond Solana blockhash expiry (~60-90s on Devnet). */
export const STALE_SUBMITTED_MS = 5 * 60 * 1000;

export type SigCheck =
  | { kind: "confirmed" }
  | { kind: "failed" }
  | { kind: "unknown" };

export type RetryDecision =
  | { action: "complete" }
  | { action: "retry-new-transfer" }
  | { action: "wait-pending" };

export function decideAfterUnknownConfirmation(
  check: SigCheck,
  _submittedAgeMs: number
): RetryDecision {
  if (check.kind === "confirmed") return { action: "complete" };
  if (check.kind === "failed") return { action: "retry-new-transfer" };
  return { action: "wait-pending" };
}
