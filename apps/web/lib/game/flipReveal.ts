/**
 * Minimum Flipping presentation (5s). Presentation-only: ORAO request,
 * reading, settlement, payout, keeper and chain writes are never delayed.
 * The result is stored internally while Flipping stays visible.
 */
export const MIN_FLIP_REVEAL_MS = 5000;

export function flipRevealAtMs(flipStartedAtMs: number): number {
  return flipStartedAtMs + MIN_FLIP_REVEAL_MS;
}

/** True when the stored result may be revealed at `nowMs`. */
export function shouldRevealFlip(args: {
  flipStartedAtMs: number | null;
  resultArrivedAtMs: number | null;
  nowMs: number;
}): boolean {
  const { flipStartedAtMs, resultArrivedAtMs, nowMs } = args;
  // Historical settled state (never observed flipping): reveal immediately.
  if (flipStartedAtMs === null) return true;
  if (resultArrivedAtMs === null) return false;
  const revealAt = Math.max(flipStartedAtMs + MIN_FLIP_REVEAL_MS, resultArrivedAtMs);
  return nowMs >= revealAt;
}

/** Milliseconds to wait before revealing (0 = reveal now). */
export function flipRevealDelayMs(args: {
  flipStartedAtMs: number | null;
  resultArrivedAtMs: number | null;
  nowMs: number;
}): number {
  const { flipStartedAtMs, resultArrivedAtMs, nowMs } = args;
  if (flipStartedAtMs === null || resultArrivedAtMs === null) return 0;
  const revealAt = Math.max(flipStartedAtMs + MIN_FLIP_REVEAL_MS, resultArrivedAtMs);
  return Math.max(0, revealAt - nowMs);
}

export type FlipObservation = "init-new-round" | "same-round";

/**
 * First-observation rule for a live round (0ms-flip race).
 *
 * `flipStartedAt === null` alone cannot distinguish live from historical —
 * both start null — so a newly observed ACTIVE match was misclassified as
 * historical and revealed immediately (0ms Flipping). Authoritative
 * `PlayerState.inMatch` for a Match ID proves it is the CURRENT round, so
 * the first observation of a new live Match ID must establish the
 * presentation start BEFORE any result/randomness read. Repeat polls for
 * the same ID must never restart the timer; the timer belongs to that
 * Match ID. Historical reads (no active PlayerState) never reach this
 * path, so they still render immediately with no fake animation.
 */
export function classifyMatchObservation(args: {
  trackedMatchId: string | null;
  observedMatchId: string;
}): FlipObservation {
  return args.trackedMatchId !== args.observedMatchId ? "init-new-round" : "same-round";
}

export interface VisibleRevealPlan {
  /** Absolute reveal timestamp (ms). */
  revealAtMs: number;
  /** Milliseconds to wait from `nowMs` (0 = reveal now). */
  delayMs: number;
}

/**
 * Reveal plan anchored to VISIBLE Flipping presentation (match #52 fix).
 *
 * The 5000ms timer must run from when Flipping actually renders — never
 * from pre-network observation time, which let RPC/async latency consume
 * the presentation (4532ms / 3617ms observed live vs 5000ms required).
 * Reveal at max(visibleStart + 5000ms, resultAvailableTime): a late result
 * waits only for the remainder, and a result arriving after 5s of visible
 * Flipping reveals immediately.
 */
export function planVisibleReveal(args: {
  visibleStartedAtMs: number;
  resultArrivedAtMs: number;
  nowMs: number;
}): VisibleRevealPlan {
  const revealAtMs = Math.max(
    args.visibleStartedAtMs + MIN_FLIP_REVEAL_MS,
    args.resultArrivedAtMs
  );
  return { revealAtMs, delayMs: Math.max(0, revealAtMs - args.nowMs) };
}

/**
 * Result-screen hold (presentation-only): YOU WIN / YOU LOSE stays on
 * screen at least 10000ms before the automatic Ready transition. Chain
 * settlement/payout/profile/history work is never delayed — only the UI
 * transition back to ready waits.
 */
export const MIN_RESULT_HOLD_MS = 10000;

/** Milliseconds of result hold remaining from `nowMs` (0 = may go Ready). */
export function resultHoldRemainingMs(args: {
  resultShownAtMs: number;
  nowMs: number;
}): number {
  return Math.max(0, args.resultShownAtMs + MIN_RESULT_HOLD_MS - args.nowMs);
}

/** Opening spin speed for the coin (deg/sec): very fast, then decaying. */
export const FLIP_FAST_DEG_PER_SEC = 720;

export interface FlipFinishPlan {
  /** Total rotation for the finish (deg), landing exactly on target. */
  totalDeg: number;
  /** Planned finish duration (ms), clamped to a graceful minimum. */
  durationMs: number;
  /** Absolute landing angle (deg), congruent to the target face. */
  endDeg: number;
  /** Ease-out start velocity (deg/sec) — matches the fast spin. */
  startDegPerSec: number;
}

/**
 * Deterministic flip finish: rotate from `fromAngleDeg` and land EXACTLY
 * on the authoritative face (heads ≡ 0°, tails ≡ 180°, mod 360) with a
 * continuous ease-out-cubic deceleration — very fast start, progressively
 * slower each moment, no jumps, no snap. Total rotation targets ≥1 full
 * turn at roughly the fast-spin pace so the hand-off from constant spin
 * is seamless. Pure; the caller animates angle(t) = start + total *
 * (1 - (1 - t/D)^3).
 */
export function planFlipFinish(args: {
  fromAngleDeg: number;
  targetFace: "heads" | "tails";
  durationMs: number;
  /** Incoming angular velocity (deg/sec) for a seamless hand-off. */
  startDegPerSec?: number;
}): FlipFinishPlan {
  const D = Math.max(400, args.durationMs);
  const v0 = args.startDegPerSec ?? FLIP_FAST_DEG_PER_SEC;
  const phase = args.targetFace === "tails" ? 180 : 0;
  const norm = ((args.fromAngleDeg % 360) + 360) % 360;
  const delta = (phase - norm + 360) % 360;
  const want = (v0 * (D / 1000)) / 3;
  const k = Math.max(1, Math.round((want - delta) / 360));
  const totalDeg = delta + k * 360;
  return {
    totalDeg,
    durationMs: D,
    endDeg: args.fromAngleDeg + totalDeg,
    startDegPerSec: (3 * totalDeg) / (D / 1000),
  };
}
