/**
 * Referral reward logic (points only — never % of wager/loss/stake/pot).
 * - Qualified after invitee completes 3 eligible settled games.
 * - Invitee +25 once, referrer +50 once, then +2 per additional eligible game.
 * - Caps: 25 referred-game events per invitee per UTC day; 500 per referrer per day.
 * - No points for failed/unsettled/cancelled/duplicate/QA-excluded/self.
 * - Every match-derived event idempotent by Match ID.
 */

export const REFERRAL_QUALIFYING_GAMES = 3;
export const REFERRAL_INVITEE_ONCE = 25;
export const REFERRAL_REFERRER_ONCE = 50;
export const REFERRAL_PER_GAME = 2;
export const REFERRAL_MAX_PER_INVITEE_PER_DAY = 25;
export const REFERRAL_MAX_PER_REFERRER_PER_DAY = 500;

export function isSelfReferral(referrerWallet: string, inviteeWallet: string): boolean {
  return referrerWallet === inviteeWallet;
}

export function shouldQualify(eligibleGames: number): boolean {
  return eligibleGames >= REFERRAL_QUALIFYING_GAMES;
}

export function qualificationRewards(): { invitee: number; referrer: number } {
  return { invitee: REFERRAL_INVITEE_ONCE, referrer: REFERRAL_REFERRER_ONCE };
}

/** Attribution is immutable: never overwrite an existing referrer. */
export function canAttribute(existingReferrer: string | null): boolean {
  return existingReferrer === null;
}

export function referredGamePoints(): number {
  return REFERRAL_PER_GAME;
}

export function withinDailyCap(countToday: number, limit: number): boolean {
  return countToday < limit;
}

/**
 * Exact reward schedule by eligible-game count (after the current match's
 * gameplay row is recorded):
 * - games 1-2: nothing
 * - game 3: qualification only (invitee +25, referrer +50)
 * - game 4+: referrer +2 per game (caps enforced separately)
 */
export function referralRewardForGameCount(
  games: number
): { qualify: boolean; perGame: boolean } {
  if (games < REFERRAL_QUALIFYING_GAMES) return { qualify: false, perGame: false };
  if (games === REFERRAL_QUALIFYING_GAMES) return { qualify: true, perGame: false };
  return { qualify: false, perGame: true };
}

/**
 * Recurring referral_game cap check (prospective award).
 * - Per-invitee: fewer than 25 referral_game events today (independent per invitee).
 * - Referrer: today's RECURRING referral_game points + 2 must fit in 500.
 * One-time qualification rewards (+25 invitee / +50 referrer) are NOT part of
 * this cap: they are guaranteed once qualification is valid. Manual
 * adjustments never count either. No partial +1 events.
 */
export function referralCapsAllow(args: {
  inviteeGameEventsToday: number;
  referrerRecurringPointsToday: number;
}): boolean {
  return (
    args.inviteeGameEventsToday < REFERRAL_MAX_PER_INVITEE_PER_DAY &&
    args.referrerRecurringPointsToday + REFERRAL_PER_GAME <= REFERRAL_MAX_PER_REFERRER_PER_DAY
  );
}
