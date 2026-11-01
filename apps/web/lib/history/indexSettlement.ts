import { AnchorProvider, BorshCoder, EventParser, Program, type Idl } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gameIdlJson, resolveGameMatch, type HeadsOrTails } from "@heads-or-tails/game-sdk";

export type IndexResult =
  | { ok: true; matches: string[]; degraded?: boolean }
  | { ok: false; error: string; status: number; eventsSeen?: number };

/**
 * Columns added by the additive V3 migration. If the hosted database has
 * not applied it yet, upserts carrying these columns fail and the indexer
 * retries with the base column set so history keeps flowing (verification
 * links backfill once the migration lands). Pure function, unit-tested.
 */
export const V3_MATCH_COLUMNS = [
  "match_pda",
  "randomness_account",
  "match_signature",
  "settlement_signature",
  "orao_fulfillment_signature",
] as const;

export function isMissingColumnError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  if (err?.code === "42703" || err?.code === "PGRST204") return true;
  return /column .* does not exist|does not exist|could not find the .* column/i.test(
    String(err?.message ?? error ?? "")
  );
}

export function stripV3Columns(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(V3_MATCH_COLUMNS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Verify + index a settlement transaction. Shared by the public
 * index-settlement endpoint and the admin reindex action.
 * Nothing caller-provided is trusted except the signature itself.
 */
export async function indexSettlementSignature(
  connection: Connection,
  db: SupabaseClient,
  programId: PublicKey,
  cluster: string,
  sig: string
): Promise<IndexResult> {
  const tx = await connection
    .getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  if (!tx || !tx.meta) return { ok: false, error: "transaction not found", status: 404 };
  if (tx.meta.err) return { ok: false, error: "transaction failed on-chain", status: 422 };

  const coder = new BorshCoder(gameIdlJson as Idl);
  const parser = new EventParser(programId, coder);
  const logs = tx.meta.logMessages ?? [];
  const settled: Array<{ matchId: bigint; eventIndex: number }> = [];
  let logEventIndex = 0;
  for (const event of parser.parseLogs(logs)) {
    if (event.name === "MatchSettled") {
      const data = event.data as Record<string, { toString(): string }>;
      try {
        settled.push({ matchId: BigInt(data.match_id.toString()), eventIndex: logEventIndex });
      } catch {
        // ignore malformed event data
      }
    }
    logEventIndex += 1;
  }
  if (settled.length === 0) {
    return { ok: false, error: "no verified settlement in transaction", status: 422 };
  }

  const provider = new AnchorProvider(
    connection,
    { publicKey: Keypair.generate().publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  const indexed: string[] = [];
  const rewarded: Array<{ matchId: string; heads: string; tails: string; winner: string; settledAt: string | null }> = [];
  let degraded = false;
  let lastError: string | null = null;
  for (const { matchId, eventIndex } of settled) {
    try {
      const resolved = await resolveGameMatch(program, matchId);
      if (!resolved) { lastError = "match not found"; continue; }
      const {address: mpda, match: m, config: cfg} = resolved;
      const state = Object.keys(m.state as object)[0];
      if (state !== "settled") {
        lastError = `match ${matchId} not settled on-chain`;
        continue;
      }
      const resultKey = Object.keys(m.result as object)[0];
      const seed = Buffer.from(m.seed as unknown as number[]);
      const { oraoRandomnessPda } = await import("@heads-or-tails/game-sdk");
      const [randomness] = oraoRandomnessPda(seed);
      const row = {
        cluster,
        program_id: programId.toBase58(),
        onchain_match_id: matchId.toString(),
        transaction_signature: sig,
        event_index: eventIndex,
        heads_wallet: (m.headsPlayer as PublicKey).toBase58(),
        tails_wallet: (m.tailsPlayer as PublicKey).toBase58(),
        heads_amount: (m.headsAmount as { toString(): string }).toString(),
        tails_amount: (m.tailsAmount as { toString(): string }).toString(),
        token_mint: (cfg.projectMint as PublicKey).toBase58(),
        tier_usd: m.tierUsd as number,
        result: resultKey === "heads" ? "HEADS" : "TAILS",
        winner_wallet: (m.winner as PublicKey).toBase58(),
        created_slot:
          m.createdSlot == null ? null : Number((m.createdSlot as { toString(): string }).toString()),
        settled_slot: tx.slot,
        settled_at: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
        match_pda: mpda.toBase58(),
        randomness_account: randomness.toBase58(),
        settlement_signature: sig,
      };
      const first = await db
        .from("matches")
        .upsert(row, { onConflict: "cluster,transaction_signature,event_index" });
      if (!first.error) {
        indexed.push(matchId.toString());
        rewarded.push({
          matchId: matchId.toString(),
          heads: row.heads_wallet,
          tails: row.tails_wallet,
          winner: row.winner_wallet,
          // Authoritative event time (blockTime-derived); null fails the
          // gameplay write closed in the processor — never invented.
          settledAt: row.settled_at,
        });
        continue;
      }
      if (!isMissingColumnError(first.error)) {
        lastError = `upsert failed: ${String((first.error as { message?: unknown })?.message ?? first.error).slice(0, 160)}`;
        continue;
      }
      // Hosted DB predates the additive V3 migration: retry with the base
      // column set so history keeps flowing. Verification links backfill
      // once the migration lands (idempotent upsert by event identity).
      const retry = await db
        .from("matches")
        .upsert(stripV3Columns(row), { onConflict: "cluster,transaction_signature,event_index" });
      if (!retry.error) {
        degraded = true;
        indexed.push(matchId.toString());
        rewarded.push({
          matchId: matchId.toString(),
          heads: row.heads_wallet,
          tails: row.tails_wallet,
          winner: row.winner_wallet,
          settledAt: row.settled_at,
        });
      } else {
        lastError = `upsert failed: ${String((retry.error as { message?: unknown })?.message ?? retry.error).slice(0, 160)}`;
      }
    } catch (e) {
      // one bad event must not block the others
      lastError = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
    }
  }
  if (indexed.length === 0) {
    return {
      ok: false,
      error: lastError ?? "settlement not yet readable",
      status: 422,
      eventsSeen: settled.length,
    };
  }
  // Server-side point processing: idempotent, never blocks indexing.
  // Gameplay/settlement succeeds even if rewards fail; reconciler backfills.
  try {
    const { data: season } = await db
      .from("airdrop_seasons")
      .select("id")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    const seasonId = (season as { id?: string } | null)?.id ?? null;
    if (seasonId) {
      const { processSettledMatchRewards } = await import("@/lib/airdrop/processor");
      for (const r of rewarded) {
        const out = await processSettledMatchRewards(db, {
          seasonId,
          matchId: r.matchId,
          headsWallet: r.heads,
          tailsWallet: r.tails,
          winnerWallet: r.winner,
          settledAt: r.settledAt,
        });
        // Indexing already succeeded: reward failures are logged for the
        // bounded reconciler, never converted into indexing failures.
        for (const e of out.errors) {
          try {
            console.warn(`[rewards-retryable] match ${r.matchId}: ${e}`);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // rewards best-effort only
  }
  return { ok: true, matches: indexed, degraded: degraded || undefined };
}
