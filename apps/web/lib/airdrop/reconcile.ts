import { processSettledMatchRewards } from "./processor";

export interface ReconcileStats {
  season: string | null;
  scanned: number;
  /** Matches whose rewards are fully recorded (including already-complete). */
  ok: number;
  /** Matches with retryable reward failures (safe to retry next cycle). */
  failed: number;
  errors: string[];
}

/**
 * Bounded server-side reward reconciliation. Reprocesses authoritative
 * indexed settled Matches idempotently, repairing cases where settlement /
 * indexing succeeded but reward processing temporarily failed. Safe to run
 * repeatedly: every underlying write is idempotent by unique event keys.
 * Never throws; failures are returned for logs. Never affects settlement.
 */
export async function reconcileSettledMatchRewards(
  db: any,
  opts?: { limit?: number; sinceDays?: number; offset?: number }
): Promise<ReconcileStats> {
  const stats: ReconcileStats = { season: null, scanned: 0, ok: 0, failed: 0, errors: [] };
  try {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const offset = Math.min(Math.max(Math.trunc(opts?.offset ?? 0), 0), 195);
    const sinceDays = Math.min(Math.max(opts?.sinceDays ?? 7, 1), 30);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: season, error: seasonErr } = await db
      .from("airdrop_seasons")
      .select("id,key")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (seasonErr || !season) {
      stats.errors.push("no active season");
      return stats;
    }
    const seasonId = (season as { id: string; key: string }).id;
    stats.season = (season as { key: string }).key;

    const { data: matches, error: matchErr } = await db
      .from("matches")
      .select("onchain_match_id,heads_wallet,tails_wallet,winner_wallet,settled_at")
      .gte("settled_at", since)
      .order("settled_at", { ascending: false })
      .order("onchain_match_id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (matchErr) {
      stats.errors.push(`matches read: ${String((matchErr as { message?: unknown })?.message ?? matchErr).slice(0, 160)}`);
      return stats;
    }
    const rows = ((matches ?? []) as Array<{
      onchain_match_id: string;
      heads_wallet: string;
      tails_wallet: string;
      winner_wallet: string;
      settled_at: string | null;
    }>);
    stats.scanned = rows.length;
    for (const m of rows) {
      try {
        const out = await processSettledMatchRewards(db, {
          seasonId,
          matchId: m.onchain_match_id,
          headsWallet: m.heads_wallet,
          tailsWallet: m.tails_wallet,
          winnerWallet: m.winner_wallet,
          // Authoritative event time from matches (blockTime-derived).
          // Null fails the gameplay write closed inside the processor.
          settledAt: m.settled_at ?? null,
        });
        if (out.ok) {
          stats.ok += 1;
        } else {
          stats.failed += 1;
          stats.errors.push(`match ${m.onchain_match_id}: ${out.errors[0] ?? "failed"}`);
        }
      } catch (e) {
        stats.failed += 1;
        stats.errors.push(`match ${m.onchain_match_id}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
      }
    }
    return stats;
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message.slice(0, 160) : "failed");
    return stats;
  }
}
