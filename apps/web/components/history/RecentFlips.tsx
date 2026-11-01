"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  shortWallet,
  solscanAccountUrl,
  solscanTxUrl,
  timeAgo,
  type RecentFlip,
} from "@/lib/solana/history";
import { SOLANA_CLUSTER } from "@/lib/solana/cluster";

const HEADS_IMG = "/assets/coin/heads-coin.webp";
const TAILS_IMG = "/assets/coin/tails-coin.webp";

function flipKey(f: RecentFlip): string {
  return `${f.matchId}-${f.settlementSignature.slice(0, 8)}`;
}

export function RecentFlipDetailsModal({
  flip,
  onClose,
}: {
  flip: RecentFlip;
  onClose: () => void;
}) {
  const settlementUrl = solscanTxUrl(flip.settlementSignature, SOLANA_CLUSTER);
  const matchUrl = flip.matchPda ? solscanAccountUrl(flip.matchPda, SOLANA_CLUSTER) : null;
  const randomnessUrl = flip.randomnessAccount
    ? solscanAccountUrl(flip.randomnessAccount, SOLANA_CLUSTER)
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close round details"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`ROUND #${flip.matchId} details`}
        className="glass relative max-h-[85svh] w-full max-w-sm min-w-0 overflow-y-auto rounded-t-3xl p-5 text-left text-xs shadow-xl sm:rounded-3xl"
      >
        <p className="font-display text-[15px] font-bold text-white">ROUND #{flip.matchId}</p>
        <p className="mt-0.5 text-[11px] font-bold tracking-widest text-white/60">
          ROOM ${flip.tierUsd}
        </p>
        <dl className="mt-2 space-y-1 text-[var(--text-secondary)]">
          <div className="flex justify-between gap-2"><dt>HEADS</dt><dd className="break-all text-right font-semibold text-white">{shortWallet(flip.headsWallet)}</dd></div>
          <div className="flex justify-between gap-2"><dt>TAILS</dt><dd className="break-all text-right font-semibold text-white">{shortWallet(flip.tailsWallet)}</dd></div>
          <div className="flex justify-between gap-2"><dt>RESULT</dt><dd className="font-semibold text-white">{flip.result}</dd></div>
          <div className="flex justify-between gap-2"><dt>WINNER</dt><dd className="break-all text-right font-semibold text-white">{shortWallet(flip.winnerWallet)}</dd></div>
          <div className="flex justify-between gap-2"><dt>POT</dt><dd className="font-semibold text-white">{BigInt(flip.potBaseUnits).toLocaleString("en-US")} base units</dd></div>
          {flip.matchPda && (
            <div className="flex justify-between gap-2"><dt>Match PDA</dt><dd className="break-all text-right font-mono text-[10px] text-white">{shortWallet(flip.matchPda)}</dd></div>
          )}
          {flip.randomnessAccount && (
            <div className="flex justify-between gap-2"><dt>Randomness</dt><dd className="break-all text-right font-mono text-[10px] text-white">{shortWallet(flip.randomnessAccount)}</dd></div>
          )}
          <div className="flex justify-between gap-2"><dt>Time</dt><dd className="font-semibold text-white">{timeAgo(flip.settledAt)}</dd></div>
        </dl>
        <div className="mt-3 flex flex-col gap-1.5">
          {settlementUrl && (
            <a
              href={settlementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-center font-semibold text-white hover:bg-white/15"
            >
              View Settlement on Solscan ↗
            </a>
          )}
          {matchUrl && (
            <a
              href={matchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-center font-semibold text-white hover:bg-white/15"
            >
              View Match Account ↗
            </a>
          )}
          {randomnessUrl && (
            <a
              href={randomnessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-center font-semibold text-white hover:bg-white/15"
            >
              Verify Randomness ↗
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg py-1 text-[13px] font-semibold text-[var(--text-secondary)] hover:text-white"
        >
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

export function RecentFlipItem({
  flip,
  open,
  onToggle,
}: {
  flip: RecentFlip;
  open: boolean;
  onToggle: () => void;
}) {
  const isHeads = flip.result === "HEADS";
  return (
    <div className="flex min-w-0 flex-col items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`ROUND #${flip.matchId} — ${flip.result}, winner ${shortWallet(flip.winnerWallet)}`}
        title={`ROUND #${flip.matchId} • ROOM $${flip.tierUsd} • ${shortWallet(flip.winnerWallet)}`}
        // Fixed frame + measured per-asset visual centering. The source art
        // is edge-to-edge glow, so raw canvas center != perceived center:
        // alpha-weighted centroids (measured from the PNG alpha channel,
        // 1254px canvas; cross-checked against the opaque bbox center)
        // sit at HEADS (-15.5,-2.1) and TAILS (-18.7,-13.8) vs canvas
        // center. The inverse shift, expressed as % of the 40px render
        // (HEADS +1.24%/+0.17%, TAILS +1.49%/+1.10%), centers the perceived
        // mass. Same box size for both coins, no crop, no distortion,
        // identical every round.
        className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 transition hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          isHeads
            ? "border-[var(--heads)] shadow-[0_0_16px_var(--heads-glow)]"
            : "border-[var(--tails)] shadow-[0_0_16px_var(--tails-glow)]"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={isHeads ? HEADS_IMG : TAILS_IMG}
          alt=""
          width={40}
          height={40}
          draggable={false}
          style={
            isHeads
              ? { transform: "translate(1.24%, 0.17%)" }
              : { transform: "translate(1.49%, 1.1%)" }
          }
          className="h-10 w-10 shrink-0 rounded-full object-contain object-center"
        />
      </button>
      <span className="mt-0.5 text-[10px] font-bold leading-none text-white/60">#{flip.matchId}</span>
    </div>
  );
}

export function RecentFlips({
  flips,
  live,
  unavailable,
  tierUsd,
}: {
  flips?: RecentFlip[];
  live?: boolean;
  unavailable?: boolean;
  tierUsd?: number;
}) {
  // NEVER fall back to mock fixtures: empty stays empty. Tier-filtered.
  const items = (flips ?? []).filter((f) =>
    typeof tierUsd === "number" ? f.tierUsd === tierUsd : true
  );
  // Single-open dialog state: only one round details view open at once.
  // The dialog is portaled to document.body (outside the horizontal scroll
  // container) so ancestor overflow-x can never clip it — the previous
  // absolutely-positioned panel inside overflow-x-auto rendered as a
  // black/clipped fragment above the row.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openFlip = items.find((f) => flipKey(f) === openKey) ?? null;
  return (
    <section aria-label="Recent flips" className="w-full max-w-[880px] min-w-0">
      <div className="glass flex min-w-0 items-center gap-4 overflow-hidden rounded-3xl px-4 py-3 sm:px-5">
        <div className="shrink-0">
          <h2 className="font-display text-[17px] font-bold text-white">Recent Flips</h2>
        </div>
        {unavailable ? (
          <p className="flex-1 py-2 text-center text-[13px] text-[var(--text-secondary)]">
            History temporarily unavailable
          </p>
        ) : items.length === 0 ? (
          <p className="flex-1 py-2 text-center text-[13px] text-[var(--text-secondary)]">
            No flips settled yet.
          </p>
        ) : (
          <div className="no-scrollbar flex min-w-0 flex-1 items-start gap-2.5 overflow-x-auto px-1 py-2" role="list" aria-label={live ? "Latest on-chain results" : "Latest results"}>
            {items.map((f) => {
              const k = flipKey(f);
              return (
                <div key={k} role="listitem" className="shrink-0 py-0.5">
                  <RecentFlipItem
                    flip={f}
                    open={openKey === k}
                    onToggle={() => setOpenKey((prev) => (prev === k ? null : k))}
                  />
                </div>
              );
            })}
          </div>
        )}
        {openFlip && (
          <RecentFlipDetailsModal flip={openFlip} onClose={() => setOpenKey(null)} />
        )}
        <div className="hidden shrink-0 border-l border-white/10 pl-4 text-right sm:block">
          <p className="flex items-center justify-end gap-1.5 text-[12.5px] font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-[var(--heads)]" aria-hidden="true" />
            Latest results
          </p>
          <p className="text-[12px] text-[var(--text-secondary)]">Just now</p>
        </div>
      </div>
    </section>
  );
}
