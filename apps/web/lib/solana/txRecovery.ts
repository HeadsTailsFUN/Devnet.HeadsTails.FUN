import type { Connection } from "@solana/web3.js";

/**
 * Signed-transaction recovery.
 * A wallet approval followed by an RPC failure must NOT automatically mean
 * the gameplay action failed. Once a signature exists, reconcile from chain.
 */

export type RecoveryOutcome =
  | "absent" // transaction absent: safe retry
  | "queued" // player is queued: show Queued
  | "matched" // player matched: show Match Found / Flipping
  | "failed" // on-chain failure: show actual program error
  | "unknown"; // temporarily unknown: keep bounded reconciliation active

export interface RecoveryProbes {
  signatureStatus: "confirmed" | "finalized" | "not-found" | "error" | "unknown";
  hasPlayerState: boolean;
  queued: boolean;
  inMatch: boolean;
  signatureError: string | null;
}

/** Map chain probes to a recovery outcome (pure; unit-tested). */
export function decideRecoveryOutcome(p: RecoveryProbes): RecoveryOutcome {
  if (p.signatureError) return "failed";
  if (p.inMatch) return "matched";
  if (p.queued && p.hasPlayerState) return "queued";
  if (p.signatureStatus === "not-found" && !p.hasPlayerState) return "absent";
  if (p.signatureStatus === "confirmed" || p.signatureStatus === "finalized") {
    // Confirmed on-chain but no queue/match state visible yet: indexer lag.
    // Keep reconciling rather than resubmitting a duplicate Join.
    return "unknown";
  }
  return "unknown";
}

export interface ReconcileDeps {
  getSignatureStatus: (sig: string) => Promise<{
    found: boolean;
    err: string | null;
    confirmationStatus: string | null;
  }>;
  getPlayerStatus: () => Promise<{ exists: boolean; queued: boolean; inMatch: boolean }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bounded reconciliation: poll signature status + player state a few times.
 * Never sends a duplicate Join while status is ambiguous — returns "unknown"
 * so the caller keeps the UI in a checking state instead of resubmitting.
 */
export async function reconcileAfterAmbiguousSubmit(
  deps: ReconcileDeps,
  signature: string,
  opts: { tries?: number; delayMs?: number } = {}
): Promise<RecoveryOutcome> {
  const tries = opts.tries ?? 6;
  const delayMs = opts.delayMs ?? 2000;
  let last: RecoveryOutcome = "unknown";
  for (let i = 0; i < tries; i++) {
    try {
      const s = await deps.getSignatureStatus(signature);
      const p = await deps.getPlayerStatus();
      const probes: RecoveryProbes = {
        signatureStatus: s.err
          ? "error"
          : s.found
            ? (s.confirmationStatus === "finalized" ? "finalized" : "confirmed")
            : "not-found",
        hasPlayerState: p.exists,
        queued: p.queued,
        inMatch: p.inMatch,
        signatureError: s.err,
      };
      last = decideRecoveryOutcome(probes);
      if (last === "queued" || last === "matched" || last === "failed" || last === "absent") {
        // absent on first try may still be propagation lag; confirm once more.
        if (last === "absent" && i < 2) {
          await sleep(delayMs);
          continue;
        }
        return last;
      }
    } catch {
      last = "unknown";
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  return last;
}

/** Live chain probes for a Join signature (uses trusted connection). */
export async function probeJoinRecovery(
  connection: Connection,
  signature: string,
  fetchPlayer: () => Promise<{ exists: boolean; queued: boolean; inMatch: boolean }>
): Promise<RecoveryOutcome> {
  return reconcileAfterAmbiguousSubmit(
    {
      getSignatureStatus: async (sig) => {
        try {
          const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          const v = st?.value;
          if (!v) return { found: false, err: null, confirmationStatus: null };
          if (v.err) {
            const msg = typeof v.err === "string" ? v.err : JSON.stringify(v.err);
            return { found: true, err: msg.slice(0, 300), confirmationStatus: v.confirmationStatus ?? null };
          }
          return { found: true, err: null, confirmationStatus: v.confirmationStatus ?? null };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("429")) return { found: false, err: null, confirmationStatus: null };
          throw e;
        }
      },
      getPlayerStatus: fetchPlayer,
    },
    signature,
    { tries: 6, delayMs: 2000 }
  );
}
