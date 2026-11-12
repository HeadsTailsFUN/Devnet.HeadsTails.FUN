import { parseMatchId, settlementScanHighWater } from "./jobPolicy";
import { assertDevnetConnection } from "@/lib/solana/devnetSafety";
import { sendJournaledTransaction } from "@/lib/solana/expenseJournal";
import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  gameIdlJson, resolveGameMatch, playerPda as sdkPlayerPda,
  type HeadsOrTails,
} from "@heads-or-tails/game-sdk";
import { indexSettlementSignature } from "@/lib/history/indexSettlement";
import { recoverSettledMatchHistory } from "@/lib/history/recoverSettled";
import {
  getServerConnection,
  getSupabaseAdmin,
  loadSponsorKeypair,
} from "@/lib/solana/sponsorServer";

/**
 * Durable automatic settlement (server-only).
 *
 * Chain remains authoritative: the server NEVER chooses result/winner/pot/
 * destination. It re-reads the Match PDA + the exact ORAO randomness account
 * derived from the Match seed, derives the winner deterministically, submits
 * the permissionless `settle_match` as fee-payer/caller with the dedicated
 * operational signer, confirms, re-reads, verifies Settled, then indexes.
 *
 * Idempotency: safe across duplicate starts, restarts, refreshes, retries,
 * races (AlreadySettled is benign success). On-chain Match state is final.
 */

export const SETTLEMENT_RETRY_DELAYS_MS = [2000, 3000, 5000, 5000, 10000, 15000, 30000];
export const SETTLEMENT_STEADY_RETRY_MS = 60000;
export const SETTLEMENT_MAX_ATTEMPTS = 60;

export type EnsureResult =
  | { status: "settled"; signature: string; already?: boolean }
  | { status: "already-settled"; transitioned?: boolean; historyPending?: boolean }
  | { status: "pending"; reason: "waiting-for-orao" | "randomness-missing" | "retry-scheduled" }
  | { status: "failed"; error: string };

export type SettlementStatus =
  | { status: "settled"; matchId: string; result: "HEADS" | "TAILS"; winner: string; pot: string; settledAt: string | null }
  | { status: "auto-settlement-pending"; matchId: string; result: "HEADS" | "TAILS"; winner: string | null }
  | { status: "waiting-for-orao"; matchId: string }
  | { status: "missing"; matchId: string }
  | { status: "unavailable"; reason: string };

const GAME_PROGRAM_ID =
  process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

async function sendSponsorTx(connection: Connection, sponsorKp: Keypair,
  tx: Transaction | VersionedTransaction, matchId: bigint, settlementRentLamports: number): Promise<string> {
  const result = await sendJournaledTransaction({ connection, signer: sponsorKp, transaction: tx,
    operationKey: `settle:${matchId}`, kind: "settle", wallet: sponsorKp.publicKey.toBase58(), settlementRentLamports });
  if (!result.signature) throw new Error("Operation receipt unavailable");
  return result.signature;
}

function readRandomnessFulfilled(
  data: Uint8Array,
  expectedSeed: Uint8Array
): { fulfilled: true; resultBit: 0 | 1; randomness: Uint8Array } | { fulfilled: false } {
  // ORAO RandomnessV2: 8 discriminator + 1 tag + 32 client + 32 seed + 64 randomness.
  if (data.length < 8 + 1 + 32 + 32) return { fulfilled: false };
  if (data[8] !== 1) return { fulfilled: false };
  const seed = data.slice(8 + 1 + 32, 8 + 1 + 32 + 32);
  if (Buffer.from(seed).compare(Buffer.from(expectedSeed)) !== 0) {
    return { fulfilled: false };
  }
  const randomness = data.slice(8 + 1 + 32 + 32, 8 + 1 + 32 + 32 + 64);
  if (randomness.length < 64) return { fulfilled: false };
  return { fulfilled: true, resultBit: (randomness[0] & 1) === 0 ? 0 : 1, randomness };
}

function randomnessPda(seed: Uint8Array): PublicKey {
  const orao = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
  return PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), Buffer.from(seed)],
    orao
  )[0];
}

async function validatedMatch(_connection: Connection, program: Program<HeadsOrTails>, matchId: bigint) {
  const resolved = await resolveGameMatch(program, matchId);
  return resolved ? {...resolved.match, generation: resolved.generation, address: resolved.address, config: resolved.config, configAddress: resolved.configAddress} : null;
}

export async function queueSettlementJob(matchId: bigint, tierUsd?: number, dependencies?: {
  db: SupabaseClient; connection: Connection; program: Program<HeadsOrTails>;
}): Promise<void> {
  if (parseMatchId(matchId) === null) return;
  const db = dependencies?.db ?? getSupabaseAdmin();
  const connection = dependencies?.connection ?? getServerConnection().connection;
  if (!db || !connection) return;
  await assertDevnetConnection(connection);
  const provider = new AnchorProvider(connection, { publicKey: PublicKey.default } as Wallet, { commitment: "confirmed" });
  const program = dependencies?.program ?? new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  const match = await validatedMatch(connection, program, matchId);
  if (!match || String(Object.keys(match.state as object)[0]).toLowerCase() !== "waitingforrandomness") return;
  if (tierUsd !== undefined && tierUsd !== match.tierUsd) return;
  const result = await db.from("settlement_jobs").upsert({ match_id: matchId.toString(),
    tier_usd: match.tierUsd, status: "queued", attempts: 0,
    next_attempt_at: new Date().toISOString(), last_error: null },
    { onConflict: "match_id", ignoreDuplicates: true });
  if (result.error) throw new Error("Settlement journal unavailable");
}

async function markJob(matchId: bigint,
  patch: { status: string; last_error?: string | null; next_attempt_at?: string | null; attemptsDelta?: number }
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const result = await db.rpc("finish_devnet_settlement_attempt", {
    p_match_id: matchId.toString(), p_status: patch.status, p_error: patch.last_error ?? null });
  if (result.error) throw new Error("Settlement journal unavailable");
}

/**
 * HT-FINAL-005: update an EXISTING durable job only. Returns true when a row
 * existed and was moved, false when no row existed (caller must NOT create
 * one for the already-settled reconciliation case). Uses UPDATE, never
 * UPSERT, so scanning a historical settled match without a job row can
 * never manufacture history.
 */
export async function updateExistingJob(
  matchId: bigint | string,
  patch: { status: string; last_error?: string | null; next_attempt_at?: string | null },
  database?: SupabaseClient
): Promise<boolean> {
  try {
    const db = database ?? getSupabaseAdmin();
    if (!db) return false;
    const id = typeof matchId === "string" ? matchId : matchId.toString();
    const existing = await db
      .from("settlement_jobs")
      .select("match_id,status")
      .eq("match_id", id)
      .maybeSingle();
    const row = existing.data as { match_id?: string; status?: string } | null;
    if (existing.error || !row?.match_id) return false;
    // Idempotent telemetry: an already-settled row is not a transition.
    if (row.status === patch.status && patch.status === "settled") return false;
    const updated = await db
      .from("settlement_jobs")
      .update({
        status: patch.status,
        next_attempt_at: patch.next_attempt_at === undefined ? new Date().toISOString() : patch.next_attempt_at,
        last_error: patch.last_error ?? null,
      })
      .eq("match_id", id)
      .eq("status", row.status)
      .select("match_id")
      .maybeSingle();
    return !updated.error && !!updated.data && row.status !== patch.status;
  } catch {
    return false;
  }
}

async function recoverHistory(connection: Connection, programId: PublicKey, matchId: bigint, address: PublicKey): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    await recoverSettledMatchHistory({ connection, db, programId, cluster: CLUSTER, matchId: matchId.toString(), matchAddress: address });
    return true;
  } catch {
    await updateExistingJob(matchId, { status: "pending", last_error: "settled on chain; history retry pending",
      next_attempt_at: new Date(Date.now() + 15_000).toISOString() });
    return false;
  }
}

/** Idempotent server settlement for exactly one Match ID. */
export async function ensureSettlement(matchIdRaw: unknown): Promise<EnsureResult> {
  const matchId = parseMatchId(matchIdRaw);
  if (matchId === null) return { status: "failed", error: "invalid match id" };

  const sponsor = loadSponsorKeypair();
  if (!sponsor) return { status: "failed", error: "settlement unavailable" };
  const { connection } = getServerConnection();
  if (!connection) return { status: "failed", error: "settlement unavailable" };

  await assertDevnetConnection(connection);
  const programId = new PublicKey(GAME_PROGRAM_ID);
  const provider = new AnchorProvider(
    connection,
    { publicKey: sponsor.publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  const sponsorKp = Keypair.fromSecretKey(sponsor.secretKey);

  // 1. Re-read Match. Already Settled -> benign success (idempotent).
  // HT-FINAL-005: update an existing durable row only; never manufacture a
  // historical job row for a settled match that has no job.
  const m = await validatedMatch(connection, program, matchId);
  if (!m) {
    await updateExistingJob(matchId, { status: "failed", last_error: "match not found", next_attempt_at: null });
    return { status: "failed", error: "match not found" };
  }
  const mpda = m.address;
  const state = String(Object.keys(m.state as object)[0] ?? "").toLowerCase();
  if (state === "settled") {
    if (!await recoverHistory(connection, programId, matchId, mpda)) {
      return { status: "already-settled", historyPending: true };
    }
    const transitioned = await updateExistingJob(matchId, { status: "settled" });
    return { status: "already-settled", transitioned };
  }
  if (state !== "waitingforrandomness") {
    return { status: "failed", error: "match not awaiting randomness" };
  }

  await queueSettlementJob(matchId);
  const dbForJob = getSupabaseAdmin();
  if (!dbForJob) return { status: "failed", error: "settlement journal unavailable" };
  const claimed = await dbForJob.rpc("claim_devnet_settlement_job", { p_match_id: matchId.toString() });
  if (claimed.error) return { status: "failed", error: "settlement journal unavailable" };
  if (claimed.data === null) return { status: "pending", reason: "retry-scheduled" };

  // 2. Inspect the EXACT ORAO randomness account derived from the Match seed.
  const seed = Buffer.from(m.seed as unknown as number[]);
  // Program-owned Match.seed is authoritative for BOTH v1 and nonce v2.
  if (seed.length !== 32) return { status: "failed", error: "invalid stored seed" };
  const randomness = randomnessPda(seed);
  const info = await connection.getAccountInfo(randomness).catch(() => null);
  if (!info?.data) {
    await markJob(matchId, {
      status: "pending",
      last_error: "randomness missing",
      next_attempt_at: new Date(Date.now() + SETTLEMENT_RETRY_DELAYS_MS[0]).toISOString(),
      attemptsDelta: 1,
    });
    return { status: "pending", reason: "randomness-missing" };
  }
  const r = readRandomnessFulfilled(
    info.data instanceof Uint8Array ? info.data : Uint8Array.from(info.data as Uint8Array),
    seed
  );
  if (!r.fulfilled) {
    await markJob(matchId, {
      status: "pending",
      last_error: "waiting for ORAO",
      next_attempt_at: new Date(Date.now() + SETTLEMENT_RETRY_DELAYS_MS[0]).toISOString(),
      attemptsDelta: 1,
    });
    return { status: "pending", reason: "waiting-for-orao" };
  }

  // 3. Derive winner data FROM CHAIN ONLY (never client-supplied).
  const resultBit = r.resultBit;
  const winner = (resultBit === 0 ? m.headsPlayer : m.tailsPlayer) as PublicKey;
  const cfg = m.config;
  const projectMint = cfg.projectMint as PublicKey;
  const { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } =
    await import("@solana/spl-token");
  const winnerAta = PublicKey.findProgramAddressSync(
    [winner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), projectMint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  const headsState = sdkPlayerPda(programId, m.headsPlayer as PublicKey, m.generation)[0];
  const tailsState = sdkPlayerPda(programId, m.tailsPlayer as PublicKey, m.generation)[0];

  const preIxs = [];
  // An RPC outage is not evidence that the account is absent.
  const ataInfo = await connection.getAccountInfo(winnerAta);
  // A prefunded system account at the ATA address is not an initialized token
  // account. Idempotent ATA creation safely handles that case as well.
  const needsAta = !ataInfo || !ataInfo.owner.equals(TOKEN_PROGRAM_ID) || ataInfo.data.length !== 165;
  const settlementRentLamports = needsAta ? await connection.getMinimumBalanceForRentExemption(165) : 0;
  if (needsAta) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        sponsorKp.publicKey,
        winnerAta,
        winner,
        projectMint
      )
    );
  }

  // Human-readable explorer memo (convenience metadata ONLY, never
  // authoritative). Derived server-side from chain data (Match + exact ORAO
  // randomness/result) and cross-checked against the settlement calculation
  // above. Protocol correctness never depends on it; permissionless
  // settlement without a memo stays valid.
  try {
    const { TransactionInstruction, PublicKey: Pk } = await import("@solana/web3.js");
    const resultSide = resultBit === 0 ? "HEADS" : "TAILS";
    const w = winner.toBase58();
    const memoText = `HeadsTails.fun | Match #${matchId.toString()} | Result: ${resultSide} | Winner: ${w.slice(0, 4)}…${w.slice(-4)}`;
    preIxs.push(
      new TransactionInstruction({
        programId: new Pk("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        keys: [],
        data: Buffer.from(memoText, "utf8"),
      })
    );
  } catch {
    // Memo is optional: settlement proceeds without it.
  }

  // 4. Submit sponsor-paid settle_match (caller is fee-payer only).
  let sig = "";
  try {
    const { BN } = await import("@coral-xyz/anchor");
    const tx = await program.methods
      [m.generation === "hts" ? "settleHtsMatch" : "settleMatch"](new BN(matchId.toString()))
      .accountsPartial({
        config: m.configAddress,
        caller: sponsorKp.publicKey,
        randomness,
        headsState,
        tailsState,
        projectMint,
        winnerTokens: winnerAta,
      })
      .preInstructions(preIxs)
      .transaction();
    sig = await sendSponsorTx(connection, sponsorKp, tx, matchId, settlementRentLamports);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AlreadySettled")) {
      if (!await recoverHistory(connection, programId, matchId, mpda)) {
        return { status: "already-settled", historyPending: true };
      }
      // HT-FINAL-005: another settler won the race — bookkeep only if a
      // durable row already exists, never manufacture history.
      const transitioned = await updateExistingJob(matchId, { status: "settled" });
      return { status: "already-settled", transitioned };
    }
    if (msg.includes("VrfNotFulfilled") || msg.includes("SeedMismatch")) {
      await markJob(matchId, {
        status: "pending",
        last_error: msg.slice(0, 160),
        next_attempt_at: new Date(Date.now() + 5000).toISOString(),
        attemptsDelta: 1,
      });
      return { status: "pending", reason: "waiting-for-orao" };
    }
    await markJob(matchId, {
      status: "failed",
      last_error: msg.slice(0, 200),
      next_attempt_at: new Date(Date.now() + 15000).toISOString(),
      attemptsDelta: 1,
    });
    return { status: "failed", error: msg.slice(0, 160) };
  }

  // 5. Confirm, re-read, verify Settled, index history (shared logic).
  const settled = await program.account.match.fetch(mpda).catch(() => null);
  const settledState = settled ? String(Object.keys(settled.state as object)[0] ?? "").toLowerCase() : "";
  if (settledState !== "settled") {
    await markJob(matchId, {
      status: "pending",
      last_error: "settlement not yet readable",
      next_attempt_at: new Date(Date.now() + 5000).toISOString(),
      attemptsDelta: 1,
    });
    return { status: "pending", reason: "waiting-for-orao" };
  }
  let indexed = false;
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const result = await indexSettlementSignature(connection, db, programId, CLUSTER, sig);
      indexed = result.ok && result.matches.includes(matchId.toString());
    }
  } catch {
    // A confirmed payout remains successful while history is retried.
  }
  await markJob(matchId, indexed ? { status: "settled" } : {
    status: "pending", last_error: "settled on chain; history retry pending",
    next_attempt_at: new Date(Date.now() + 15_000).toISOString(),
  });
  return { status: "settled", signature: sig };
}

/** Read-only status for UI polling + admin (never exposes secrets). */
export async function getSettlementStatus(matchIdRaw: unknown): Promise<SettlementStatus> {
  const matchId = parseMatchId(matchIdRaw);
  if (matchId === null) return { status: "unavailable", reason: "invalid match id" };
  const { connection } = getServerConnection();
  if (!connection) return { status: "unavailable", reason: "rpc unavailable" };
  await assertDevnetConnection(connection);
  const programId = new PublicKey(GAME_PROGRAM_ID);
  const provider = new AnchorProvider(
    connection,
    { publicKey: Keypair.generate().publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  const m = await validatedMatch(connection, program, matchId);
  if (!m) return { status: "missing", matchId: matchId.toString() };
  const state = String(Object.keys(m.state as object)[0] ?? "").toLowerCase();
  const pot = (() => {
    try {
      return (
        BigInt((m.headsAmount as { toString(): string }).toString()) +
        BigInt((m.tailsAmount as { toString(): string }).toString())
      ).toString();
    } catch {
      return "0";
    }
  })();
  if (state === "settled") {
    const resultKey = String(Object.keys(m.result as object)[0] ?? "").toLowerCase();
    return {
      status: "settled",
      matchId: matchId.toString(),
      result: resultKey === "tails" ? "TAILS" : "HEADS",
      winner: (m.winner as PublicKey).toBase58(),
      pot,
      settledAt: null,
    };
  }
  const seed = Buffer.from(m.seed as unknown as number[]);
  const randomness = randomnessPda(seed);
  const info = await connection.getAccountInfo(randomness).catch(() => null);
  const raw = info?.data
    ? info.data instanceof Uint8Array
      ? info.data
      : Uint8Array.from(info.data as Uint8Array)
    : null;
  const r = raw ? readRandomnessFulfilled(raw, seed) : { fulfilled: false as const };
  if (!r.fulfilled) return { status: "waiting-for-orao", matchId: matchId.toString() };
  const result = r.resultBit === 0 ? "HEADS" : "TAILS";
  const winner = (r.resultBit === 0 ? m.headsPlayer : m.tailsPlayer) as PublicKey;
  return {
    status: "auto-settlement-pending",
    matchId: matchId.toString(),
    result,
    winner: winner.toBase58(),
  };
}

export interface ReconcileResult {
  checked: number;
  /** Newly settled via a fresh submission in this run (legacy compat). */
  settled: string[];
  pending: string[];
  errors: string[];
  /** Existing queued/pending/failed rows moved to settled by bookkeeping. */
  jobsTransitionedToSettled: number;
  jobsTransitioned: string[];
  /** Fresh settle_match submissions in this run. */
  settlementsSubmitted: number;
  /** Scanned matches already settled with no job row (no row created). */
  alreadySettled: number;
  /** Verified on-chain settlements whose history metadata needs another attempt. */
  historyPending: string[];
  /** Work remains for the next scheduled invocation. */
  deferred?: boolean;
}

/**
 * Background reconciler: find unresolved Matches (bounded scan), leave
 * randomness-pending alone, ensure settlement jobs for fulfilled ones,
 * ensure history indexed for settled ones. Bounded RPC load with pacing.
 *
 * HT-FINAL-005 semantics:
 * 1. Existing durable queued/pending/failed jobs are reconciled.
 * 2. Chain Settled + existing job row → update it to settled.
 * 3. Chain Settled + NO job row → do NOT manufacture a historical row.
 * 4. Newly detected unresolved WaitingForRandomness → normal job creation
 *    remains valid (via ensureSettlement's pending/failed upserts).
 * Telemetry distinguishes bookkeeping transitions from fresh submissions
 * so a second idempotent run reports zeros across the board.
 */
export async function reconcileUnresolved(args?: {
  lookback?: number;
  limit?: number;
  budgetMs?: number;
}): Promise<ReconcileResult> {
  const deadline = Date.now() + Math.min(Math.max(args?.budgetMs ?? 20_000, 1_000), 40_000);
  const lookback = Math.min(Math.max(args?.lookback ?? 50, 1), 200);
  const limit = Math.min(Math.max(args?.limit ?? 10, 1), 25);
  const out: ReconcileResult = {
    checked: 0,
    settled: [],
    pending: [],
    errors: [],
    jobsTransitionedToSettled: 0,
    jobsTransitioned: [],
    settlementsSubmitted: 0,
    alreadySettled: 0,
    historyPending: [],
  };
  const { connection } = getServerConnection();
  if (!connection) {
    out.errors.push("rpc unavailable");
    return out;
  }
  await assertDevnetConnection(connection);
  const programId = new PublicKey(GAME_PROGRAM_ID);
  const provider = new AnchorProvider(
    connection,
    { publicKey: Keypair.generate().publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  // Both namespaces share the global Match ID space, but their counters may
  // diverge after HTS cutover. The frozen legacy counter must not hide HTS.
  // A missing namespace must also never prevent the durable queue drain.
  const configs = await Promise.all(["config", "hts-config"].map(async namespace =>
    program.account.gameConfig.fetch(PublicKey.findProgramAddressSync([Buffer.from(namespace)], programId)[0])
      .catch(() => null)));
  const total = settlementScanHighWater(configs);
  if (configs.every(cfg => !cfg)) out.errors.push("config counters unavailable; draining durable jobs only");
  const start = total > BigInt(lookback) ? total - BigInt(lookback) : BigInt(0);
  const db = getSupabaseAdmin();
  const ids: string[] = [];
  for (let id = total - BigInt(1); id >= start; id--) ids.push(id.toString());
  const indexed = new Set<string>();
  if (db && ids.length) {
    const snapshot = await db.from("matches").select("onchain_match_id")
      .eq("cluster", CLUSTER).eq("program_id", programId.toBase58())
      .in("onchain_match_id", ids).limit(lookback);
    if (snapshot.error) out.errors.push("History scan lookup unavailable");
    else for (const row of snapshot.data ?? []) indexed.add(row.onchain_match_id);
  }
  let processed = 0;
  const examined = new Set<string>();
  // Give oldest durable work priority while leaving one scan slot for new matches.
  // HT-QA-003: drain the DURABLE queue independently of the shallow
  // recent-chain lookback. Old queued jobs outside the signature window
  // must still be processed from settlement_jobs — the lookback below only
  // covers the last N matches. Chain stays authoritative; ensureSettlement
  // is idempotent (already-settled marks settled, never resettles).
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const { data: jobs } = await db
        .from("settlement_jobs")
        .select("match_id")
        .in("status", ["queued", "pending", "failed", "in-progress"])
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(Math.max(1, limit - 1));
      const seen = examined;
      for (const j of (jobs ?? []) as Array<{ match_id: string }>) {
        const mid = String(j.match_id);
        if (parseMatchId(mid) === null) {
          await updateExistingJob(mid, { status: "failed", last_error: "invalid match id", next_attempt_at: null });
          continue;
        }
        if (seen.has(mid)) continue;
        if (processed >= limit || Date.now() >= deadline) { out.deferred = true; break; }
        processed++;
        seen.add(mid);
        out.checked += 1;
        try {
          const r = await ensureSettlement(mid);
          if (r.status === "settled") {
            if (!out.settled.includes(mid)) out.settled.push(mid);
            out.settlementsSubmitted += 1;
          } else if (r.status === "already-settled") {
            if (r.historyPending) out.historyPending.push(mid);
            if (r.transitioned) {
              out.jobsTransitionedToSettled += 1;
              out.jobsTransitioned.push(mid);
            } else {
              out.alreadySettled += 1;
            }
          } else if (r.status === "pending") {
            if (!out.pending.includes(mid)) out.pending.push(mid);
          }
        } catch (e) {
          out.errors.push(`job ${mid}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
        }
        await new Promise((res) => setTimeout(res, 600));
      }
    }
  } catch (e) {
    out.errors.push(`durable queue drain: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
  }
  for (let id = total - BigInt(1); id >= start; id--) {
    // Previously verified history does not need another account RPC scan.
    // Durable jobs are reconciled independently above.
    if (indexed.has(id.toString()) || examined.has(id.toString())) continue;
    if (processed >= limit || Date.now() >= deadline) { out.deferred = true; break; }
    processed++;
    examined.add(id.toString());
    out.checked += 1;
    try {
      const m = await validatedMatch(connection, program, id);
      if (!m) continue;
      const mpda = m.address;
      const state = String(Object.keys(m.state as object)[0] ?? "").toLowerCase();
      if (state === "settled") {
        // HT-QA-003 + HT-FINAL-005: index history idempotently, then update
        // an EXISTING durable row only. A settled match with no job row
        // must NOT manufacture history — count it as alreadySettled and
        // continue without resettling (chain is authoritative).
        if (!await recoverHistory(connection, programId, id, mpda)) {
          out.historyPending.push(id.toString());
          continue;
        }
        const moved = await updateExistingJob(id, { status: "settled" });
        if (moved) {
          out.jobsTransitionedToSettled += 1;
          out.jobsTransitioned.push(id.toString());
        } else {
          out.alreadySettled += 1;
        }
        continue;
      }
      if (state !== "waitingforrandomness") continue;
      const r = await ensureSettlement(id);
      if (r.status === "settled") {
        out.settled.push(id.toString());
        out.settlementsSubmitted += 1;
      } else if (r.status === "already-settled") {
        // Race: settled between our fetch and ensure's re-read. ensure
        // already updated an existing row (or found none — never created).
        if (r.historyPending) out.historyPending.push(id.toString());
        if (r.transitioned) {
          out.jobsTransitionedToSettled += 1;
          out.jobsTransitioned.push(id.toString());
        } else {
          out.alreadySettled += 1;
        }
      } else if (r.status === "pending") {
        out.pending.push(id.toString());
      }
    } catch (e) {
      out.errors.push(`match ${id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    }
    // Pace RPC reads; devnet throttles aggressively.
    await new Promise((res) => setTimeout(res, 600));
    if (id === BigInt(0)) break;
  }
  return out;
}
