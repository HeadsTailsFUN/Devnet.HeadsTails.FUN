"use client";

import { useCallback, useEffect, useState } from "react";
import { gamesLabel, shortWallet, winsLabel, type LeaderboardRow, type LeaderboardTab } from "@/lib/leaderboard";

function Avatar({ row }: { row: LeaderboardRow }) {
  if (row.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.avatarUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold text-white"
    >
      {(row.username ?? row.wallet).slice(0, 1).toUpperCase()}
    </span>
  );
}

export function LeaderboardList({ tab, onSelectUser }: { tab: LeaderboardTab; onSelectUser?: (wallet: string) => void }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  const load = useCallback(() => {
    let stop = false;
    fetch(`/api/leaderboard?tab=${tab}&limit=25`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!stop) setRows(((b as { rows?: LeaderboardRow[] } | null)?.rows ?? []) as LeaderboardRow[]);
      })
      .catch(() => {
        if (!stop) setRows([]);
      });
    return () => {
      stop = true;
    };
  }, [tab]);

  useEffect(() => {
    const cleanup = load();
    const t = setInterval(load, 60000);
    return () => {
      cleanup?.();
      clearInterval(t);
    };
  }, [load]);

  if (rows === null) {
    return <p className="py-6 text-center text-[13px] text-[var(--text-secondary)]">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-[var(--text-secondary)]">No players yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <li key={r.wallet}>
          <button
            type="button"
            onClick={() => onSelectUser?.(r.wallet)}
            className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition hover:bg-white/5"
          >
            <span className="w-6 shrink-0 text-center text-[12px] font-bold text-white/50">{i + 1}</span>
            <Avatar row={r} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-bold ${r.rankColorClass}`}>
                {r.username ?? shortWallet(r.wallet)}
              </span>
              <span className="block text-[11px] text-[var(--text-secondary)]">
                {tab === "wins" ? `${winsLabel(r.wins)} • ${gamesLabel(r.gamesPlayed)}` : `${gamesLabel(r.gamesPlayed)} • ${winsLabel(r.wins)}`}
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-white/60">
              {r.displayRank}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function LeaderboardPanel({ onSelectUser }: { onSelectUser?: (wallet: string) => void }) {
  const [tab, setTab] = useState<LeaderboardTab>("wins");
  return (
    <section aria-label="Leaderboard" className="glass flex h-full min-h-[560px] w-full min-w-0 flex-1 flex-col rounded-3xl p-4">
      <h2 className="font-display text-[16px] font-bold text-white">Leaderboard</h2>
      <div role="tablist" aria-label="Leaderboard tabs" className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-white/5 p-1">
        {(["wins", "played"] as LeaderboardTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-[36px] rounded-xl text-[12px] font-bold tracking-wide transition ${
              tab === t ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            {t === "wins" ? "MOST WINS" : "MOST PLAYED"}
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
        <LeaderboardList tab={tab} onSelectUser={onSelectUser} />
      </div>
    </section>
  );
}
