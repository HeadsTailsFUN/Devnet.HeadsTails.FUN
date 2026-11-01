import { getBrowserSupabase } from "@/lib/supabase/browserClient";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./cluster";

export type FlipResult = "HEADS" | "TAILS";

/** Real settled-round read model. Never fabricated; never MockFlip. */
export interface RecentFlip {
  matchId: string;
  result: FlipResult;
  winnerWallet: string;
  headsWallet: string;
  tailsWallet: string;
  potBaseUnits: string;
  tokenMint: string;
  settledAt: string | null;
  settlementSignature: string;
  tierUsd: number;
  matchPda: string | null;
  randomnessAccount: string | null;
  matchSignature: string | null;
  oraoFulfillmentSignature: string | null;
  createdSlot: number | null;
  settledSlot: number | null;
}

export type HistoryResult =
  | { status: "ok"; flips: RecentFlip[] }
  | { status: "empty" }
  | { status: "unavailable"; reason: string };

export interface MatchRow {
  onchain_match_id: string;
  result: string;
  winner_wallet: string;
  heads_wallet: string;
  tails_wallet: string;
  heads_amount: string;
  tails_amount: string;
  token_mint: string;
  settled_at: string | null;
  transaction_signature: string;
  tier_usd?: number | null;
  match_pda?: string | null;
  randomness_account?: string | null;
  settlement_signature?: string | null;
  match_signature?: string | null;
  orao_fulfillment_signature?: string | null;
  created_slot?: number | null;
  settled_slot?: number | null;
}

export function shortWallet(w: string): string {
  return w.length > 8 ? `${w.slice(0, 3)}…${w.slice(-4)}` : w;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "recently";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatPotBaseUnits(heads: string, tails: string): string {
  try {
    const total = BigInt(heads) + BigInt(tails);
    return `${total.toLocaleString("en-US")} base units`;
  } catch {
    return "—";
  }
}

function isValidSignature(sig: string): boolean {
  return sig.length >= 80 && sig.length <= 100 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(sig);
}

/**
 * Build a Solscan transaction URL ONLY from a verified signature.
 * Never trust a URL supplied by database/client. Returns null for bad input.
 */
export function solscanTxUrl(signature: string, cluster: string): string | null {
  if (!isValidSignature(signature)) return null;
  const base = `https://solscan.io/tx/${signature}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=devnet`;
}

export function mapRowToFlip(r: MatchRow): RecentFlip {
  return {
    matchId: r.onchain_match_id,
    result: r.result === "TAILS" ? "TAILS" : "HEADS",
    winnerWallet: r.winner_wallet,
    headsWallet: r.heads_wallet,
    tailsWallet: r.tails_wallet,
    potBaseUnits: (() => {
      try {
        return (BigInt(r.heads_amount) + BigInt(r.tails_amount)).toString();
      } catch {
        return "0";
      }
    })(),
    tokenMint: r.token_mint,
    settledAt: r.settled_at,
    settlementSignature: r.settlement_signature ?? r.transaction_signature,
    tierUsd: typeof r.tier_usd === "number" ? r.tier_usd : 1,
    matchPda: r.match_pda ?? null,
    randomnessAccount: r.randomness_account ?? null,
    matchSignature: r.match_signature ?? null,
    oraoFulfillmentSignature: r.orao_fulfillment_signature ?? null,
    createdSlot: r.created_slot ?? null,
    settledSlot: r.settled_slot ?? null,
  };
}

/** Solscan account URL (program/match/randomness) with Devnet cluster param. */
export function solscanAccountUrl(address: string, cluster: string): string | null {
  if (address.length < 32 || address.length > 44) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return null;
  const base = `https://solscan.io/account/${address}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=devnet`;
}

/**
 * Public read of settled matches, filtered by room tier. Uses the
 * publishable key only; the indexer writes with the service-role key
 * server-side. Never fabricates results: empty stays empty, failures report
 * unavailable. Disabled rooms ($100/$1000) never show fake history.
 */
export async function fetchRecentFlips(limit = 10, tierUsd?: number): Promise<HistoryResult> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { status: "unavailable", reason: "history backend not configured" };
  }
  try {
    // HT-QA-002: reuse the canonical browser singleton. Creating a new
    // GoTrueClient per polling call spawns "Multiple GoTrueClient instances
    // detected" warnings with duplicated storage listeners.
    const db = getBrowserSupabase();
    if (!db) {
      return { status: "unavailable", reason: "history backend not configured" };
    }
    let query = db
      .from("matches")
      .select(
        "onchain_match_id,result,winner_wallet,heads_wallet,tails_wallet,heads_amount,tails_amount,token_mint,settled_at,transaction_signature,tier_usd,match_pda,randomness_account,settlement_signature,match_signature,orao_fulfillment_signature,created_slot,settled_slot"
      )
      .order("settled_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (typeof tierUsd === "number") {
      query = query.eq("tier_usd", tierUsd);
    }
    const { data, error } = await query;
    if (error) return { status: "unavailable", reason: error.message };
    const rows = (data ?? []) as MatchRow[];
    if (rows.length === 0) return { status: "empty" };
    return { status: "ok", flips: rows.map(mapRowToFlip) };
  } catch (e) {
    return {
      status: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
