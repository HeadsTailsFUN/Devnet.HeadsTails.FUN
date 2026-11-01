import {
  BorshCoder,
  EventParser,
  type Idl,
} from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GameClient, gameIdlJson, resolveGameMatch } from "@heads-or-tails/game-sdk";

export interface IndexerConfig {
  rpcUrl: string;
  programId: PublicKey;
  cluster: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  backfillSignatures: number;
}

export function resolveServerRpcUrlFromEnv(): string {
  const server =
    process.env.SOLANA_SERVER_RPC_URL ?? process.env.INDEXER_RPC_URL;
  if (server && server.trim().length > 0) return server.trim();
  const browser = process.env.NEXT_PUBLIC_RPC_URL;
  if (browser && browser.trim().length > 0) return browser.trim();
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error(
      "Server Devnet RPC is not configured (SOLANA_SERVER_RPC_URL). Public api.devnet.solana.com must not be the primary QA RPC."
    );
  }
  return "https://api.devnet.solana.com";
}

export function loadConfigFromEnv(): IndexerConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return {
    rpcUrl: resolveServerRpcUrlFromEnv(),
    programId: new PublicKey(
      process.env.HEADS_TAILS_PROGRAM_ID ??
        "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
    ),
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    supabaseUrl,
    supabaseServiceRoleKey: serviceRole,
    backfillSignatures: Number(process.env.INDEXER_BACKFILL ?? 100),
  };
}

export interface SettledRow {
  cluster: string;
  program_id: string;
  onchain_match_id: string;
  transaction_signature: string;
  event_index: number;
  heads_wallet: string;
  tails_wallet: string;
  heads_amount: string;
  tails_amount: string;
  token_mint: string;
  tier_usd: number;
  result: "HEADS" | "TAILS";
  winner_wallet: string;
  created_slot: number | null;
  settled_slot: number | null;
  settled_at: string | null;
}

export function makeSupabase(url: string, serviceRole: string): SupabaseClient {
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function upsertSettled(
  db: SupabaseClient,
  row: SettledRow
): Promise<void> {
  const { error } = await db
    .from("matches")
    .upsert(row, { onConflict: "cluster,program_id,onchain_match_id" });
  if (error) throw new Error(`supabase upsert failed: ${error.message}`);
}

export async function matchToRow(
  client: GameClient,
  cluster: string,
  matchId: bigint,
  signature: string,
  eventIndex: number,
  settledSlot: number | null,
  settledAt: string | null
): Promise<SettledRow> {
  const resolved = await resolveGameMatch(client.program, matchId);
  if (!resolved) throw new Error("Match not found");
  const m = resolved.match;
  const state = Object.keys(m.state as object)[0];
  if (state !== "settled") throw new Error(`match ${matchId} is not settled`);
  const result = Object.keys(m.result as object)[0];
  const cfg = resolved.config;
  return {
    cluster,
    program_id: client.program.programId.toBase58(),
    onchain_match_id: matchId.toString(),
    transaction_signature: signature,
    event_index: eventIndex,
    heads_wallet: (m.headsPlayer as PublicKey).toBase58(),
    tails_wallet: (m.tailsPlayer as PublicKey).toBase58(),
    heads_amount: (m.headsAmount as { toString(): string }).toString(),
    tails_amount: (m.tailsAmount as { toString(): string }).toString(),
    token_mint: (cfg.projectMint as PublicKey).toBase58(),
    tier_usd: m.tierUsd as number,
    result: result === "heads" ? "HEADS" : "TAILS",
    winner_wallet: (m.winner as PublicKey).toBase58(),
    created_slot:
      m.createdSlot == null ? null : Number((m.createdSlot as { toString(): string }).toString()),
    settled_slot: settledSlot,
    settled_at: settledAt,
  };
}

export async function processTransaction(
  client: GameClient,
  db: SupabaseClient,
  cluster: string,
  tx: ParsedTransactionWithMeta,
  signature: string
): Promise<number> {
  const coder = new BorshCoder(gameIdlJson as Idl);
  const parser = new EventParser(client.program.programId, coder);
  let handled = 0;
  let eventIndex = 0;
  const logs = tx.meta?.logMessages ?? [];
  for (const event of parser.parseLogs(logs)) {
    if (event.name === "MatchSettled") {
      // Note: parsed event data keeps IDL snake_case field names.
      const data = event.data as Record<string, { toString(): string }>;
      const matchId = BigInt(data.match_id.toString());
      const slot = tx.slot;
      const blockTime = tx.blockTime ?? null;
      const row = await matchToRow(
        client,
        cluster,
        matchId,
        signature,
        eventIndex,
        slot,
        blockTime ? new Date(blockTime * 1000).toISOString() : null
      );
      await upsertSettled(db, row);
      handled += 1;
    }
    eventIndex += 1;
  }
  return handled;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("429") || msg.includes("Too Many Requests");
}

export async function getParsedTx(
  connection: Connection,
  signature: string,
  tries = 6
): Promise<ParsedTransactionWithMeta | null> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (e) {
      last = e;
      if (!isRateLimit(e)) throw e;
      await sleep(2000 * (i + 1));
    }
  }
  throw last;
}

export async function backfill(
  connection: Connection,
  client: GameClient,
  db: SupabaseClient,
  cluster: string,
  programId: PublicKey,
  limit: number
): Promise<number> {
  let handled = 0;
  const sigs = await connection.getSignaturesForAddress(programId, { limit });
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await getParsedTx(connection, s.signature);
    if (!tx) continue;
    handled += await processTransaction(client, db, cluster, tx, s.signature);
    // Pace public-RPC reads; devnet throttles aggressively.
    await sleep(1200);
  }
  return handled;
}
