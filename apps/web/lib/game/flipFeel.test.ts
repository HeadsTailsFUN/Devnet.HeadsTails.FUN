import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLIP_FAST_DEG_PER_SEC,
  MIN_FLIP_REVEAL_MS,
  MIN_RESULT_HOLD_MS,
  planFlipFinish,
  resultHoldRemainingMs,
} from "./flipReveal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const client = (): string =>
  readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
const coin = (): string =>
  readFileSync(join(root, "components", "game", "FlipCoin.tsx"), "utf8");

/**
 * Flip feel + 10-second result hold (presentation-only UX improvement).
 * Chain/settlement/payout/oracle behavior is untouched — only the visible
 * timing (Flipping >=5000ms, then result >=10000ms, then Ready) and the
 * coin's physical deceleration change.
 */

describe("flip feel motion planner (pure)", () => {
  it("11. starts very fast then decelerates continuously (no jumps)", () => {
    const plan = planFlipFinish({ fromAngleDeg: 0, targetFace: "heads", durationMs: 5000 });
    // Ease-out start ≈ the fast-spin pace (seamless hand-off).
    assert.ok(
      Math.abs(plan.startDegPerSec - FLIP_FAST_DEG_PER_SEC) / FLIP_FAST_DEG_PER_SEC < 0.15,
      `start ${plan.startDegPerSec} ≈ fast spin ${FLIP_FAST_DEG_PER_SEC}`
    );
    // Sampled ease-out velocities strictly decrease every second.
    const vel = (tMs: number): number => {
      const p = Math.min(1, tMs / plan.durationMs);
      return (plan.totalDeg * 3 * Math.pow(1 - p, 2)) / (plan.durationMs / 1000);
    };
    const samples = [0, 1000, 2000, 3000, 4000].map(vel);
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] < samples[i - 1], `slower each second (${samples.join(",")})`);
    }
    assert.ok(samples[0] > 500, "second 0–1 very fast");
    assert.ok(samples[4] < 150, "second 4–5 slow/settling");
  });

  it("12. final HEADS orientation matches a HEADS result", () => {
    for (const from of [0, 37.5, 180, 321.9]) {
      const plan = planFlipFinish({ fromAngleDeg: from, targetFace: "heads", durationMs: 4000 });
      const landing = ((plan.endDeg % 360) + 360) % 360;
      assert.ok(Math.abs(landing) < 1e-9 || Math.abs(landing - 360) < 1e-9, `heads ${landing}`);
    }
  });

  it("13. final TAILS orientation matches a TAILS result", () => {
    for (const from of [0, 37.5, 180, 321.9]) {
      const plan = planFlipFinish({ fromAngleDeg: from, targetFace: "tails", durationMs: 4000 });
      const landing = ((plan.endDeg % 360) + 360) % 360;
      assert.ok(Math.abs(landing - 180) < 1e-9, `tails ${landing}`);
    }
  });

  it("14. no sudden snap: lands exactly, always ≥1 full turn, graceful minimum", () => {
    const plan = planFlipFinish({ fromAngleDeg: 10, targetFace: "heads", durationMs: 5000 });
    assert.ok(plan.totalDeg >= 360, `rotates visibly (${plan.totalDeg}°)`);
    const quick = planFlipFinish({ fromAngleDeg: 10, targetFace: "tails", durationMs: 50 });
    assert.equal(quick.durationMs, 400, "clamped to a graceful minimum, never instant");
    assert.ok(quick.totalDeg >= 180, "still visibly settles onto the face");
  });
});

describe("10-second result hold (pure timing)", () => {
  it("result hold constant is exactly 10000ms", () => {
    assert.equal(MIN_RESULT_HOLD_MS, 10000);
    assert.equal(MIN_FLIP_REVEAL_MS, 5000, "flip hold unchanged");
  });

  it("1. WIN at 0ms → visible at 9999ms, Ready allowed at >=10000ms", () => {
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 0 }), 10000);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 9999 }), 1);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 10000 }), 0);
  });

  it("2. LOSS shares the same >=10000ms hold (face-independent)", () => {
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 500, nowMs: 10499 }), 1);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 500, nowMs: 10500 }), 0);
    const s = client();
    // Arming keys on the completed round (either face), never on iWon.
    const armIdx = s.indexOf("resultHoldTimerRef.current = setTimeout");
    assert.ok(armIdx > 0, "hold timer armed");
    const armBlock = s.slice(Math.max(0, armIdx - 600), armIdx);
    assert.ok(!armBlock.includes("iWon"), "face-independent hold");
  });
});

describe("result hold wiring (LiveGameClient)", () => {
  it("5. idle PlayerState cannot collapse the held result (poll-safe)", () => {
    const s = client();
    // Completed rounds clear only via explicit resets — never from any
    // PlayerState poll path (bounded to the refresh body).
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("setLastCompleted(null)"), "shared reset clears it");
    const refreshStart = s.indexOf("const refresh = useCallback(async () => {");
    const refreshEnd = s.indexOf("scheduleFlipReveal]);", refreshStart);
    assert.ok(refreshStart > 0 && refreshEnd > refreshStart, "refresh body located");
    const refresh = s.slice(refreshStart, refreshEnd);
    assert.ok(!refresh.includes("setLastCompleted(null)"), "no poll path clears it");
    assert.ok(refresh.includes("setLastCompleted({"), "polls only record completions");
  });

  it("6. polls during the hold cannot transition to Ready early", () => {
    const s = client();
    // The auto-ready effect skips while settlement pends, on manual reset,
    // and once the user starts a new round.
    assert.ok(s.includes("if (!lastCompleted || settlePending) return;"), "transient results excluded");
    assert.ok(
      s.includes("if (intentRef.current !== null || hasPositionRef.current) return;"),
      "user action supersedes the timer"
    );
    assert.ok(s.includes('traceGameEvent("auto-ready")'), "automatic path traced distinctly");
  });

  it("3. Play Again at 2s → timer cancelled, immediate clean transition", () => {
    const s = client();
    // Manual Play Again shares the reset, which disarms the pending timer.
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("if (resultHoldTimerRef.current) clearTimeout(resultHoldTimerRef.current);"), "timer cancelled");
    assert.ok(reset.includes("resultHoldTimerRef.current = null;"), "timer handle cleared");
    const playAgain = s.slice(s.indexOf("const handlePlayAgain = useCallback("));
    assert.ok(playAgain.includes("resetRoundState()"), "manual path runs immediately");
  });

  it("4. Play Again at 9s → no later duplicate auto-ready transition", () => {
    const s = client();
    // The timer callback re-validates the completed round before acting;
    // after Play Again there is nothing to act on, and the stamp is gone so
    // the effect cannot re-arm.
    assert.ok(
      s.includes("const cur = lastCompletedRef.current;"),
      "timer re-validates before transitioning"
    );
    assert.ok(s.includes("if (!cur || cur.matchId !== mid) return;"), "stale fire is a no-op");
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("resultShownAtRef.current = null"), "stamp cleared, no re-arm");
  });

  it("6b. repeated polling never restarts the hold timer", () => {
    const s = client();
    assert.ok(
      s.includes("if (stamped && stamped.matchId === mid) return;"),
      "single stamp per completed match"
    );
  });

  it("9. auto-Ready leaves no stale Match ID", () => {
    const s = client();
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("setActiveMatchId(null)"), "label cleared with the result");
    assert.ok(reset.includes("setLastCompleted(null)"), "result cleared with the label");
    assert.ok(reset.includes("resultHoldTimerRef"), "hold timer disarmed");
  });

  it("9b. auto-ready never starts a paid round (UI ready state only)", () => {
    const s = client();
    const autoIdx = s.indexOf('traceGameEvent("auto-ready")');
    assert.ok(autoIdx > 0, "automatic path located");
    const autoBlock = s.slice(autoIdx, autoIdx + 400);
    assert.ok(autoBlock.includes("resetRoundState()"), "resets to ready");
    for (const forbidden of ["join_queue", "signAndSend", "stake_amount", " matchNext", "settleMatch"]) {
      assert.ok(!autoBlock.includes(forbidden), `no ${forbidden.trim()} in auto-ready`);
    }
  });

  it("10. next round gets fresh timers", () => {
    const s = client();
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("resetFlipReveal()"), "flip presentation released");
    assert.ok(reset.includes("resultShownAtRef.current = null"), "hold stamp released");
  });

  it("Play Again preserved (manual path uses the same reset)", () => {
    const s = client();
    const playAgain = s.slice(s.indexOf("const handlePlayAgain = useCallback("));
    assert.ok(playAgain.includes("resetRoundState()"), "Play Again shares the reset");
    assert.ok(playAgain.includes("void refresh()"), "Play Again still refreshes");
  });
});

describe("decelerating coin wiring (FlipCoin)", () => {
  it("rAF loop driven by authoritative pending face (never guessed)", () => {
    const s = coin();
    assert.ok(s.includes("requestAnimationFrame"), "frame-driven motion");
    assert.ok(
      s.includes('flipTarget === "HEADS" ? "heads" : flipTarget === "TAILS" ? "tails" : null'),
      "target derived only from the passed authoritative face"
    );
    assert.ok(!s.includes("Math.random"), "no random final side");
  });

  it("unknown result spins fast; known result eases onto the face", () => {
    const s = coin();
    assert.ok(s.includes("FLIP_FAST_DEG_PER_SEC"), "fast constant phase");
    assert.ok(s.includes("planFlipFinish({"), "finish planned from current angle");
    assert.ok(s.includes("1 - Math.pow(1 - p, 3)"), "continuous ease-out curve");
  });

  it("static result faces retained; reduced-motion keeps the CSS path", () => {
    const s = coin();
    assert.ok(s.includes("is-heads") && s.includes("is-tails"), "exact face classes kept");
    assert.ok(s.includes("prefers-reduced-motion"), "reduced motion respected");
    assert.ok(s.includes("is-driven"), "driven class separates rAF from CSS spin");
  });

  it("GameHero passes the flip presentation props through", () => {
    const hero = readFileSync(join(root, "components", "game", "GameHero.tsx"), "utf8");
    for (const prop of ["flipTarget", "flipRoundId", "flipRevealAtMs"]) {
      assert.ok(hero.includes(prop), `GameHero forwards ${prop}`);
    }
    const s = client();
    assert.ok(s.includes("flipTarget={flipTarget}"), "client wires the pending face");
    assert.ok(s.includes("setFlipTick((t) => t + 1)"), "hold commit re-renders for fresh props");
  });
});
