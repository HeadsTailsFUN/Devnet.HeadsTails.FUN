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
 * Flip feel + minimum read time and explicit replay (presentation-only UX improvement).
 * Chain/settlement/payout/oracle behavior is untouched — only the visible
 * timing (Flipping >=5000ms, then result >=4500ms before manual replay) and the
 * coin's physical deceleration change.
 */

describe("flip feel motion planner (pure)", () => {
  it("11. starts very fast then decelerates continuously (no jumps)", () => {
    const plan = planFlipFinish({
      fromAngleDeg: 0,
      targetFace: "heads",
      durationMs: 5000,
    });
    // Ease-out start ≈ the fast-spin pace (seamless hand-off).
    assert.ok(
      Math.abs(plan.startDegPerSec - FLIP_FAST_DEG_PER_SEC) /
        FLIP_FAST_DEG_PER_SEC <
        0.15,
      `start ${plan.startDegPerSec} ≈ fast spin ${FLIP_FAST_DEG_PER_SEC}`,
    );
    // Sampled ease-out velocities strictly decrease every second.
    const vel = (tMs: number): number => {
      const p = Math.min(1, tMs / plan.durationMs);
      return (
        (plan.totalDeg * 3 * Math.pow(1 - p, 2)) / (plan.durationMs / 1000)
      );
    };
    const samples = [0, 1000, 2000, 3000, 4000].map(vel);
    for (let i = 1; i < samples.length; i++) {
      assert.ok(
        samples[i] < samples[i - 1],
        `slower each second (${samples.join(",")})`,
      );
    }
    assert.ok(samples[0] > 500, "second 0–1 very fast");
    assert.ok(samples[4] < 150, "second 4–5 slow/settling");
  });

  it("12. final HEADS orientation matches a HEADS result", () => {
    for (const from of [0, 37.5, 180, 321.9]) {
      const plan = planFlipFinish({
        fromAngleDeg: from,
        targetFace: "heads",
        durationMs: 4000,
      });
      const landing = ((plan.endDeg % 360) + 360) % 360;
      assert.ok(
        Math.abs(landing) < 1e-9 || Math.abs(landing - 360) < 1e-9,
        `heads ${landing}`,
      );
    }
  });

  it("13. final TAILS orientation matches a TAILS result", () => {
    for (const from of [0, 37.5, 180, 321.9]) {
      const plan = planFlipFinish({
        fromAngleDeg: from,
        targetFace: "tails",
        durationMs: 4000,
      });
      const landing = ((plan.endDeg % 360) + 360) % 360;
      assert.ok(Math.abs(landing - 180) < 1e-9, `tails ${landing}`);
    }
  });

  it("14. no sudden snap: lands exactly, always ≥1 full turn, graceful minimum", () => {
    const plan = planFlipFinish({
      fromAngleDeg: 10,
      targetFace: "heads",
      durationMs: 5000,
    });
    assert.ok(plan.totalDeg >= 360, `rotates visibly (${plan.totalDeg}°)`);
    const quick = planFlipFinish({
      fromAngleDeg: 10,
      targetFace: "tails",
      durationMs: 50,
    });
    assert.equal(
      quick.durationMs,
      400,
      "clamped to a graceful minimum, never instant",
    );
    assert.ok(quick.totalDeg >= 180, "still visibly settles onto the face");
  });
});

describe("minimum result read time", () => {
  it("allows manual replay only after 4.5 seconds; flip timing stays unchanged", () => {
    assert.equal(MIN_RESULT_HOLD_MS, 4500);
    assert.equal(MIN_FLIP_REVEAL_MS, 5000);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 0 }), 4500);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 4499 }), 1);
    assert.equal(resultHoldRemainingMs({ resultShownAtMs: 0, nowMs: 4500 }), 0);
  });
  it("measures from display time, independent of the result side and network delay", () => {
    assert.equal(
      resultHoldRemainingMs({ resultShownAtMs: 12000, nowMs: 16499 }),
      1,
    );
    assert.equal(
      resultHoldRemainingMs({ resultShownAtMs: 12000, nowMs: 16500 }),
      0,
    );
  });
});

describe("decelerating coin wiring (FlipCoin)", () => {
  it("rAF loop driven by authoritative pending face (never guessed)", () => {
    const s = coin();
    assert.ok(s.includes("requestAnimationFrame"), "frame-driven motion");
    assert.ok(
      s.includes(
        'flipTarget === "HEADS" ? "heads" : flipTarget === "TAILS" ? "tails" : null',
      ),
      "target derived only from the passed authoritative face",
    );
    assert.ok(!s.includes("Math.random"), "no random final side");
  });

  it("unknown result spins fast; known result eases onto the face", () => {
    const s = coin();
    assert.ok(s.includes("FLIP_FAST_DEG_PER_SEC"), "fast constant phase");
    assert.ok(
      s.includes("planFlipFinish({"),
      "finish planned from current angle",
    );
    assert.ok(
      s.includes("1 - Math.pow(1 - p, 3)"),
      "continuous ease-out curve",
    );
  });

  it("static result faces retained; reduced-motion keeps the CSS path", () => {
    const s = coin();
    assert.ok(
      s.includes("is-heads") && s.includes("is-tails"),
      "exact face classes kept",
    );
    assert.ok(s.includes("prefers-reduced-motion"), "reduced motion respected");
    assert.ok(
      s.includes("is-driven"),
      "driven class separates rAF from CSS spin",
    );
  });

  it("GameHero passes the flip presentation props through", () => {
    const hero = readFileSync(
      join(root, "components", "game", "GameHero.tsx"),
      "utf8",
    );
    for (const prop of ["flipTarget", "flipRoundId", "flipRevealAtMs"]) {
      assert.ok(hero.includes(prop), `GameHero forwards ${prop}`);
    }
    const s = client();
    assert.ok(
      s.includes("flipTarget={flipTarget}"),
      "client wires the pending face",
    );
    assert.ok(
      s.includes("setFlipTick((t) => t + 1)"),
      "hold commit re-renders for fresh props",
    );
  });
});
