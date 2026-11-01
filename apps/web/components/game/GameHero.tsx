"use client";

import { FlipCoin, type CoinImages } from "@/components/game/FlipCoin";
import { FlipPill, LivePriceNotice } from "@/components/game/HeroBits";
import { SideSelector } from "@/components/game/SideSelector";
import type { GameStateId, Side } from "@/lib/mockGameData";

export function GameHero({
  state,
  selectedSide,
  result,
  onPick,
  subtitle,
  images,
  roomLabel,
  flipTarget,
  flipRoundId,
  flipRevealAtMs,
}: {
  state: GameStateId;
  selectedSide: Side | null;
  result: Side | null;
  onPick: (s: Side) => void;
  subtitle?: string | null;
  images?: CoinImages;
  roomLabel?: string;
  /** Authoritative pending result face while flipping (presentation-only). */
  flipTarget?: Side | null;
  /** Live Match ID owning the current flip presentation. */
  flipRoundId?: string | null;
  /** Absolute reveal timestamp (ms) for the pending result, if known. */
  flipRevealAtMs?: number | null;
}) {
  const priceMode =
    state === "price-unavailable" ? "unavailable" : state === "paused" ? "paused" : "live";
  return (
    <section aria-label="Flip game" className="relative z-10 flex w-full flex-col items-center gap-5 px-4 text-center">
      <FlipPill label={roomLabel} />
      {/* decorative doodles: text-only, CSS positioned, hidden on small screens if crowded */}
      <span aria-hidden="true" className="font-display pointer-events-none absolute left-[6%] top-2 hidden -rotate-6 text-left text-[15px] leading-tight text-white/60 xl:block">
        Flip<br />Play<br />Win<br />On Solana.
      </span>
      <span aria-hidden="true" className="pointer-events-none absolute right-[7%] top-24 hidden rotate-3 text-right text-[15px] italic leading-tight text-white/60 xl:block">
        GOOD<br />LUCK<br />DEGENS!
      </span>
      <FlipCoin
        state={state}
        selectedSide={selectedSide}
        result={result}
        images={images}
        flipTarget={flipTarget ?? null}
        flipRoundId={flipRoundId ?? null}
        flipRevealAtMs={flipRevealAtMs ?? null}
      />
      <h1 className="font-display max-w-[22ch] text-[26px] font-bold leading-tight text-white sm:text-[32px]">
        Pick your side and wait for a match
      </h1>
      {subtitle ? (
        <p className="max-w-[52ch] text-[14px] text-[var(--text-secondary)]">{subtitle}</p>
      ) : null}
      <SideSelector state={state} selectedSide={selectedSide} onPick={onPick} />
      <LivePriceNotice mode={priceMode} />
    </section>
  );
}
