import type { Connection, PublicKey } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { indexSettlementSignature } from "./indexSettlement";

/** Repair only the verified history of an already-settled on-chain match. */
export async function recoverSettledMatchHistory(args: {
  connection: Connection;
  db: SupabaseClient;
  programId: PublicKey;
  cluster: string;
  matchId: string;
  matchAddress: PublicKey;
}, indexSignature = indexSettlementSignature): Promise<void> {
  const { db, connection, programId, cluster, matchId, matchAddress } = args;
  const existing = await db.from("matches").select("onchain_match_id")
    .eq("cluster", cluster).eq("program_id", programId.toBase58())
    .eq("onchain_match_id", matchId).limit(1);
  if (existing.error) throw new Error("History lookup unavailable");
  if (existing.data?.length) return;

  // A persisted receipt is the first candidate even when confirmation
  // polling timed out. The canonical indexer still verifies it on-chain.
  const journal = await db.from("devnet_expenses").select("signature")
    .eq("operation_key", `settle:${matchId}`).eq("kind", "settle").maybeSingle();
  const tried = new Set<string>();
  async function attempt(signature: string): Promise<boolean> {
    if (tried.has(signature)) return false;
    tried.add(signature);
    const result = await indexSignature(connection, db, programId, cluster, signature);
    return result.ok && result.matches.includes(matchId);
  }
  if (journal.data?.signature && await attempt(journal.data.signature)) return;

  // A third-party settler may have supplied the receipt instead.
  const signatures = await connection.getSignaturesForAddress(matchAddress, { limit: 5 }, "confirmed");
  for (const receipt of signatures) {
    if (receipt.err || tried.has(receipt.signature)) continue;
    if (tried.size >= 3) break;
    if (await attempt(receipt.signature)) return;
  }
  throw new Error("Verified settlement history is not available yet");
}
