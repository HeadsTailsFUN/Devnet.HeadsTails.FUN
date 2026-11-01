"use client";

import { useCallback, useEffect, useState } from "react";
import { shortWallet } from "@/lib/leaderboard";
import { solscanTxUrl } from "@/lib/solana/history";
import { IS_DEVNET, SOLANA_CLUSTER } from "@/lib/solana/cluster";
import { isGameDiagnosticCode } from "@/lib/admin/gameDiagnostic";
import { WelcomeGrantDiagnosticCard } from "@/components/admin/WelcomeGrantDiagnosticCard";

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number | null; body: unknown }> {
  try {
    const r = await fetch(path, init);
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-4">
      <h3 className="font-display text-[15px] font-bold text-white">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** HT-FINAL-004 + HT-OBS: terminal game-load states (never infinite Loading). */
export type AdminGameLoad =
  | { status: "loading" }
  | { status: "success"; game: Record<string, string | boolean> }
  | { status: "error"; diagnostic: string | null };

export function OverviewTab({ canWebAdmin }: { canWebAdmin: boolean }) {
  const [gameState, setGameState] = useState<AdminGameLoad>({ status: "loading" });
  const [rewards, setRewards] = useState<{ totalMatches?: number; totalPaidBaseUnits?: string } | null>(null);
  const loadGame = useCallback(async () => {
    setGameState({ status: "loading" });
    const { ok, body } = await api("/api/admin/game");
    const b = body as { authority?: string; paused?: boolean; totalMatches?: string; diagnostic?: unknown } | null;
    if (ok && b && typeof b.paused === "boolean") {
      setGameState({ status: "success", game: b as Record<string, string | boolean> });
    } else {
      // HT-OBS: surface the safe GAME_* diagnostic beneath the friendly copy.
      setGameState({
        status: "error",
        diagnostic: isGameDiagnosticCode(b?.diagnostic) ? (b?.diagnostic as string) : null,
      });
    }
  }, []);
  useEffect(() => {
    void loadGame();
    void api("/api/admin/rewards").then(({ body }) => {
      const b = body as { totalMatches?: number; totalPaidBaseUnits?: string } | null;
      if (b) setRewards(b);
    });
  }, [loadGame]);
  const game = gameState.status === "success" ? gameState.game : null;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Game">
        {gameState.status === "loading" ? (
          <p className="text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : gameState.status === "error" ? (
          <div>
            <p role="alert" className="text-[13px] text-[#ff9db1]">Could not load on-chain game state.</p>
            {gameState.diagnostic && (
              <p className="mt-1 font-mono text-[11px] text-white/50">Diagnostic: {gameState.diagnostic}</p>
            )}
            <button
              type="button"
              onClick={() => void loadGame()}
              className="mt-2 rounded-2xl bg-white/10 px-4 py-2 text-[12px] font-bold text-white hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <div><dt className="text-white/50">Paused</dt><dd className="font-bold text-white">{String(game?.paused)}</dd></div>
            <div><dt className="text-white/50">Total matches</dt><dd className="font-bold text-white">{String(game?.totalMatches)}</dd></div>
            <div className="col-span-2"><dt className="text-white/50">Authority</dt><dd className="break-all font-mono text-[11px] text-white">{String(game?.authority)}</dd></div>
          </dl>
        )}
      </Section>
      <Section title="Rewards">
        {!rewards ? (
          <p className="text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : (
          <p className="text-[13px] text-white">
            {rewards.totalMatches ?? 0} matches • {rewards.totalPaidBaseUnits ?? "0"} base units paid
          </p>
        )}
      </Section>
      {/* HT-OBS: Devnet-only welcome-grant diagnostic card, OWNER/FULL_ADMIN
          only (moderators never see it). The endpoint itself fail-closes on
          Mainnet; hiding the card there is belt-and-braces. */}
      {canWebAdmin && IS_DEVNET && <WelcomeGrantDiagnosticCard />}
    </div>
  );
}

/** HT-FINAL-003: canonical Admin user shape (camelCase gamesPlayed). */
export interface AdminUser {
  wallet: string;
  username: string | null;
  avatar_path: string | null;
  manual_rank_override: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  displayRank?: string;
  muted?: boolean;
  webRestricted?: boolean;
}

export function UsersTab({ canWebAdmin }: { canWebAdmin: boolean }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const search = useCallback(async () => {
    const { ok, body } = await api(`/api/admin/users?query=${encodeURIComponent(q)}`);
    if (ok) setUsers(((body as { users?: AdminUser[] })?.users ?? []));
    else setNote("Search failed.");
  }, [q]);

  useEffect(() => {
    void search();
  }, [search]);

  const act = async (path: string, payload: Record<string, unknown>) => {
    setNote(null);
    const { ok, body } = await api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!ok) {
      setNote((body as { error?: string } | null)?.error ?? "Action failed.");
      return;
    }
    await search();
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Users">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="username or wallet"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white"
          />
          <button type="button" onClick={() => void search()} className="rounded-2xl bg-white px-4 text-[13px] font-bold text-black">
            Search
          </button>
        </div>
        {note && <p role="alert" className="mt-2 text-[12px] text-[#ff9db1]">{note}</p>}
        <ul className="mt-3 flex flex-col gap-2">
          {users.map((u) => {
            const w = u.wallet;
            const override = u.manual_rank_override;
            return (
              <li key={w} className="rounded-2xl border border-white/10 p-3">
                <p className="text-[13px] font-bold text-white">
                  {u.username ?? shortWallet(w)}{" "}
                  <span className="text-[11px] font-medium text-white/50">{shortWallet(w)} • {String(u.displayRank ?? "")}{override ? " (manual)" : " (auto)"} • {String(u.gamesPlayed ?? 0)}g/{String(u.wins ?? 0)}w</span>
                </p>
                <p className="mt-1 text-[11px] text-white/50">
                  {u.muted ? "MUTED " : ""}{u.webRestricted ? "RESTRICTED" : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => void act("/api/admin/users/moderate", { wallet: w, action: u.muted ? "unmute" : "mute" })} className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15">
                    {u.muted ? "Unmute" : "Mute"}
                  </button>
                  <button type="button" onClick={() => void act("/api/admin/users/moderate", { wallet: w, action: u.webRestricted ? "unrestrict" : "restrict" })} className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15">
                    {u.webRestricted ? "Unrestrict" : "Restrict"}
                  </button>
                  {canWebAdmin && (
                    <>
                      <label className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white">
                        Rank:
                        <select
                          aria-label={`Rank override for ${shortWallet(w)}`}
                          value={override ?? "AUTO"}
                          onChange={(e) => void act("/api/admin/users/profile", { wallet: w, rankOverride: e.target.value })}
                          className="rounded-lg bg-transparent text-[11px] font-bold text-white outline-none [&>option]:text-black"
                        >
                          {(["AUTO", "ROOKIE", "PLAYER", "VETERAN", "LEGEND"] as const).map((r) => (
                            <option key={r} value={r}>
                              {r === "AUTO" ? "Auto" : r === "ROOKIE" ? "Rookie" : r === "PLAYER" ? "Player" : r === "VETERAN" ? "Veteran" : "Legend"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" onClick={() => void act("/api/admin/users/profile", { wallet: w, clearAvatar: true })} className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15">
                        Clear avatar
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-white/40">Web mute/restrict affects this website only — it cannot block direct on-chain program calls.</p>
      </Section>
    </div>
  );
}

export function MatchesTab({ onRetryAutoSettlement }: { onRetryAutoSettlement: (matchId: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [sig, setSig] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { ok, body } = await api(`/api/admin/matches?query=${encodeURIComponent(q)}&limit=25`);
    if (ok) setRows(((body as { matches?: Array<Record<string, unknown>> })?.matches ?? []));
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const reindex = async () => {
    setNote(null);
    const { ok, body } = await api("/api/admin/matches/reindex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: sig.trim() }),
    });
    setNote(ok ? `Indexed: ${JSON.stringify((body as { matches?: unknown })?.matches)}` : ((body as { error?: string })?.error ?? "Reindex failed."));
    if (ok) void load();
  };

  const reconcile = async () => {
    setNote(null);
    const { ok, body } = await api("/api/settlement/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lookback: 50, limit: 10 }),
    });
    if (!ok) {
      setNote((body as { error?: string })?.error ?? "Reconcile failed.");
    } else {
      // HT-FINAL-005: report bookkeeping transitions separately from fresh
      // submissions so operators see e.g. "10 existing jobs transitioned to
      // settled while 0 new settlement transactions submitted".
      const b = body as {
        checked?: number;
        jobsTransitionedToSettled?: number;
        settlementsSubmitted?: number;
        alreadySettled?: number;
        pending?: string[];
        errors?: string[];
      } | null;
      const transitioned = b?.jobsTransitionedToSettled ?? 0;
      const submitted = b?.settlementsSubmitted ?? 0;
      const already = b?.alreadySettled ?? 0;
      const pending = Array.isArray(b?.pending) ? (b?.pending as string[]).length : 0;
      setNote(
        `Reconciled: checked ${b?.checked ?? "?"} • ${transitioned} existing job(s) transitioned to settled • ${submitted} new settlement(s) submitted • ${already} already settled • ${pending} pending`
      );
    }
    if (ok) void load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Matches (read-only)">
        <p className="mb-2 text-[11px] leading-relaxed text-white/40">
          Settlement is automatic (server/sponsor submits permissionless settle_match; the program decides result/winner/pot).
          Admins never sign settlement and cannot edit outcomes. Statuses: Waiting for ORAO • Auto-settlement pending • Settled.
        </p>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="match id / wallet / signature" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white" />
          <button type="button" onClick={() => void load()} className="rounded-2xl bg-white px-4 text-[13px] font-bold text-black">Search</button>
        </div>
        <ul className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
          {rows.map((m) => {
            const id = String(m.onchain_match_id ?? "?");
            const s = String(m.transaction_signature ?? "");
            const url = solscanTxUrl(s, SOLANA_CLUSTER);
            return (
              <li key={`${id}-${s.slice(0, 8)}`} className="rounded-2xl border border-white/10 p-3 text-[12px]">
                <p className="font-bold text-white">Match #{id} • {String(m.result ?? "?")} • Settled • pot {(() => { try { return (BigInt(String(m.heads_amount ?? "0")) + BigInt(String(m.tails_amount ?? "0"))).toLocaleString("en-US"); } catch { return "?"; } })()}</p>
                <p className="mt-1 break-all text-white/50">H {shortWallet(String(m.heads_wallet ?? ""))} • T {shortWallet(String(m.tails_wallet ?? ""))} • W {shortWallet(String(m.winner_wallet ?? ""))}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15">Solscan ↗</a>}
                  <button type="button" onClick={() => onRetryAutoSettlement(id)} title="Server-only: ensures the auto-settlement job exists. No wallet signature." className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15">Retry Auto-Settlement</button>
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => void reconcile()} className="mt-3 rounded-2xl border border-white/15 px-4 py-2 text-[12px] font-bold text-white hover:bg-white/10">
          Run reconciliation (unresolved matches)
        </button>
      </Section>
      <Section title="Reindex settlement">
        <div className="flex gap-2">
          <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="settlement signature" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-white" />
          <button type="button" onClick={() => void reindex()} className="rounded-2xl bg-white px-4 text-[13px] font-bold text-black">Index</button>
        </div>
        {note && <p className="mt-2 text-[12px] text-white/70">{note}</p>}
      </Section>
    </div>
  );
}

export function RewardsTab() {
  const [data, setData] = useState<{ totalMatches?: number; totalPaidBaseUnits?: string; todayCount?: number; todayPaidBaseUnits?: string; recent?: Array<Record<string, unknown>> } | null>(null);
  useEffect(() => {
    void api("/api/admin/rewards").then(({ body }) => {
      if (body && typeof body === "object") setData(body as typeof data);
    });
  }, []);
  if (!data) return <p className="text-[13px] text-[var(--text-secondary)]">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Payout analytics">
        <p className="text-[13px] text-white">{data.totalMatches ?? 0} matches settled • {data.totalPaidBaseUnits ?? "0"} base units paid</p>
        <p className="mt-1 text-[13px] text-white/60">Today: {data.todayCount ?? 0} matches • {data.todayPaidBaseUnits ?? "0"} base units</p>
      </Section>
      <Section title="Recent payouts">
        <ul className="flex flex-col gap-1.5">
          {(data.recent ?? []).map((r) => {
            const s = String(r.transaction_signature ?? "");
            const url = solscanTxUrl(s, SOLANA_CLUSTER);
            return (
              <li key={`${r.onchain_match_id}-${s.slice(0, 8)}`} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-[12px]">
                <span className="font-bold text-white">#{String(r.onchain_match_id)} → {shortWallet(String(r.winner_wallet ?? ""))}</span>
                {url && <a href={url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--heads)] hover:underline">Solscan ↗</a>}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
