"use client";

import { useCallback, useEffect, useState } from "react";
import { shortWallet } from "@/lib/leaderboard";
import { BUG_SEVERITIES } from "@/lib/bugs/validate";

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  try {
    const r = await fetch(path, init);
    return { ok: r.ok, body: await r.json().catch(() => null) };
  } catch {
    return { ok: false, body: null };
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

export function ReferralsTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    void api("/api/admin/referrals").then(({ body }) => {
      const b = body as { rows?: Array<Record<string, unknown>>; summary?: Record<string, number> } | null;
      if (b) {
        setRows(b.rows ?? []);
        setSummary(b.summary ?? null);
      }
    });
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Summary">
        {!summary ? (
          <p className="text-[13px] text-white/50">Loading…</p>
        ) : (
          <p className="text-[13px] text-white">
            {summary.totalLinks ?? 0} links • {summary.attributed ?? 0} attributed • {summary.qualified ?? 0} qualified
          </p>
        )}
      </Section>
      <Section title={`Referrals (${rows.length})`}>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="text-white/50">
                <th className="py-1 pr-2">Referrer</th>
                <th className="py-1 pr-2">Code</th>
                <th className="py-1 pr-2">Invitee</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Games</th>
                <th className="py-1 pr-2">Points</th>
                <th className="py-1 pr-2">Attributed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-white/10 text-white/80">
                  <td className="py-1 pr-2 font-mono">{shortWallet(String(r.referrer_wallet ?? ""))}</td>
                  <td className="py-1 pr-2">{String(r.referrer_code ?? "")}</td>
                  <td className="py-1 pr-2 font-mono">{shortWallet(String(r.invitee_wallet ?? ""))}</td>
                  <td className="py-1 pr-2">{String(r.status ?? "")}</td>
                  <td className="py-1 pr-2">{String(r.invitee_games ?? 0)}</td>
                  <td className="py-1 pr-2">{String(r.referral_points ?? 0)}</td>
                  <td className="py-1 pr-2">{String(r.attributed_at ?? "").slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

type AirdropUser = Record<string, unknown> & {
  wallet?: string;
  username?: string | null;
  xHandle?: string | null;
  xProfileUrl?: string | null;
  verifiedTotal?: number;
  pendingTotal?: number;
  gameplayPoints?: number;
  winBonusPoints?: number;
  communityTeamPoints?: number;
  referralPoints?: number;
  socialPoints?: number;
  eligibleGames?: number;
  wins?: number;
  qualifiedReferrals?: number;
  taskStatuses?: Record<string, string>;
  lastPointsEvent?: string;
  season?: string;
  excluded?: boolean;
  exclusionReason?: string | null;
  claims?: Array<Record<string, unknown>>;
};

export function AirdropTab({ canWebAdmin }: { canWebAdmin: boolean }) {
  const [users, setUsers] = useState<AirdropUser[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "excluded" | "eligible">("all");
  const [note, setNote] = useState<string | null>(null);
  const [adjWallet, setAdjWallet] = useState("");
  const [adjPoints, setAdjPoints] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [exReason, setExReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const search = useCallback(async () => {
    const params = new URLSearchParams({ query: q });
    if (filter === "pending") params.set("pending", "1");
    if (filter === "excluded") params.set("excluded", "1");
    if (filter === "eligible") params.set("eligible", "1");
    const { ok, body } = await api(`/api/admin/airdrop?${params.toString()}`);
    if (ok) setUsers(((body as { users?: AirdropUser })?.users as unknown as AirdropUser[]) ?? []);
    else setNote("Search failed.");
  }, [q, filter]);
  useEffect(() => {
    void search();
  }, [search]);
  const mutate = async (payload: Record<string, unknown>, okMsg: string) => {
    setNote(null);
    const { ok, body } = await api("/api/admin/airdrop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const err = (body as { error?: string } | null)?.error;
    setNote(ok ? okMsg : `Failed: ${err ?? "request failed"}`);
    void search();
  };
  const review = (id: string, decision: "verified" | "rejected") =>
    void mutate({ action: "review-claim", id, decision, note: reviewNote || undefined }, `Claim ${decision}.`);
  const revoke = (id: string) => {
    if (!reviewNote.trim()) {
      setNote("A review note is required to revoke a verified claim.");
      return;
    }
    void mutate({ action: "review-claim", id, decision: "rejected", note: reviewNote.trim() }, "Claim revoked.");
  };
  const exclude = (wallet: string) => {
    if (!exReason.trim()) {
      setNote("Exclusion reason required.");
      return;
    }
    void mutate({ action: "exclude", wallet, reason: exReason.trim() }, "Excluded from rewards.");
  };
  const restore = (wallet: string) => void mutate({ action: "restore", wallet }, "Eligibility restored.");
  const adjust = () => {
    const points = Number(adjPoints);
    if (!adjWallet.trim() || !Number.isInteger(points) || points === 0) {
      setNote("Adjustment needs a wallet and non-zero integer points.");
      return;
    }
    if (!adjReason.trim()) {
      setNote("Adjustment reason required.");
      return;
    }
    void mutate(
      { action: "adjust", wallet: adjWallet.trim(), points, reason: adjReason.trim() },
      "Adjustment recorded."
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <Section title="Users">
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search wallet / username / X handle"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
            aria-label="Filter users"
          >
            <option value="all">All</option>
            <option value="pending">Pending social</option>
            <option value="excluded">Excluded</option>
            <option value="eligible">Eligible</option>
          </select>
          <button type="button" onClick={() => void search()} className="rounded-2xl bg-white px-4 py-2 text-[12px] font-bold text-black">
            Search
          </button>
        </div>
        {note && <p role="status" className="mt-2 text-[12px] text-white/70">{note}</p>}
        <input
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="Review note (required to revoke)"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
        />
        <div className="mt-2 max-h-[480px] overflow-auto">
          <table className="w-full min-w-[1080px] text-left text-[12px]">
            <thead>
              <tr className="text-white/50">
                <th className="py-1 pr-2">Wallet</th>
                <th className="py-1 pr-2">User / X</th>
                <th className="py-1 pr-2">Verified</th>
                <th className="py-1 pr-2">Pending</th>
                <th className="py-1 pr-2">Gameplay</th>
                <th className="py-1 pr-2">Win Bonus</th>
                <th className="py-1 pr-2">Referral</th>
                <th className="py-1 pr-2">Social</th>
                <th className="py-1 pr-2">Community team</th>
                <th className="py-1 pr-2">Games</th>
                <th className="py-1 pr-2">Wins</th>
                <th className="py-1 pr-2">Qualified Refs</th>
                <th className="py-1 pr-2">Eligibility</th>
                <th className="py-1 pr-2">Claims</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={i} className="border-t border-white/10 text-white/80">
                  <td className="py-1 pr-2 font-mono">{shortWallet(String(u.wallet ?? ""))}</td>
                  <td className="py-1 pr-2">
                    <span>{String(u.username ?? "—")}</span>
                    {u.xProfileUrl ? (
                      <a href={String(u.xProfileUrl)} target="_blank" rel="noopener noreferrer" className="ml-1 underline">
                        @{String(u.xHandle ?? "")}
                      </a>
                    ) : (
                      <span className="ml-1 text-white/40">{u.xHandle ? `@${String(u.xHandle)}` : ""}</span>
                    )}
                  </td>
                  <td className="py-1 pr-2">{String(u.verifiedTotal ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.pendingTotal ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.gameplayPoints ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.winBonusPoints ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.referralPoints ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.socialPoints ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.communityTeamPoints ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.eligibleGames ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.wins ?? 0)}</td>
                  <td className="py-1 pr-2">{String(u.qualifiedReferrals ?? 0)}</td>
                  <td className="py-1 pr-2">
                    {u.excluded ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/40 px-2 py-0.5 text-red-200">
                        Excluded
                        {canWebAdmin && (
                          <button type="button" onClick={() => restore(String(u.wallet))} className="font-bold underline">
                            Restore
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 px-2 py-0.5 text-emerald-200">
                        Eligible
                        {canWebAdmin && (
                          <button type="button" onClick={() => exclude(String(u.wallet))} className="font-bold underline">
                            Exclude
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {(u.claims ?? []).map((c) => (
                      <span key={String(c.id)} className="mr-1 inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5">
                        {String(c.task_type)}:{String(c.status)}
                        {String(c.status) === "pending" && (
                          <>
                            <button type="button" onClick={() => review(String(c.id), "verified")} className="font-bold text-emerald-300">✓</button>
                            <button type="button" onClick={() => review(String(c.id), "rejected")} className="font-bold text-red-300">✕</button>
                          </>
                        )}
                        {String(c.status) === "verified" && (
                          <button type="button" onClick={() => revoke(String(c.id))} className="font-bold text-amber-300" title="Revoke verification (points removed, history kept)">
                            Revoke
                          </button>
                        )}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canWebAdmin && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-[12px] font-bold text-white">Exclude from rewards (owner / full admin)</p>
            <input
              value={exReason}
              onChange={(e) => setExReason(e.target.value)}
              placeholder="Reason (required)"
              className="mt-1 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
            />
            <p className="mt-1 text-[11px] text-white/40">Pick Exclude on a row above. Gameplay stays unaffected; rewards stop flowing to and from the wallet.</p>
          </div>
        )}
      </Section>
      {canWebAdmin && (
        <Section title="Manual adjustment (owner / full admin)">
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={adjWallet}
              onChange={(e) => setAdjWallet(e.target.value)}
              placeholder="Wallet"
              className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
            />
            <input
              value={adjPoints}
              onChange={(e) => setAdjPoints(e.target.value)}
              placeholder="Points (+/- integer)"
              inputMode="numeric"
              className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
            />
            <input
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Reason (required)"
              className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white"
            />
          </div>
          <button type="button" onClick={adjust} className="mt-2 rounded-2xl bg-white px-4 py-2 text-[12px] font-bold text-black">
            Record adjustment
          </button>
        </Section>
      )}
    </div>
  );
}

export function BugReportsTab({ canWebAdmin }: { canWebAdmin: boolean }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { severity: string; note: string; rewardType: string; amount: string; mint: string; sig: string; bountyStatus: string }>>({});
  const load = useCallback(async () => {
    const { ok, body } = await api("/api/admin/bugs");
    if (ok) setRows(((body as { reports?: Array<Record<string, unknown>> })?.reports ?? []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const formFor = (r: Record<string, unknown>) => {
    const id = String(r.id);
    const bounty = (r.bounty ?? {}) as Record<string, unknown>;
    return (
      forms[id] ?? {
        severity: String(r.admin_severity ?? ""),
        note: String(r.admin_notes ?? ""),
        rewardType: String(bounty.reward_type ?? "none"),
        amount: String(bounty.reward_amount_base_units ?? ""),
        mint: String(bounty.reward_mint ?? ""),
        sig: String(bounty.payout_signature ?? ""),
        bountyStatus: String(bounty.status ?? "none"),
      }
    );
  };
  const setForm = (id: string, patch: Partial<ReturnType<typeof formFor>>) => {
    const current = forms[id] ?? { severity: "", note: "", rewardType: "none", amount: "", mint: "", sig: "", bountyStatus: "none" };
    setForms({ ...forms, [id]: { ...current, ...patch } });
  };
  const post = async (payload: Record<string, unknown>, okMsg: string) => {
    const { ok, body } = await api("/api/admin/bugs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const err = (body as { error?: string } | null)?.error;
    setNote(ok ? okMsg : `Failed: ${err ?? "request failed"}`);
    void load();
  };
  const triage = (id: string, status: string) => void post({ action: "triage", id, status }, `Status -> ${status}.`);
  const saveTriage = (r: Record<string, unknown>) => {
    const f = formFor(r);
    void post(
      { action: "triage", id: String(r.id), admin_severity: f.severity || undefined, note: f.note },
      "Triage saved."
    );
  };
  const saveBounty = (r: Record<string, unknown>) => {
    const f = formFor(r);
    void post(
      {
        action: "bounty",
        id: String(r.id),
        reward_type: f.rewardType,
        bounty_status: f.bountyStatus,
      },
      "Bounty saved."
    );
  };
  const markPaid = (r: Record<string, unknown>) => {
    const f = formFor(r);
    void post(
      {
        action: "payout",
        id: String(r.id),
        reward_type: f.rewardType,
        reward_amount_base_units: f.amount.trim(),
        reward_mint: f.mint.trim() || undefined,
        payout_signature: f.sig.trim(),
      },
      "Marked paid."
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <Section title={`Bug Reports (${rows.length})`}>
        {!canWebAdmin && <p className="mb-2 text-[11px] text-white/40">Moderators: triage only. Bounty approval and payout recording need Owner or Full admin.</p>}
        {note && <p role="status" className="mb-2 text-[12px] text-white/70">{note}</p>}
        <div className="flex max-h-[640px] flex-col gap-2 overflow-auto">
          {rows.map((r) => {
            const f = formFor(r);
            const id = String(r.id);
            return (
              <div key={id} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-[12px] text-white/80">
                <p className="font-bold text-white">{String(r.description ?? "").slice(0, 300)}</p>
                <p className="mt-1 text-white/60">Steps: {String(r.steps_to_reproduce ?? "—").slice(0, 300)}</p>
                <p className="mt-1">
                  {shortWallet(String(r.wallet ?? ""))} • {String(r.username ?? "")} • {String(r.telegram_handle ?? "")} • {String(r.page_path ?? "")}
                </p>
                <p className="mt-1">
                  Reported: <b>{String(r.reported_severity)}</b> • Status: <b>{String(r.status)}</b> • Bounty:{" "}
                  <b>{String(((r.bounty ?? {}) as Record<string, unknown>).status ?? "none")}</b>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["triaged", "needs_info", "accepted", "resolved", "rejected", "duplicate", "rewarded"].map((s) => (
                    <button key={s} type="button" onClick={() => triage(id, s)} className="rounded-xl border border-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/10">
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-white/60">Admin severity</span>
                    <select
                      value={f.severity}
                      onChange={(e) => setForm(id, { severity: e.target.value })}
                      className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                    >
                      <option value="">—</option>
                      {BUG_SEVERITIES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-white/60">Private admin note</span>
                    <input
                      value={f.note}
                      onChange={(e) => setForm(id, { note: e.target.value })}
                      placeholder="Private note…"
                      className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                    />
                  </label>
                </div>
                <button type="button" onClick={() => saveTriage(r)} className="mt-2 rounded-xl border border-white/15 px-3 py-1.5 text-[11px] font-bold hover:bg-white/10">
                  Save triage
                </button>
                {canWebAdmin && (
                  <div className="mt-3 rounded-2xl border border-emerald-300/20 p-2">
                    <p className="text-[11px] font-bold text-emerald-200">Bounty (owner / full admin)</p>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-white/60">Reward type</span>
                        <select
                          value={f.rewardType}
                          onChange={(e) => setForm(id, { rewardType: e.target.value })}
                          className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                        >
                          <option value="none">none</option>
                          <option value="project_token">project_token</option>
                          <option value="sol">sol</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-white/60">Bounty status</span>
                        <select
                          value={f.bountyStatus}
                          onChange={(e) => setForm(id, { bountyStatus: e.target.value })}
                          className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                        >
                          <option value="none">none</option>
                          <option value="approved">approved</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-white/60">Amount (base units, positive integer)</span>
                        <input
                          value={f.amount}
                          onChange={(e) => setForm(id, { amount: e.target.value })}
                          placeholder="e.g. 5000000"
                          inputMode="numeric"
                          className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-white/60">Reward mint (project_token only)</span>
                        <input
                          value={f.mint}
                          onChange={(e) => setForm(id, { mint: e.target.value })}
                          placeholder="mint address"
                          className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                        />
                      </label>
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className="text-[11px] text-white/60">Payout signature (required to mark paid)</span>
                        <input
                          value={f.sig}
                          onChange={(e) => setForm(id, { sig: e.target.value })}
                          placeholder="tx signature"
                          className="rounded-xl border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-white"
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => saveBounty(r)} className="rounded-xl border border-emerald-300/40 px-3 py-1.5 text-[11px] font-bold text-emerald-200">
                        Save bounty
                      </button>
                      <button type="button" onClick={() => markPaid(r)} className="rounded-xl border border-emerald-300/40 px-3 py-1.5 text-[11px] font-bold text-emerald-200">
                        Mark paid
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
