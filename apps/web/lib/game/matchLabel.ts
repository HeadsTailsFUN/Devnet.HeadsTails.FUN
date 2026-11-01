/**
 * Stale-match-label guard (pure, unit-tested).
 *
 * After settlement the PlayerState goes idle (or the settled inMatch window
 * is missed entirely by a poll gap). The refresh idle branch must clear a
 * stale `MATCH #…` label when the UI is back to a normal ready state — but
 * never too early:
 * - keep it while a flip reveal is in flight (Match Found / Flipping),
 * - keep it while the completed result for THIS match is intentionally on
 *   screen (Result, until Play Again),
 * - clear it once the user starts a new round (fresh explicit intent).
 *
 * Clearing is one-way: only live inMatch chain state re-sets the label, so
 * polling can never resurrect a cleared ID and a new match always shows
 * only its own ID.
 */

export interface StaleMatchArgs {
  /** A 5s flip-reveal timer is still holding this match's result. */
  pendingRevealInFlight: boolean;
  /** The completed result on screen belongs to this same match ID. */
  resultAnchored: boolean;
  /** The user has picked a side for a new round since. */
  newRoundStarted: boolean;
}

export function shouldClearStaleMatchId(args: StaleMatchArgs): boolean {
  // Flipping presentation owns the label until the timer fires.
  if (args.pendingRevealInFlight) return false;
  // The intentional result screen owns the label until Play Again — unless
  // the user already started a new round, which supersedes it.
  if (args.resultAnchored && !args.newRoundStarted) return false;
  return true;
}

export type IdlePresentation = "hold-flipping" | "proceed-ready";

export interface IdleRefreshDecision {
  /** Which presentation the idle poll must commit to. */
  presentation: IdlePresentation;
  /** Whether the previous MATCH # label must be cleared with it. */
  clearMatchId: boolean;
}

/**
 * Short state-consistency race fix (live match #50 flash): settlement can
 * land mid-presentation, so a poll observes idle PlayerState BEFORE the
 * delayed 5s result reveal fires. Committing ready then flashes
 * `Pick a side` + the previous `MATCH #N` for ~2s until the timer reveals.
 *
 * Ordering: a pending reveal always wins — hold the Flipping presentation
 * (and the label) until the timer fires. Otherwise proceed to ready and
 * clear per shouldClearStaleMatchId. Clearing stays one-way: only live
 * inMatch chain state re-sets the ID.
 */
export function decideIdleRefresh(
  args: StaleMatchArgs
): IdleRefreshDecision {
  if (args.pendingRevealInFlight) {
    return { presentation: "hold-flipping", clearMatchId: false };
  }
  return { presentation: "proceed-ready", clearMatchId: shouldClearStaleMatchId(args) };
}
