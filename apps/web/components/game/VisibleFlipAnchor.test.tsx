/**
 * Visible-flip-anchor timing regression (match #52: 4532ms/3617ms visible
 * vs 5000ms required). Drives the REAL useVisibleFlipAnchor hook in jsdom
 * with fake timers, proving the reveal fires >=5000ms after the Flipping
 * presentation commits — regardless of pre-render network latency.
 * Requires: node --import tsx --import ./lib/test/jsdom-setup.ts
 */
import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import React, { useRef, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  useVisibleFlipAnchor,
  type FlipAnchor,
  type FlipPendingLite,
} from "./useVisibleFlipAnchor.js";
import { planVisibleReveal } from "@/lib/game/flipReveal.js";

interface Ctrl {
  commitFlipping: (mid: string) => void;
  storePending: (mid: string, arrivedAt: number) => void;
  leaveFlipping: () => void;
  anchorOf: () => FlipAnchor | null;
}

/** Mirrors LiveGameClient orchestration: commit visuals, then store results
 *  (holdAndReveal also reschedules from an existing anchor). */
function Harness({
  ctrl,
  scheduled,
  fired,
}: {
  ctrl: Ctrl;
  scheduled: number[];
  fired: string[];
}) {
  const [liveState, setLiveState] = useState("ready");
  const [mid, setMid] = useState<string | null>(null);
  const activeMatchIdRef = useRef<string | null>(null);
  // Render-time mirror, exactly like LiveGameClient (ref never changes
  // without the state change that re-renders and re-runs the effect).
  activeMatchIdRef.current = mid;
  const pendingFlipRef = useRef<FlipPendingLite | null>(null);
  const visibleRef = useRef<FlipAnchor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors the component's single scheduling point (clear + re-arm).
  const schedule = (mid: string, delayMs: number) => {
    scheduled.push(delayMs);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fired.push(mid);
    }, delayMs);
  };
  ctrl.commitFlipping = (m: string) => {
    setMid(m);
    setLiveState("flipping");
  };
  ctrl.storePending = (mid: string, arrivedAt: number) => {
    pendingFlipRef.current = { matchId: mid, arrivedAt };
    const anchored = visibleRef.current;
    if (anchored && anchored.matchId === mid) {
      schedule(
        mid,
        planVisibleReveal({
          visibleStartedAtMs: anchored.startedAt,
          resultArrivedAtMs: arrivedAt,
          nowMs: Date.now(),
        }).delayMs
      );
    }
  };
  ctrl.leaveFlipping = () => setLiveState("ready");
  ctrl.anchorOf = () => visibleRef.current;
  useVisibleFlipAnchor({
    liveState,
    activeMatchIdRef,
    pendingFlipRef,
    visibleFlipStartedAtRef: visibleRef,
    scheduleFlipReveal: schedule,
  });
  return null;
}

function setup() {
  // NOTE: Date must be mocked alongside setTimeout — the anchor and the
  // arrival timestamps both come from Date.now().
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const ctrl = {} as Ctrl;
  const scheduled: number[] = [];
  const fired: string[] = [];
  render(React.createElement(Harness, { ctrl, scheduled, fired }));
  return { ctrl, scheduled, fired };
}

function teardown() {
  try {
    cleanup();
  } finally {
    mock.timers.reset();
  }
}

describe("useVisibleFlipAnchor (fake timers, real hook)", () => {
  it("fast already-settled case: 1500ms pre-render latency still yields >=5000ms visible", () => {
    const { ctrl, scheduled, fired } = setup();
    try {
      // Observation at t=0; Match fetch resolves settled at t=1500 and the
      // Flipping commit from that read renders immediately after.
      act(() => {
        mock.timers.tick(1500);
        ctrl.commitFlipping("52");
        ctrl.storePending("52", Date.now());
      });
      assert.equal(scheduled.length, 1, "one reveal scheduled");
      assert.equal(scheduled[0], 5000, "full 5000ms from visible commit, not observation");
      act(() => {
        mock.timers.tick(4999);
      });
      assert.deepEqual(fired, [], "no early reveal");
      act(() => {
        mock.timers.tick(1);
      });
      assert.deepEqual(fired, ["52"], "reveal at visible+5000ms");
      assert.equal(ctrl.anchorOf()?.matchId, "52", "anchor owned by the match");
    } finally {
      teardown();
    }
  });

  it("normal case: result 2000ms after Flipping begins waits only the remaining 3000ms", () => {
    const { ctrl, scheduled, fired } = setup();
    try {
      act(() => {
        ctrl.commitFlipping("53");
      });
      assert.equal(scheduled.length, 0, "nothing scheduled before the result exists");
      act(() => {
        mock.timers.tick(2000);
        ctrl.storePending("53", Date.now());
      });
      assert.equal(scheduled.length, 1);
      assert.equal(scheduled[0], 3000, "reveal at max(visible+5000, arrival)");
      act(() => {
        mock.timers.tick(2999);
      });
      assert.deepEqual(fired, []);
      act(() => {
        mock.timers.tick(1);
      });
      assert.deepEqual(fired, ["53"]);
    } finally {
      teardown();
    }
  });

  it("result after 5s visible Flipping reveals on the next tick (no extra wait)", () => {
    const { ctrl, scheduled, fired } = setup();
    try {
      // Commit first so the anchor stamps, THEN let 6s elapse, THEN store.
      act(() => {
        ctrl.commitFlipping("54");
      });
      act(() => {
        mock.timers.tick(6000);
        ctrl.storePending("54", Date.now());
      });
      assert.equal(scheduled.length, 1);
      assert.equal(scheduled[0], 0, "already past visible+5000 → immediate");
      act(() => {
        mock.timers.tick(0);
      });
      assert.deepEqual(fired, ["54"]);
    } finally {
      teardown();
    }
  });

  it("repeat commits never restart the visible timer; new match re-anchors", () => {
    const { ctrl, scheduled, fired } = setup();
    try {
      act(() => {
        ctrl.commitFlipping("55");
        ctrl.storePending("55", Date.now());
      });
      assert.equal(scheduled.length, 1);
      act(() => {
        mock.timers.tick(1000);
        ctrl.commitFlipping("55");
        ctrl.storePending("55", Date.now());
      });
      // Anchored reschedule from the same anchor: still fires at visible+5000.
      act(() => {
        mock.timers.tick(3999);
      });
      assert.deepEqual(fired, [], "timer not restarted by repeat polls");
      act(() => {
        mock.timers.tick(1);
      });
      assert.deepEqual(fired, ["55"], "fires at the original visible+5000");
      // New match gets a fully fresh anchor + timer.
      act(() => {
        ctrl.commitFlipping("56");
        ctrl.storePending("56", Date.now());
      });
      assert.equal(ctrl.anchorOf()?.matchId, "56", "ownership moved to the new match");
      assert.equal(scheduled[scheduled.length - 1], 5000, "fresh full hold");
    } finally {
      teardown();
    }
  });
});
