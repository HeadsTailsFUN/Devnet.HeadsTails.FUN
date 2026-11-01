import {
  Connection,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AnchorWalletLike } from "./anchorWallet";
import { classifyError, isRateLimitError } from "./errors";
import { clearPendingSignature, persistPendingSignature } from "./session";
import { assertClientDevnetConnection } from "./devnetSafety";

function dbg(stage: string, data?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    console.debug(`[tx:${stage}]`, data ?? {});
  } catch {
    // ignore
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRateLimitRetry<T>(
  stage: string,
  fn: () => Promise<T>,
  tries = 3
): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRateLimitError(e) || i === tries - 1) throw e;
      dbg(`${stage}-rate-limit-retry`, { try: i + 1 });
      await sleep(800 * (i + 1));
    }
  }
  throw last;
}

/**
 * Finalize an unsigned anchor-built transaction with the connected wallet:
 * attach blockhash + fee payer, collect the wallet signature, send and
 * confirm. Returns the signature.
 *
 * Diagnostics cover: construction, blockhash, signing request/response,
 * serialization, deserialization (in anchor wallet), sendRawTransaction,
 * preflight, confirmation, state reconciliation.
 *
 * Once a signature exists it is persisted for recovery; confirmation
 * failures due to 429/timeout do NOT immediately fail — we reconcile from
 * chain state and only throw a classified UNKNOWN-confirmation error that the
 * caller maps to "Transaction submitted. Checking its on-chain status…".
 */
export async function signAndSend(
  connection: Connection,
  wallet: AnchorWalletLike,
  tx: Transaction | VersionedTransaction,
  opts: { action?: string } = {}
): Promise<string> {
  await assertClientDevnetConnection(connection);
  const action = opts.action ?? "game";
  // 1. transaction construction (caller-built; we finalize here).
  dbg("construct", { action, versioned: tx instanceof VersionedTransaction });
  // 2. blockhash.
  let blockhash = "";
  let lastValidBlockHeight = 0;
  try {
    const latest = await withRateLimitRetry("blockhash", () =>
      connection.getLatestBlockhash("confirmed")
    );
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  } catch (e) {
    const c = classifyError(e);
    dbg("blockhash-error", { technical: c.technical });
    throw new Error(`${c.code}: ${c.message}`);
  }
  if (tx instanceof VersionedTransaction) {
    tx.message.recentBlockhash = blockhash;
  } else {
    tx.feePayer = tx.feePayer ?? wallet.publicKey;
    tx.recentBlockhash = blockhash;
  }
  dbg("finalized", { blockhash: blockhash.slice(0, 8) });

  // 3-4. wallet signing request/response (validated inside signBytes +
  // anchor wallet deserialization).
  let signed: Transaction | VersionedTransaction;
  try {
    dbg("sign-request", { action });
    signed = await wallet.signTransaction(tx);
    dbg("sign-response", { ok: true });
  } catch (e) {
    const c = classifyError(e);
    dbg("sign-error", { technical: c.technical });
    // Preserve the classified code for the UI; never leak minified text.
    throw new Error(`${c.code}: ${c.message}`);
  }
  if (!signed) {
    throw new Error(
      "WALLET_SIGNING_INVALID_OUTPUT: Your wallet could not sign this transaction correctly. Please reconnect and try again."
    );
  }

  // 5. serialization.
  let raw: Uint8Array;
  try {
    raw =
      signed instanceof VersionedTransaction
        ? signed.serialize()
        : (signed as Transaction).serialize();
    dbg("serialized", { bytes: raw.length });
  } catch (e) {
    const c = classifyError(e);
    dbg("serialize-error", { technical: c.technical });
    throw new Error(`TRANSACTION_SERIALIZATION_ERROR: Could not prepare the transaction. Please try again.`);
  }
  if (!(raw instanceof Uint8Array) || raw.length === 0) {
    throw new Error("TRANSACTION_SERIALIZATION_ERROR: Could not prepare the transaction. Please try again.");
  }

  // 6-7. sendRawTransaction + preflight (bounded retry on 429 only when no
  // signature is known yet).
  let sig = "";
  try {
    sig = await withRateLimitRetry(
      "send",
      () =>
        connection.sendRawTransaction(raw, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }),
      3
    );
    dbg("sent", { sig: sig.slice(0, 8) });
  } catch (e) {
    const c = classifyError(e);
    dbg("send-error", { technical: c.technical });
    throw new Error(`${c.code}: ${c.message}`);
  }
  if (!sig) {
    throw new Error("TRANSACTION_SEND_FAILED: Could not submit the transaction. Please try again.");
  }

  // Persist for recovery before confirmation.
  try {
    persistPendingSignature(action, sig);
  } catch {
    // ignore
  }

  // 8-9. confirmation with bounded retries; on rate-limit/timeout, reconcile
  // from chain instead of failing the game action.
  try {
    await withRateLimitRetry(
      "confirm",
      () =>
        connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed"
        ),
      2
    );
    dbg("confirmed", { sig: sig.slice(0, 8) });
    try {
      clearPendingSignature();
    } catch {
      // ignore
    }
    return sig;
  } catch (e) {
    dbg("confirm-error", { technical: e instanceof Error ? e.message : String(e) });
    // Try one chain-status read before giving up: if the tx is confirmed
    // despite the RPC error, treat it as success.
    try {
      const st = await connection.getSignatureStatus(sig, {
        searchTransactionHistory: true,
      });
      const v = st?.value;
      if (v && !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) {
        try {
          clearPendingSignature();
        } catch {
          // ignore
        }
        return sig;
      }
      if (v?.err) {
        const msg = typeof v.err === "string" ? v.err : JSON.stringify(v.err);
        throw new Error(`PROGRAM_ERROR: The on-chain program rejected this action (${msg.slice(0, 120)}). Refreshing state…`);
      }
    } catch (inner) {
      // If the status read itself is rate-limited, keep the pending sig for
      // the caller to reconcile — do not report a failed game action.
      if (isRateLimitError(inner) || isRateLimitError(e)) {
        throw new Error(
          `TRANSACTION_CONFIRMATION_UNKNOWN: Transaction submitted. Checking its on-chain status…::${sig}`
        );
      }
      const c = classifyError(inner);
      if (c.code === "PROGRAM_ERROR") throw new Error(`${c.code}: ${c.message}`);
    }
    if (isRateLimitError(e)) {
      throw new Error(
        `TRANSACTION_CONFIRMATION_UNKNOWN: Transaction submitted. Checking its on-chain status…::${sig}`
      );
    }
    const c = classifyError(e);
    // Keep the signature attached so the caller can reconcile.
    throw new Error(`${c.code}: ${c.message}::${sig}`);
  }
}

export function shortSig(sig: string): string {
  const clean = sig.split("::")[0] ?? sig;
  return clean.length > 12 ? `${clean.slice(0, 4)}…${clean.slice(-4)}` : clean;
}

/** Extract the embedded recovery signature from a confirmation-unknown error. */
export function recoverySigFromError(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/::([1-9A-HJ-NP-Za-km-z]{80,100})\s*$/);
  return m?.[1] ?? null;
}

export function walletShort(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
