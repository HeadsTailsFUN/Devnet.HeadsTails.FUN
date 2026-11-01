"use client";

import type { GameStateId, Side } from "@/lib/mockGameData";

const COPY: Record<GameStateId, { title: string; body: string; tone: "neutral" | "heads" | "tails" | "bad" | "warn" }> = {
  disconnected: { title: "Connect to play", body: "Connect a Solana wallet to join a flip room.", tone: "neutral" },
  connected: { title: "Wallet connected", body: "Pick a side to continue.", tone: "neutral" },
  ready: { title: "Pick a side", body: "Pick HEADS or TAILS.", tone: "neutral" },
  "heads-selected": { title: "You Selected HEADS", body: "Confirm to join.", tone: "heads" },
  "tails-selected": { title: "You Selected TAILS", body: "Confirm to join.", tone: "tails" },
  joining: { title: "Joining…", body: "Confirming your spot…", tone: "neutral" },
  "queued-heads": { title: "You Selected HEADS", body: "Waiting for a player...", tone: "heads" },
  "queued-tails": { title: "You Selected TAILS", body: "Waiting for a player...", tone: "tails" },
  "match-found": { title: "Match Found", body: "Getting the result…", tone: "neutral" },
  flipping: { title: "Flipping...", body: "Getting the result…", tone: "neutral" },
  win: { title: "YOU WIN", body: "You won.", tone: "heads" },
  loss: { title: "YOU LOSE", body: "Better luck next time.", tone: "tails" },
  error: { title: "Action failed", body: "Please retry. Details below.", tone: "bad" },
  "price-unavailable": { title: "Price unavailable", body: "Token price feed is down. Entry amount hidden until it recovers.", tone: "warn" },
  "insufficient-balance": { title: "Insufficient balance", body: "Top up to keep playing.", tone: "warn" },
  paused: { title: "Flips paused", body: "New joins are disabled right now.", tone: "warn" },
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
}: {
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
  const c = COPY[state];
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
  const showConfirm = state === "heads-selected" || state === "tails-selected";
  const showLeave = state === "queued-heads" || state === "queued-tails";
  const showRetry = state === "error";
  const busy = state === "joining" || state === "flipping" || state === "match-found";

  return (
    <section aria-live="polite" aria-label="Game status" className={`glass w-full max-w-[560px] rounded-3xl border ${border} px-5 py-4 text-center`}>
      <h2 className="font-display text-[19px] font-bold text-white">{c.title}</h2>
      {matchLabel && (
        <p className="mt-1 text-[12px] font-bold tracking-widest text-white/70">{matchLabel}</p>
      )}
      <p className="mx-auto mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{detail ?? c.body}</p>
      {queuePositionText ? (
        <p className="mt-2 text-[12px] font-bold tracking-widest text-white">{queuePositionText}</p>
      ) : selectedSide && (showConfirm || showLeave) ? (
        <p className="mt-2 text-[12px] font-semibold tracking-widest text-white/60">
          SIDE: {selectedSide} {result ? `• RESULT: ${result}` : ""}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
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
          <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-white/80" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            Working…
          </p>
        )}
        {settleLine && (state === "win" || state === "loss") && (
          <p role="status" className="inline-flex min-h-[44px] items-center rounded-2xl bg-white/5 px-6 text-[13px] font-bold text-white">
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
            className="inline-flex min-h-[44px] items-center rounded-2xl border border-white/15 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Play Again
          </button>
        )}
      </div>
      <p className="mt-3 text-[11px] tracking-wide text-white/40">
        {live
          ? "Live game."
          : "Connect a wallet to play."}
      </p>
    </section>
  );
}

export function TransactionStatus({ state }: { state: GameStateId }) {
  const steps = ["Pick Side", "Queue", "Match", "Flip", "GG"];
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
    <ol aria-label="Progress" className="flex w-full max-w-[560px] items-center justify-center gap-1.5 text-[11px] font-semibold">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
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
          <span className={i === active ? "text-white" : "hidden text-white/50 sm:inline"}>{s}</span>
          {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-4 bg-white/20 sm:w-8" />}
        </li>
      ))}
    </ol>
  );
}
