"use client";

import { useEffect, useState } from "react";
import { shortWallet } from "@/lib/leaderboard";
import type { PublicProfile } from "@/lib/profiles/types";

/** Read-only public profile summary (leaderboard/chat identity clicks). */
export function PublicProfileModal({ wallet, onClose }: { wallet: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  useEffect(() => {
    let stop = false;
    fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!stop) setProfile((b as { profile?: PublicProfile } | null)?.profile ?? null);
      })
      .catch(() => {
        if (!stop) setProfile(null);
      });
    return () => {
      stop = true;
    };
  }, [wallet]);

  const winRate = profile && profile.winRate !== null ? `${(profile.winRate * 100).toFixed(1)}%` : "—";

  return (
    <div role="dialog" aria-modal="true" aria-label="Player profile" className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" aria-label="Close player profile" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="glass relative w-full max-w-sm rounded-3xl p-5">
        <div className="flex items-center gap-3">
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-lg font-bold text-white">
              {(profile?.username ?? wallet).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className={`truncate text-[16px] font-bold ${profile?.rankColorClass ?? "text-white"}`}>
              {profile?.username ?? shortWallet(wallet)}
            </p>
            <p className="truncate text-[12px] text-[var(--text-secondary)]">{shortWallet(wallet)}</p>
          </div>
          {profile && (
            <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-white/70">
              {profile.displayRank}
            </span>
          )}
        </div>
        {!profile ? (
          <p className="mt-4 py-4 text-center text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : (
          <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
            {[
              ["Games", String(profile.gamesPlayed)],
              ["Wins", String(profile.wins)],
              ["Losses", String(profile.losses)],
              ["Win %", winRate],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{k}</dt>
                <dd className="text-[15px] font-bold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-white/15 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Close
        </button>
      </div>
    </div>
  );
}
