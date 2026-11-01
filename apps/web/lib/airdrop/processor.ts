import { GAMEPLAY_DAILY_CAP, pointsForMatch } from "./rules";
import {
  REFERRAL_MAX_PER_INVITEE_PER_DAY,
  REFERRAL_MAX_PER_REFERRER_PER_DAY,
  REFERRAL_PER_GAME,
  referralRewardForGameCount,
} from "@/lib/referrals/logic";

/** Pure: cap gameplay points to the 200/day limit. */
export function capGameplayPoints(alreadyToday: number, incoming: number): number {
  const remaining = Math.max(0, GAMEPLAY_DAILY_CAP - alreadyToday);
  return Math.min(remaining, incoming);
}

/**
 * Pure: recurring referral_game cap check (legacy positional form).
 * Inputs are RECURRING (referral_game) counts/points only — one-time
 * qualification rewards and manual adjustments never pollute the cap.
 * The +2 is awarded only when todayRecurring + 2 <= 500 (no partial +1).
 */
export function referralGameAllowed(inviteeToday: number, referrerRecurringToday: number): boolean {
  return (
    inviteeToday < REFERRAL_MAX_PER_INVITEE_PER_DAY &&
    referrerRecurringToday + REFERRAL_PER_GAME <= REFERRAL_MAX_PER_REFERRER_PER_DAY
  );
}

/** Wallets actively excluded from rewards (QA / test / abuse). Best-effort. */
export async function loadExcludedWallets(db: any): Promise<Set<string>> {
  const excluded = new Set<string>();
  try {
    const { data } = await db.from("admin_members").select("wallet");
    for (const r of ((data ?? []) as Array<{ wallet: string }>)) excluded.add(r.wallet);
  } catch {
    // ignore
  }
  try {
    const { data } = await db
      .from("reward_exclusions")
      .select("wallet")
      .eq("active", true);
    for (const r of ((data ?? []) as Array<{ wallet: string }>)) excluded.add(r.wallet);
  } catch {
    // table may not exist until the growth migration lands
  }
  return excluded;
}

export { pointsForMatch };

interface MatchRewardInput {
  seasonId: string;
  matchId: string;
  headsWallet: string;
  tailsWallet: string;
  winnerWallet: string;
  /**
   * Authoritative event time (matches.settled_at from Solana blockTime).
   * The gameplay RPC caps on this UTC day — never processing time, never
   * client time. Null fails the gameplay write closed (retryable error);
   * referral reads continue on current counts (no over-award possible).
   */
  settledAt: string | null;
}

export interface RewardResult {
  ok: boolean;
  /** Retryable failure descriptions for logs/reconciliation. Empty on success. */
  errors: string[];
}

/**
 * Idempotent server reward processor. Safe to run repeatedly; unique ledger
 * constraints and atomic RPCs prevent duplicates and partial commits.
 * Never throws — gameplay/settlement always succeeds even if rewards fail.
 * Failures are RETURNED (never swallowed into fake success) so the bounded
 * reconciler can retry them later.
 */
export async function processSettledMatchRewards(
  db: any,
  input: MatchRewardInput
): Promise<RewardResult> {
  const errors: string[] = [];
  try {
    const { seasonId, matchId, headsWallet, tailsWallet, winnerWallet, settledAt } = input;
    const players = [headsWallet, tailsWallet];
    // QA / test / abuse exclusions earn no points (gameplay unaffected).
    const excluded = await loadExcludedWallets(db);

    for (const wallet of players) {
      if (excluded.has(wallet)) continue;
      const isWinner = wallet === winnerWallet;
      if (!settledAt) {
        // Fail closed: no authoritative event time, no invented time. The
        // gameplay marker is skipped (retryable); referral reads below
        // continue on current counts and can never over-award.
        errors.push(`gameplay ${wallet} ${matchId}: missing settled_at (event time required)`);
      } else {
        try {
          // Atomic: serialized per season + wallet + SETTLEMENT UTC day,
          // capped at 200 verified gameplay-derived points. Statuses:
          // awarded | partial | capped | exists (all idempotent, marker
          // always written so replays return exists, none exceed the cap).
          const { data: gdata, error: gerr } = await db.rpc("award_gameplay_match_atomic", {
            p_season_id: seasonId,
            p_wallet: wallet,
            p_match_id: matchId,
            p_is_winner: isWinner,
            p_settled_at: settledAt,
          });
          const gstatus = (gdata as { status?: string } | null)?.status;
          if (gerr || !gstatus || !["awarded", "partial", "capped", "exists"].includes(gstatus)) {
            errors.push(`gameplay ${wallet} ${matchId}: ${gerr ? String((gerr as { message?: unknown })?.message ?? gerr).slice(0, 160) : `unexpected ${gstatus}`}`);
          }
        } catch (e) {
          errors.push(`gameplay ${wallet} ${matchId}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
        }
      }
      // Referral qualification + per-game points via atomic RPCs
      // (single-transaction, advisory-locked, idempotent). Failures are
      // RECORDED for the reconciler — never silently swallowed.
      try {
        const { data: attr, error: attrErr } = await db
          .from("referral_attributions")
          .select("referrer_wallet,status")
          .eq("invitee_wallet", wallet)
          .maybeSingle();
        if (attrErr) {
          errors.push(`referral read ${wallet}: ${String((attrErr as { message?: unknown })?.message ?? attrErr).slice(0, 160)}`);
          continue;
        }
        const row = attr as { referrer_wallet?: string; status?: string } | null;
        if (!row?.referrer_wallet || row.status === "blocked") continue;
        if (row.referrer_wallet === wallet) continue;
        if (excluded.has(row.referrer_wallet) || excluded.has(wallet)) continue;
        const referrer = row.referrer_wallet;
        // Eligible games = VERIFIED gameplay_match markers for invitee
        // this season (zero-point capped markers count — they prove an
        // eligible settled game happened).
        const { count: gamesCount, error: gamesErr } = await db
          .from("airdrop_points_ledger")
          .select("id", { count: "exact", head: true })
          .eq("season_id", seasonId)
          .eq("wallet", wallet)
          .eq("event_type", "gameplay_match")
          .eq("status", "verified");
        if (gamesErr) {
          errors.push(`referral games ${wallet}: ${String((gamesErr as { message?: unknown })?.message ?? gamesErr).slice(0, 160)}`);
          continue;
        }
        const games = gamesCount ?? 0;
        const schedule = referralRewardForGameCount(games);
        if (row.status === "pending" && games >= 3) {
          // Atomic: attribution + BOTH one-time bonuses or nothing.
          const { data: qdata, error: qerr } = await db.rpc("qualify_referral_atomic", {
            p_season_id: seasonId,
            p_invitee: wallet,
            p_referrer: referrer,
          });
          const qstatus = (qdata as { status?: string } | null)?.status;
          if (qerr || (qstatus !== "qualified" && qstatus !== "already-qualified")) {
            errors.push(`qualify ${wallet}: ${qerr ? String((qerr as { message?: unknown })?.message ?? qerr).slice(0, 160) : `unexpected ${qstatus}`}`);
          }
        }
        if (schedule.perGame) {
          // Game 4+: advisory-locked +2 with referral_game-only caps.
          const { data: adata, error: aerr } = await db.rpc("award_referral_game_atomic", {
            p_season_id: seasonId,
            p_referrer: referrer,
            p_invitee: wallet,
            p_match_id: matchId,
          });
          const astatus = (adata as { status?: string } | null)?.status;
          if (aerr || !astatus || !["awarded", "exists", "ineligible", "capped-invitee", "capped-referrer"].includes(astatus)) {
            errors.push(`award ${referrer}/${wallet} ${matchId}: ${aerr ? String((aerr as { message?: unknown })?.message ?? aerr).slice(0, 160) : `unexpected ${astatus}`}`);
          }
        }
      } catch (e) {
        errors.push(`referral ${wallet}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
      }
    }
  } catch (e) {
    // rewards must never break settlement
    errors.push(`processor: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`);
  }
  return { ok: errors.length === 0, errors };
}
