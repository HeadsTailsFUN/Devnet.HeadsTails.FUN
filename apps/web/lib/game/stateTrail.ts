/**
 * Client-side transition trail for selection-reset diagnosis.
 *
 * Records passive WEwrites (and key terminal events) with enough context to
 * attribute any recurrence to the exact writer: previous visible state,
 * proposed state, committed state, intent side/id, epochs, tiers and chain
 * position. No wallet addresses, signatures, personal data or secrets.
 * Exposed as `window.__htTrail` (last 80 entries). No-ops server-side.
 * Nothing here changes UI behavior.
 */

export interface TrailEvent {
  t: number;
  reason: string;
  from: string | null;
  proposed: string;
  committed: string;
  intent: string | null;
  intentId: number | null;
  startEpoch: number | null;
  currentEpoch: number | null;
  tier: number | null;
  responseTier: number | null;
  chainHasPosition: boolean | null;
}

const MAX_TRAIL = 80;
const trail: TrailEvent[] = [];

export interface TraceTransitionArgs {
  reason: string;
  from?: string | null;
  proposed: string;
  committed: string;
  intentSide?: string | null;
  intentId?: number | null;
  startEpoch?: number | null;
  currentEpoch?: number | null;
  tier?: number | null;
  responseTier?: number | null;
  chainHasPosition?: boolean | null;
}

export function traceTransition(args: TraceTransitionArgs): void {
  try {
    trail.push({
      t: Date.now(),
      reason: args.reason,
      from: args.from ?? null,
      proposed: args.proposed,
      committed: args.committed,
      intent: args.intentSide ?? null,
      intentId: args.intentId ?? null,
      startEpoch: args.startEpoch ?? null,
      currentEpoch: args.currentEpoch ?? null,
      tier: args.tier ?? null,
      responseTier: args.responseTier ?? null,
      chainHasPosition: args.chainHasPosition ?? null,
    });
    if (trail.length > MAX_TRAIL) trail.splice(0, trail.length - MAX_TRAIL);
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__htTrail = trail;
    }
  } catch {
    // diagnostics must never break gameplay
  }
}

/** Legacy simple reason trace (kept for terminal user-action events). */
export function traceGameEvent(reason: string): void {
  traceTransition({ reason, proposed: reason, committed: reason });
}

export function readTrail(): TrailEvent[] {
  return [...trail];
}

export function clearTrail(): void {
  trail.length = 0;
}
