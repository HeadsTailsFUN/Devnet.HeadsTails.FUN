"use client";
import Image from "next/image";

import { useEffect, useRef, useState } from "react";
import { ResultReaction } from "./ResultReaction";
import { MIN_RESULT_HOLD_MS } from "@/lib/game/flipReveal";
import type { GameStateId, Side } from "@/lib/mockGameData";

const COPY: Record<
  GameStateId,
  {
    title: string;
    body: string;
    tone: "neutral" | "heads" | "tails" | "bad" | "warn";
  }
> = {
  disconnected: {
    title: "Connect to play",
    body: "Connect a Solana wallet to join a flip room.",
    tone: "neutral",
  },
  connected: {
    title: "Wallet connected",
    body: "Pick a side to continue.",
    tone: "neutral",
  },
  ready: {
    title: "Pick a side",
    body: "Pick HEADS or TAILS.",
    tone: "neutral",
  },
  "heads-selected": {
    title: "You Selected HEADS",
    body: "Confirm to join.",
    tone: "heads",
  },
  "tails-selected": {
    title: "You Selected TAILS",
    body: "Confirm to join.",
    tone: "tails",
  },
  joining: {
    title: "Joining…",
    body: "Confirming your spot…",
    tone: "neutral",
  },
  "queued-heads": {
    title: "You Selected HEADS",
    body: "Waiting for a player...",
    tone: "heads",
  },
  "queued-tails": {
    title: "You Selected TAILS",
    body: "Waiting for a player...",
    tone: "tails",
  },
  "match-found": {
    title: "Match Found",
    body: "Getting the result…",
    tone: "neutral",
  },
  flipping: {
    title: "Flipping...",
    body: "Getting the result…",
    tone: "neutral",
  },
  win: { title: "YOU WIN", body: "You won.", tone: "heads" },
  loss: { title: "YOU LOSE", body: "Better luck next time.", tone: "tails" },
  error: {
    title: "Action failed",
    body: "Please retry. Details below.",
    tone: "bad",
  },
  "price-unavailable": {
    title: "Price unavailable",
    body: "Token price feed is down. Entry amount hidden until it recovers.",
    tone: "warn",
  },
  "insufficient-balance": {
    title: "Insufficient balance",
    body: "Top up to keep playing.",
    tone: "warn",
  },
  paused: {
    title: "Flips paused",
    body: "New joins are disabled right now.",
    tone: "warn",
  },
};

export function GameStatePanel({
  state,
  selectedSide,
  result,
  onConfirm,
  onLeave,
  onRetry,
  detail,
  live,
  matchLabel,
  queuePositionText,
  playAgainReady,
  onPlayAgain,
  settleLine,
  onRetryPayout,
  retryPayoutBusy,
  walletAddress,
  completedMatchId,
  needsVerification,
  needsConnection,
  onVerify,
  onConnect,
  resultVisible = true,
}: {
  walletAddress?: string | null;
  completedMatchId?: string | null;
  needsVerification?: boolean;
  needsConnection?: boolean;
  onVerify?: () => void;
  onConnect?: () => void;
  resultVisible?: boolean;
  state: GameStateId;
  selectedSide: Side | null;
  result: Side | null;
  onConfirm: () => void;
  onLeave: () => void;
  onRetry: () => void;
  detail?: string;
  live?: boolean;
  matchLabel?: string;
  queuePositionText?: string;
  playAgainReady?: boolean;
  onPlayAgain?: () => void;
  /** Auto-settlement status line (winner/loser): Finalizing payout… / Winnings paid ✓ etc. */
  settleLine?: string | null;
  /** Rare pending-payout path: request SERVER to ensure the settlement job (no wallet tx). */
  onRetryPayout?: () => void;
  retryPayoutBusy?: boolean;
}) {
  const final = state === "win" || state === "loss";
  const [secondsLeft, setSecondsLeft] = useState(MIN_RESULT_HOLD_MS/1000);
  const remainingRef = useRef(MIN_RESULT_HOLD_MS);
  useEffect(() => {
    remainingRef.current = MIN_RESULT_HOLD_MS;
    setSecondsLeft(MIN_RESULT_HOLD_MS/1000);
  }, [final, completedMatchId]);
  useEffect(() => {
    if (!final || !resultVisible) return;
    let previous = performance.now(), visible = !document.hidden;
    const tick = () => {
      const now=performance.now();
      if(visible) remainingRef.current=Math.max(0,remainingRef.current-Math.max(0,now-previous));
      previous=now;
      setSecondsLeft(Math.ceil(remainingRef.current/1000));
      if(remainingRef.current===0)clearInterval(timer);
    };
    const visibility=()=>{tick();visible=!document.hidden;};
    const timer=setInterval(tick,100);
    document.addEventListener("visibilitychange",visibility);
    return()=>{tick();clearInterval(timer);document.removeEventListener("visibilitychange",visibility);};
  },[final,completedMatchId,resultVisible]);
  const canReplay=secondsLeft===0;
  const c = needsConnection ? COPY.disconnected : needsVerification
    ? {
        ...COPY.connected,
        title: "Verify your wallet",
        body: "Sign an ownership message to continue. This does not stake HTS.",
      }
    : COPY[state];
  const border =
    c.tone === "heads"
      ? "border-[rgba(61,255,200,.35)]"
      : c.tone === "tails"
        ? "border-[rgba(255,126,189,.35)]"
        : c.tone === "bad"
          ? "border-[rgba(255,93,122,.45)]"
          : c.tone === "warn"
            ? "border-[rgba(251,191,36,.4)]"
            : "border-white/10";
  const showConfirm =
    !needsConnection && !needsVerification &&
    (state === "heads-selected" || state === "tails-selected");
  const showLeave = state === "queued-heads" || state === "queued-tails";
  const showRetry = state === "error";
  const busy =
    state === "joining" || state === "flipping" || state === "match-found";

  return (
    <section
      aria-live="polite"
      aria-label="Game status"
      className={`glass relative isolate w-full max-w-[560px] rounded-3xl border ${border} px-5 py-4 text-center`}
    >
      {!needsVerification && state === "ready" && (
        <div
          className="pointer-events-none absolute inset-x-3 bottom-0 -z-10 flex justify-between"
          aria-hidden="true"
        >
          <Image
            data-character="HEADS"
            sizes="(max-width: 640px) 64px, 96px"
            quality={90}
            src="/assets/characters/Head.png"
            alt=""
            width={92}
            height={92}
            className="h-16 w-16 object-contain sm:h-24 sm:w-24"
          />
          <Image
            data-character="TAILS"
            sizes="(max-width: 640px) 64px, 96px"
            quality={90}
            src="/assets/characters/Tail.png?v=84ea5af5"
            alt=""
            width={92}
            height={92}
            className="h-16 w-16 object-contain sm:h-24 sm:w-24"
          />
        </div>
      )}
      {final && walletAddress && completedMatchId && (
        <ResultReaction
          key={`${walletAddress}:${completedMatchId}:${state}`}
          wallet={walletAddress}
          matchId={completedMatchId}
          win={state === "win"}
        />
      )}
      <h2 className="font-display text-[19px] font-bold text-white">
        {final ? (state === "win" ? "You won" : "You lost") : c.title}
      </h2>
      {final && secondsLeft>0 && <span role="timer" aria-label="Result countdown" className="sr-only">{secondsLeft} seconds remaining</span>}
      {matchLabel && (
        <p className="mt-1 text-[12px] font-bold tracking-widest text-white/70">
          {matchLabel}
        </p>
      )}
      <p className="mx-auto mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
        {needsConnection || needsVerification ? c.body : (detail ?? c.body)}
      </p>
      {queuePositionText ? (
        <p className="mt-2 text-[12px] font-bold tracking-widest text-white">
          {queuePositionText}
        </p>
      ) : selectedSide && (showConfirm || showLeave) ? (
        <p className="mt-2 text-[12px] font-semibold tracking-widest text-white/60">
          SIDE: {selectedSide} {result ? `• RESULT: ${result}` : ""}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {(state === "disconnected" || needsConnection) && onConnect && (
          <button
            type="button"
            onClick={onConnect}
            className="min-h-[44px] rounded-xl bg-[var(--heads)] px-5 font-bold text-black"
          >
            Connect Wallet
          </button>
        )}
        {needsVerification && onVerify && (
          <button
            type="button"
            onClick={onVerify}
            className="min-h-[44px] rounded-xl bg-[var(--heads)] px-5 font-bold text-black"
          >
            Verify Wallet
          </button>
        )}
        {showConfirm && (
          <button
            type="button"
            onClick={onConfirm}
            className="font-display inline-flex min-h-[44px] items-center rounded-2xl bg-white px-6 text-[15px] font-bold text-black transition hover:bg-slate-200"
          >
            Confirm
          </button>
        )}
        {showLeave && (
          <button
            type="button"
            onClick={onLeave}
            className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Leave
          </button>
        )}
        {showRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center rounded-2xl bg-[#ff5d7a] px-6 text-sm font-bold text-white transition hover:brightness-110"
          >
            Retry
          </button>
        )}
        {busy && (
          <p
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-white/80"
            role="status"
          >
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              aria-hidden="true"
            />
            Working…
          </p>
        )}
        {settleLine && (state === "win" || state === "loss") && (
          <p
            role="status"
            className="inline-flex min-h-[44px] items-center rounded-2xl bg-white/5 px-6 text-[13px] font-bold text-white"
          >
            {settleLine}
          </p>
        )}
        {onRetryPayout && (state === "win" || state === "loss") && (
          <button
            type="button"
            onClick={onRetryPayout}
            disabled={retryPayoutBusy}
            title="Requests the server to ensure the auto-settlement job exists. No wallet transaction."
            className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-6 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
          >
            {retryPayoutBusy ? "Requesting…" : "Retry payout"}
          </button>
        )}
        {playAgainReady && onPlayAgain && (
          <button
            type="button"
            onClick={onPlayAgain}
            disabled={!canReplay}
            className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Play Again
          </button>
        )}
      </div>
      <p className="mt-3 text-[11px] tracking-wide text-white/40">
        {live ? "Live game." : "Connect a wallet to play."}
      </p>
    </section>
  );
}

export function TransactionStatus({
  state,
  needsVerification,
}: {
  state: GameStateId;
  needsVerification?: boolean;
}) {
  const steps = [
    state === "disconnected"
      ? "Connect"
      : needsVerification
        ? "Verify Wallet"
        : "Pick Side",
    "Queue",
    "Match",
    "Flip",
    "GG",
  ];
  const idx: Record<GameStateId, number> = {
    disconnected: 0,
    connected: 0,
    ready: 0,
    "heads-selected": 0,
    "tails-selected": 0,
    joining: 1,
    "queued-heads": 1,
    "queued-tails": 1,
    "match-found": 2,
    flipping: 3,
    win: 4,
    loss: 4,
    error: 1,
    "price-unavailable": 0,
    "insufficient-balance": 0,
    paused: 0,
  };
  const active = idx[state] ?? 0;
  const done = state === "win" || state === "loss";
  return (
    <ol
      aria-label="Progress"
      className="flex w-full max-w-[560px] items-center justify-center gap-1 text-[11px] font-semibold sm:gap-1.5"
    >
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1 sm:gap-1.5">
          <span
            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 ${
              done || i < active
                ? "bg-[var(--heads)] text-black"
                : i === active
                  ? "bg-white text-black"
                  : "bg-white/10 text-white/60"
            }`}
            aria-current={i === active ? "step" : undefined}
          >
            {i + 1}
          </span>
          <span
            className={
              i === active ? "text-white" : "hidden text-white/50 sm:inline"
            }
          >
            {s}
          </span>
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="h-px w-2 bg-white/20 sm:mx-1 sm:w-8"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
