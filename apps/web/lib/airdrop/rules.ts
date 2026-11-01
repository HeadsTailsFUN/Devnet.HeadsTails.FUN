/**
 * Airdrop rules V1 (off-chain points).
 * Per eligible settled match: loss +2, win +2 game +3 bonus = +5 total.
 * Stake size never increases points. Daily gameplay cap 200/wallet/UTC day.
 * Referral points feed the same visible total with category breakdown.
 */

export const AIRDROP_SEASON_DEVNET = "DEVNET_BETA";
export const AIRDROP_SEASON_PROD = "SEASON_1";

export const GAMEPLAY_LOSS_POINTS = 2;
export const GAMEPLAY_WIN_BASE = 2;
export const GAMEPLAY_WIN_BONUS = 3;
export const GAMEPLAY_WIN_TOTAL = GAMEPLAY_WIN_BASE + GAMEPLAY_WIN_BONUS;
export const GAMEPLAY_DAILY_CAP = 200;

export const SOCIAL_CONNECT_X_POINTS = 100;
export const SOCIAL_REPOST_POINTS = 75;
export const SOCIAL_REPLY_POINTS = 50;

export type MatchOutcome = "win" | "loss";

export function pointsForMatch(outcome: MatchOutcome): { gameplay: number; winBonus: number; total: number } {
  if (outcome === "win") {
    return { gameplay: GAMEPLAY_WIN_BASE, winBonus: GAMEPLAY_WIN_BONUS, total: GAMEPLAY_WIN_TOTAL };
  }
  return { gameplay: GAMEPLAY_LOSS_POINTS, winBonus: 0, total: GAMEPLAY_LOSS_POINTS };
}

export function socialPointsFor(task: "connect_x" | "repost" | "reply"): number {
  if (task === "connect_x") return SOCIAL_CONNECT_X_POINTS;
  if (task === "repost") return SOCIAL_REPOST_POINTS;
  return SOCIAL_REPLY_POINTS;
}

/** Pending social points never count toward VERIFIED total. */
export function verifiedTotal(rows: Array<{ status: string; points: number }>): number {
  return rows.filter((r) => r.status === "verified").reduce((s, r) => s + r.points, 0);
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
