"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GameStateId, Side } from "@/lib/mockGameData";
import { FLIP_FAST_DEG_PER_SEC, planFlipFinish } from "@/lib/game/flipReveal";

type CoinSide = "heads" | "tails";
type CoinMode = "default" | "selected" | "flipping" | "result";

const HEADS_IMG = "/assets/coin/heads-coin.webp";
const TAILS_IMG = "/assets/coin/tails-coin.webp";
const DEFAULT_IMG = "/assets/coin/default-coin.webp";

export interface CoinImages {
  heads?: string | null;
  tails?: string | null;
  def?: string | null;
}

function toCoinSide(side: Side): CoinSide {
  return side === "HEADS" ? "heads" : "tails";
}

function resolveCoin(
  state: GameStateId,
  selectedSide: Side | null,
  result: Side | null
): { mode: CoinMode; face: CoinSide | null } {
  switch (state) {
    case "match-found":
    case "flipping":
      // Neutral physical flip: alternate HEADS/TAILS faces, never rest on one.
      return { mode: "flipping", face: null };
    case "win":
    case "loss":
      // Actual resolved result — never the player's pick.
      if (result) return { mode: "result", face: toCoinSide(result) };
      if (selectedSide) return { mode: "result", face: toCoinSide(selectedSide) };
      return { mode: "default", face: null };
    case "heads-selected":
      return { mode: "selected", face: "heads" };
    case "tails-selected":
      return { mode: "selected", face: "tails" };
    case "joining":
      // Keep the committed side visible while submitting.
      if (selectedSide) return { mode: "selected", face: toCoinSide(selectedSide) };
      return { mode: "default", face: null };
    case "queued-heads":
      return { mode: "selected", face: "heads" };
    case "queued-tails":
      return { mode: "selected", face: "tails" };
    case "error":
      // Preserve the known logical face; otherwise fall back to idle.
      if (result) return { mode: "result", face: toCoinSide(result) };
      if (selectedSide) return { mode: "selected", face: toCoinSide(selectedSide) };
      return { mode: "default", face: null };
    case "insufficient-balance":
    case "price-unavailable":
      // Keep selection if the user already committed; otherwise idle.
      if (selectedSide) return { mode: "selected", face: toCoinSide(selectedSide) };
      return { mode: "default", face: null };
    case "paused":
    case "disconnected":
    case "connected":
    case "ready":
    default:
      return { mode: "default", face: null };
  }
}

function ariaLabelFor(mode: CoinMode, face: CoinSide | null): string {
  if (mode === "flipping") return "Coin flipping";
  if (mode === "result") return face === "tails" ? "Coin result: Tails" : "Coin result: Heads";
  if (mode === "selected") return face === "tails" ? "Tails selected" : "Heads selected";
  return "Heads or Tails game coin";
}

export function FlipCoin({
  state,
  selectedSide,
  result,
  images,
  flipTarget,
  flipRoundId,
  flipRevealAtMs,
}: {
  state: GameStateId;
  selectedSide: Side | null;
  result: Side | null;
  images?: CoinImages;
  /** Authoritative pending result face while flipping (never guessed). */
  flipTarget?: Side | null;
  /** Live Match ID owning the current flip presentation. */
  flipRoundId?: string | null;
  /** Absolute reveal timestamp (ms) for the pending result, if known. */
  flipRevealAtMs?: number | null;
}) {
  const headsImg = images?.heads ?? HEADS_IMG;
  const tailsImg = images?.tails ?? TAILS_IMG;
  const defaultImg = images?.def ?? DEFAULT_IMG;
  const { mode, face } = resolveCoin(state, selectedSide, result);
  const isDefault = mode === "default";
  const isFlipping = mode === "flipping";
  // Static physical-coin orientation for selected / result states.
  const physicalOrientation = face === "tails" ? "is-tails" : "is-heads";
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  // JS-driven flip (unless reduced motion, which keeps the CSS fade path):
  // constant very-fast spin while the result is unknown, then a continuous
  // ease-out finish landing EXACTLY on the authoritative face. The CSS
  // infinite spin cannot land deterministically, so it stays only as the
  // reduced-motion fallback.
  const driven = isFlipping && !reducedMotion && flipRoundId != null;
  const coin3dRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<{ roundId: string | null; angle: number; vel: number }>({
    roundId: null,
    angle: 0,
    vel: FLIP_FAST_DEG_PER_SEC,
  });
  useEffect(() => {
    const el = coin3dRef.current;
    if (!driven || !el || flipRoundId == null) return;
    const spin = spinRef.current;
    if (spin.roundId !== flipRoundId) {
      spin.roundId = flipRoundId;
      spin.angle = 0;
      spin.vel = FLIP_FAST_DEG_PER_SEC;
    }
    const targetFace = flipTarget === "HEADS" ? "heads" : flipTarget === "TAILS" ? "tails" : null;
    if (targetFace === null) {
      // Result unknown: constant very-fast spin, tracking angle/velocity.
      let raf = 0;
      let last = performance.now();
      spin.vel = FLIP_FAST_DEG_PER_SEC;
      const tick = (now: number) => {
        const dt = Math.min(100, now - last);
        last = now;
        spin.angle = (spin.angle + FLIP_FAST_DEG_PER_SEC * (dt / 1000)) % 360;
        el.style.transform = `rotateY(${spin.angle}deg)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        // Hand back to the static face class: the rAF loop always ends on
        // the exact target-congruent angle, so the 0.55s class transition
        // has ~zero distance to cover — no snap, no backward spin.
        el.style.transform = "";
      };
    }
    // authoritative face — continuous with the fast spin, no jumps, no snap.
    // Date.now and performance.now have different epochs, but only the
    // DURATION crosses the boundary, which is epoch-safe.
    const revealAt = flipRevealAtMs ?? Date.now() + 5000;
    const plan = planFlipFinish({
      fromAngleDeg: spin.angle,
      targetFace,
      durationMs: Math.max(0, revealAt - Date.now()),
      startDegPerSec: spin.vel,
    });
    const startAngle = spin.angle;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / plan.durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      spin.angle = startAngle + plan.totalDeg * eased;
      spin.vel = (plan.totalDeg * 3 * Math.pow(1 - p, 2)) / (plan.durationMs / 1000);
      el.style.transform = `rotateY(${spin.angle}deg)`;
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        spin.angle = plan.endDeg;
        spin.vel = 0;
        el.style.transform = `rotateY(${plan.endDeg}deg)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [driven, flipRoundId, flipTarget, flipRevealAtMs]);
  const glow =
    mode === "default"
      ? "coin-glow-default"
      : face === "tails"
        ? "coin-glow-tails"
        : "coin-glow-heads";

  return (
    <div
      className={`coin-scene coin-stage mx-auto h-[210px] w-[210px] sm:h-[300px] sm:w-[300px] ${glow}`}
      role="img"
      aria-label={ariaLabelFor(mode, face)}
    >
      <div className="coin-float relative h-full w-full">
        {/* Idle default hero visual */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ease-out ${isDefault ? "opacity-100" : "pointer-events-none opacity-0"}`}
          aria-hidden={!isDefault}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> keeps CSS 3D backface-visibility intact; next/image wrappers break the flip */}
          <img
            src={defaultImg}
            alt=""
            width={768}
            height={768}
            draggable={false}
            decoding="async"
            fetchPriority="high"
            className="h-full w-full object-contain"
          />
        </div>
        {/* Single physical gameplay coin: HEADS front / TAILS back */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ease-out ${isDefault ? "pointer-events-none opacity-0" : "opacity-100"}`}
          aria-hidden={isDefault}
        >
          <div
            ref={coin3dRef}
            className={`coin-3d relative h-full w-full ${isFlipping ? (driven ? "is-driven" : "is-flipping") : physicalOrientation}`}
          >
            <div className="coin-face absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> keeps CSS 3D backface-visibility intact; next/image wrappers break the flip */}
              <img
                src={headsImg}
                alt=""
                width={768}
                height={768}
                draggable={false}
                decoding="async"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="coin-face absolute inset-0" style={{ transform: "rotateY(180deg)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> keeps CSS 3D backface-visibility intact; next/image wrappers break the flip */}
              <img
                src={tailsImg}
                alt=""
                width={768}
                height={768}
                draggable={false}
                decoding="async"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
