import { Transaction, VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import { assertDevnetConnection } from "./devnetSafety";
import { SPONSOR_DAILY_CAP_LAMPORTS } from "./sponsorGate";
import { getSupabaseAdmin, globalDailyCapLamports } from "./sponsorServer";

export type ExpenseKind = "prefund" | "reimburse" | "advance" | "match" | "settle" | "faucet";
export const OPERATION_RESERVATION_LAMPORTS = 50_000_000;
export const SETTLEMENT_RESERVE_LAMPORTS = 50_000_000;

export interface Expense {
  id: string;
  operation_key: string;
  wallet: string;
  kind: ExpenseKind;
  status: "reserved" | "submitted" | "confirmed" | "failed";
  claim_token: string;
  signature: string | null;
  raw_transaction: string | null;
  blockhash: string | null;
  last_valid_block_height: number | null;
}

export class ExpensePendingError extends Error {
  constructor(readonly phase: "send" | "confirmation" | "storage" | "outcome" = "outcome") { super("Operation pending; retry safely"); }
}
export class ExpenseBudgetError extends Error {
  constructor() { super("Daily operation budget unavailable"); }
}

async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error("Operation journal unavailable");
  return data;
}

/** Confirm from the trusted receipt, including failed-transaction fees. */
async function receipt(connection: Connection, db: SupabaseClient, row: Expense): Promise<string | null> {
  if (!row.signature) return null;
  const tx = await connection.getTransaction(row.signature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) return null;
  const pre = tx.meta.preBalances[0];
  const post = tx.meta.postBalances[0];
  if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post) || !tx.blockTime) throw new ExpensePendingError();
  const charge = Math.max(tx.meta.fee, pre - post, 0);
  const finished = await rpc(db, "finish_devnet_expense", {
    p_id: row.id, p_signature: row.signature, p_success: !tx.meta.err,
    p_charge: charge, p_day: new Date(tx.blockTime * 1000).toISOString().slice(0, 10),
  });
  if (!finished) throw new ExpensePendingError();
  if (tx.meta.err) throw new Error("Operation failed on chain; retry safely");
  return row.signature;
}

/**
 * All shared-treasury senders reserve before broadcasting. Signed public
 * transaction bytes are persisted before network I/O; concurrent/restarted
 * callers can only rebroadcast those same bytes. Unknown outcomes retain
 * their hold across midnight and never trigger a blind replacement.
 */
export async function sendJournaledTransaction(args: {
  connection: Connection;
  signer: Keypair;
  transaction: Transaction | VersionedTransaction;
  operationKey: string;
  wallet: string;
  kind: ExpenseKind;
  /** Fixed SOL transfer amount; fee is added from the compiled message. */
  transferLamports?: number;
  /** New attempts only; a persisted retry must not depend on treasury balance. */
  prepare?: () => Promise<void>;
  db?: SupabaseClient;
}): Promise<{ signature: string | null; reused: boolean }> {
  const { connection, signer, kind } = args;
  await assertDevnetConnection(connection);
  if (kind !== "faucet") {
    if (kind !== "settle" && process.env.DEVNET_SOL_SPONSOR_ENABLED !== "true") {
      throw new Error("New sponsorship disabled; settlement drain remains available");
    }
  }
  const db = args.db ?? getSupabaseAdmin();
  if (!db) throw new Error("Operation journal unavailable");
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = args.transaction;
  if (tx instanceof VersionedTransaction) {
    tx.message.recentBlockhash = latest.blockhash;
    tx.sign([signer]);
  } else {
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(signer);
  }
  const message = tx instanceof VersionedTransaction ? tx.message : tx.compileMessage();
  const quoted = await connection.getFeeForMessage(message, "confirmed");
  if (!Number.isSafeInteger(quoted.value) || quoted.value === null || quoted.value < 0) {
    throw new Error("Operation fee unavailable");
  }
  const globalCap = globalDailyCapLamports();
  const reserve = args.transferLamports === undefined
    ? Math.min(OPERATION_RESERVATION_LAMPORTS, globalCap, SPONSOR_DAILY_CAP_LAMPORTS)
    : args.transferLamports + quoted.value;
  if (!Number.isSafeInteger(reserve) || reserve < quoted.value) throw new Error("Invalid operation amount");
  const admitted = kind === "faucet" ? await rpc(db, "reserve_hts_welcome", {
    p_operation_key: args.operationKey, p_wallet: args.wallet,
    p_mint: process.env.NEXT_PUBLIC_HTS_TOKEN_MINT, p_lamports: reserve,
  }) : await rpc(db, "reserve_devnet_expense", {
    p_operation_key: args.operationKey, p_wallet: args.wallet, p_kind: kind,
    p_lamports: reserve, p_wallet_cap: SPONSOR_DAILY_CAP_LAMPORTS,
    p_global_cap: globalCap,
    p_drain_reserve: kind === "settle" ? 0 : Math.min(SETTLEMENT_RESERVE_LAMPORTS, globalCap),
  });
  if (admitted?.status === "legacy-completed") return { signature: null, reused: true };
  if (admitted?.status === "legacy-pending") throw new ExpensePendingError();
  if (admitted?.status === "wallet-cap" || admitted?.status === "global-cap") throw new ExpenseBudgetError();
  const row = admitted?.expense as Expense | undefined;
  if (!row?.id) throw new Error("Operation journal unavailable");
  if (row.status === "confirmed") return { signature: row.signature, reused: true };
  if (admitted.status === "reserved") {
    try {
      await args.prepare?.();
      if (args.transferLamports === undefined) {
        const pre = await connection.getBalance(signer.publicKey, "confirmed");
        const simulation = tx instanceof VersionedTransaction ? tx : VersionedTransaction.deserialize(tx.serialize());
        const simulated = await connection.simulateTransaction(simulation, {
          sigVerify: true, commitment: "confirmed",
          accounts: { addresses: [signer.publicKey.toBase58()], encoding: "base64" },
        });
        const post = simulated.value.accounts?.[0]?.lamports;
        if (simulated.value.err || !Number.isSafeInteger(post) || post === undefined || Math.max(quoted.value, pre-post) > reserve) {
          throw new Error("Operation preflight or cost check failed");
        }
      }
    } catch (error) {
      // Fenced release is safe only before signed bytes can be broadcast.
      await rpc(db, "cancel_unsubmitted_devnet_expense", { p_id: row.id, p_claim_token: row.claim_token });
      throw error;
    }
    const raw = Buffer.from(tx.serialize());
    const signature = bs58.encode(tx instanceof VersionedTransaction ? tx.signatures[0] : tx.signature!);
    const stored = await rpc(db, "submit_devnet_expense", {
      p_id: row.id, p_claim_token: row.claim_token, p_signature: signature,
      p_raw: raw.toString("base64"), p_blockhash: latest.blockhash,
      p_last_valid: latest.lastValidBlockHeight,
    });
    if (stored !== true) throw new ExpensePendingError("storage");
    Object.assign(row, { signature, raw_transaction: raw.toString("base64"),
      blockhash: latest.blockhash, last_valid_block_height: latest.lastValidBlockHeight });
  }
  if (!row.signature || !row.raw_transaction || !row.blockhash || row.last_valid_block_height === null) {
    throw new ExpensePendingError();
  }
  const existing = await receipt(connection, db, row);
  if (existing) return { signature: existing, reused: true };
  // An expired or unknown signature is held for reconciliation, never replaced
  // based only on elapsed wall-clock time or a missing RPC status. Exceptional
  // expired non-inclusion is resolved by the separately reviewed, service-only
  // release_expired_unlanded_devnet_expense RPC; public retries never call it.
  if (await connection.getBlockHeight("confirmed") > Number(row.last_valid_block_height)) throw new ExpensePendingError();
  let phase: "send" | "confirmation" = "send";
  try {
    await connection.sendRawTransaction(Buffer.from(row.raw_transaction, "base64"), {
      skipPreflight: false, preflightCommitment: "confirmed",
    });
    phase = "confirmation";
    await connection.confirmTransaction({ signature: row.signature, blockhash: row.blockhash,
      lastValidBlockHeight: Number(row.last_valid_block_height) }, "confirmed");
  } catch {
    const confirmed = await receipt(connection, db, row);
    if (confirmed) return { signature: confirmed, reused: admitted.status !== "reserved" };
    throw new ExpensePendingError(phase);
  }
  const confirmed = await receipt(connection, db, row);
  if (!confirmed) throw new ExpensePendingError();
  return { signature: confirmed, reused: admitted.status !== "reserved" };
}
