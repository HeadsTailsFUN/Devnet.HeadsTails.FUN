"use client";

import { useEffect } from "react";
import { planVisibleReveal } from "@/lib/game/flipReveal";

export interface FlipPendingLite {
  matchId: string;
  arrivedAt: number;
}

export interface FlipAnchor {
  matchId: string;
  startedAt: number;
}

/**
 * Post-render anchor for the 5000ms Flipping presentation timer.
 *
 * Stamps the visible start when the Flipping presentation for the current
 * live Match actually commits — never from pre-network observation time
 * (match #52: observation-anchored timing let RPC/async latency consume the
 * presentation, rendering 4532ms/3617ms instead of 5000ms). No dependency
 * array: runs after every commit, but the per-Match anchor makes it
 * once-per-match — repeat polls and renders no-op. A stored result present
 * at anchor time schedules its reveal from the anchor. No state writes
 * here, so no render loop. Timer/round resets release the anchor via
 * resetFlipReveal.
 */
export function useVisibleFlipAnchor(args: {
  liveState: string;
  activeMatchIdRef: { current: string | null };
  pendingFlipRef: { current: FlipPendingLite | null };
  visibleFlipStartedAtRef: { current: FlipAnchor | null };
  scheduleFlipReveal: (matchId: string, delayMs: number) => void;
}): void {
  const {
    liveState,
    activeMatchIdRef,
    pendingFlipRef,
    visibleFlipStartedAtRef,
    scheduleFlipReveal,
  } = args;
  useEffect(() => {
    if (liveState !== "flipping") return;
    const mid = activeMatchIdRef.current;
    if (!mid) return;
    const anchored = visibleFlipStartedAtRef.current;
    if (anchored && anchored.matchId === mid) return;
    const startedAt = Date.now();
    visibleFlipStartedAtRef.current = { matchId: mid, startedAt };
    const pending = pendingFlipRef.current;
    if (pending && pending.matchId === mid) {
      scheduleFlipReveal(
        mid,
        planVisibleReveal({
          visibleStartedAtMs: startedAt,
          resultArrivedAtMs: pending.arrivedAt,
          nowMs: startedAt,
        }).delayMs
      );
    }
  });
}
