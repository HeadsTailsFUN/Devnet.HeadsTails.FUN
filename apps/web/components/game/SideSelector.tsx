"use client";

import type { GameStateId, Side } from "@/lib/mockGameData";

export function HeadsButton({
  selected,
  disabled,
  onPick,
}: {
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      className={`font-display inline-flex min-h-[56px] flex-1 items-center justify-center rounded-2xl px-6 py-4 text-[20px] font-bold tracking-[0.08em] transition [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_0_22px_rgba(255,255,255,0.35)] sm:flex-none sm:px-10 ${
        selected
          ? "btn-heads ring-2 ring-white/80"
          : "btn-heads opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
      }`}
    >
      HEADS
    </button>
  );
}

export function TailsButton({
  selected,
  disabled,
  onPick,
}: {
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      className={`font-display inline-flex min-h-[56px] flex-1 items-center justify-center rounded-2xl px-6 py-4 text-[20px] font-bold tracking-[0.08em] transition [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_0_22px_rgba(255,255,255,0.35)] sm:flex-none sm:px-10 ${
        selected
          ? "btn-tails ring-2 ring-white/80"
          : "btn-tails opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
      }`}
    >
      TAILS
    </button>
  );
}

export function SideSelector({
  state,
  selectedSide,
  onPick,
}: {
  state: GameStateId;
  selectedSide: Side | null;
  onPick: (s: Side) => void;
}) {
  const interactive =
    state === "ready" ||
    state === "connected" ||
    state === "heads-selected" ||
    state === "tails-selected";
  return (
    <div
      className="flex w-full max-w-[560px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-center"
      role="group"
      aria-label="Pick your side"
    >
      <HeadsButton selected={selectedSide === "HEADS"} disabled={!interactive} onPick={() => onPick("HEADS")} />
      <TailsButton selected={selectedSide === "TAILS"} disabled={!interactive} onPick={() => onPick("TAILS")} />
    </div>
  );
}
