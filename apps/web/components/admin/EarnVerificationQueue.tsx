"use client";

import { useEffect, useRef, useState } from "react";
import { activityLabel } from "@/lib/earn/admin-report-config";
import { activityEvidenceHref } from "./EarnActivityReport";

type Row = { id: string; wallet: string; username?: string | null; task_type: string; x_handle: string; x_profile_url: string; evidence_url: string | null;
  campaign_url: string | null; reviewState: string; created_at: string; review_note: string | null;
  challenge: { code: string; expires_at: string; status: string } | null;
  rewards: Array<{ points: number; status: string; created_at: string }>; history: Array<{ status: string; created_at: string; review_reason: string | null }>;
  reviews: Array<{ created_at: string; review_details: { reviewer: string; decision: string; reason: string } | null }> };
export function EarnVerificationQueue({ canReview, walletFilter = "", onChanged }: { canReview: boolean; walletFilter?: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]), [query, setQuery] = useState(""), [filter, setFilter] = useState("all"), [task, setTask] = useState("all"), [direction, setDirection] = useState("desc");
  const [applied, setApplied] = useState({ query: "", state: "all", task: "all", direction: "desc" }), [page, setPage] = useState(1), [total, setTotal] = useState(0), [pageSize, setPageSize] = useState(25), [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [note, setNote] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [submissions, setSubmissions] = useState(false);
  const inFlight = useRef(false);
  const resetReview = () => { setSelected(null); setReason(""); setConfirmed(false); };
  useEffect(() => {
    setQuery(walletFilter); setPage(1); setFilter("all"); setTask("all"); setApplied({ query: walletFilter, state: "all", task: "all", direction: "desc" });
    setSelected(null); setReason(""); setConfirmed(false);
  }, [walletFilter]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null); setRows([]);
    void fetch(`/api/admin/earn-verifications?${new URLSearchParams({ ...applied, page: String(page) })}`, { cache: "no-store", signal: abort.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "Review queue unavailable"); return b; })
      .then(b => { if (!abort.signal.aborted) { setRows(b.rows ?? []); setTotal(b.total ?? b.rows?.length ?? 0); setPageSize(b.pageSize ?? 25); setSubmissions(b.newSubmissionsActive === true); } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Review queue unavailable"); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [applied, page, version]);
  const review = async (row: Row, decision: string) => {
    if (inFlight.current || !canReview || selected !== row.id || reason.trim().length < 5 || (decision === "verified" && !confirmed)) return;
    inFlight.current = true; setBusy(row.id); setNote(null);
    try {
      const r = await fetch("/api/admin/earn-verifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: row.id, decision, reason: reason.trim(),
        ownershipConfirmed: row.task_type === "connect_x" && confirmed, evidenceConfirmed: row.task_type !== "connect_x" && confirmed }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "Review could not be saved");
      resetReview(); setVersion(v => v + 1); onChanged?.(); setNote(`Review saved: ${b.status}`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Review could not be saved"); }
    finally { inFlight.current = false; setBusy(null); }
  };
  return <section id="social-verification-review" aria-label="Social verification review queue" className="glass scroll-mt-6 rounded-3xl p-4">
    <h3 className="font-display text-lg font-semibold">Social verification review queue</h3>
    <p className="mt-2 text-xs text-white/50">Search all requests by user and activity. Review actual ownership or campaign evidence. Decisions update the existing reward atomically and keep its history.</p>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); resetReview(); setPage(1); setApplied({ query, state: filter, task, direction }); }}>
      <input aria-label="Search verification requests" value={query} maxLength={64} onChange={e => setQuery(e.target.value)} placeholder="Wallet / username / X handle" className="min-w-0 flex-1 rounded-xl bg-black/20 p-3 text-sm" />
      <select aria-label="Verification review status" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl bg-black/20 p-3 text-sm">{["all", "pending", "approved", "rejected", "expired", "needs_review"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
      <select aria-label="Verification activity" value={task} onChange={e => setTask(e.target.value)} className="rounded-xl bg-black/20 p-3 text-sm">{["all", "connect_x", "repost", "reply"].map(s => <option key={s} value={s}>{s === "all" ? "All X activities" : activityLabel(s)}</option>)}</select>
      <select aria-label="Verification order" value={direction} onChange={e => setDirection(e.target.value)} className="rounded-xl bg-black/20 p-3 text-sm"><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
      <button type="submit" className="earn-secondary" disabled={!!busy}>Apply review filters</button><button type="button" disabled={!!busy} onClick={() => { resetReview(); setVersion(v => v + 1); }} className="earn-secondary">Refresh queue</button>
    </form>
    {!submissions && <p className="mt-3 text-xs text-white/50">New bio-challenge submissions are paused. Existing requests can still be reviewed by the owner or full admin.</p>}
    {loading && <p role="status" className="mt-3 text-xs">Loading requests…</p>}{error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}{note && <p role="status" className="mt-3 text-xs text-amber-200">{note}</p>}
    <div className="mt-4 max-h-[780px] space-y-3 overflow-auto">{!loading && !error && !rows.length && <p className="text-sm text-white/50">No requests in this view.</p>}{rows.map(row => <article key={row.id} className="rounded-2xl border border-white/10 p-4 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><strong>{activityLabel(row.task_type)} · @{row.x_handle}</strong><span>{row.reviewState.replaceAll("_", " ")}</span></div>
      {row.username && <p className="mt-2 font-semibold">{row.username}</p>}<p className="mt-2 break-all font-mono text-white/50">{row.wallet}</p><p className="mt-1 text-white/50">Submitted {new Date(row.created_at).toLocaleString()}</p>
      <div className="mt-3 flex flex-wrap gap-3">{[["Profile", row.x_profile_url], ["Evidence", row.evidence_url], ["Official post", row.campaign_url]].map(([label, value]) => { const href = activityEvidenceHref(value ?? undefined); return href ? <a className="underline" key={label} href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null; })}</div>
      {row.challenge ? <p className="mt-2">Bio code: <code className="break-all text-[var(--heads)]">{row.challenge.code}</code> · expires {new Date(row.challenge.expires_at).toLocaleString()}</p> : <p className="mt-2 text-white/40">Legacy claim: review the original profile and evidence. No bio challenge was recorded.</p>}
      <p className="mt-2">{row.rewards.map((r, i) => <span key={i} className="mr-3">{r.status}: {r.points} Points</span>)}</p>{row.review_note && <p className="mt-2">Latest decision: {row.review_note}</p>}
      <details className="mt-2 text-white/50"><summary>Review history ({row.reviews.length}) · ownership attempts ({row.history.length})</summary>{row.history.map((h, i) => <p key={`h${i}`}>{new Date(h.created_at).toLocaleString()} · {h.status} · {h.review_reason}</p>)}{row.reviews.map((a, i) => <p key={`a${i}`} className="mt-2 break-all">{new Date(a.created_at).toLocaleString()} · {a.review_details?.decision} · {a.review_details?.reason} · reviewer {a.review_details?.reviewer}</p>)}</details>
      {canReview && <button type="button" disabled={!!busy} className="earn-secondary mt-3" onClick={() => { setSelected(row.id); setReason(""); setConfirmed(false); }}>Review {activityLabel(row.task_type)} for @{row.x_handle}</button>}
      {canReview && selected === row.id && <fieldset className="mt-3 rounded-xl bg-white/5 p-3"><legend className="text-white/60">Decision for @{row.x_handle}</legend>
        <label className="block text-xs text-white/60">Auditable review reason (required)<textarea aria-label="Verification review reason" value={reason} maxLength={500} disabled={!!busy} onChange={e => setReason(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm" /></label>
        <label className="mt-3 flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={e => setConfirmed(e.target.checked)} />I checked this account’s bio code or evidence author and official campaign post</label>
        <div className="mt-3 flex flex-wrap gap-3">{[["Approve", "verified"], ["Reject / revoke", "rejected"], ["Needs review", "needs_review"]].map(([label, decision]) => <button type="button" key={decision} className="earn-secondary" disabled={!!busy || loading || reason.trim().length < 5 || (decision === "verified" && (!confirmed || row.reviewState === "expired"))} onClick={() => void review(row, decision)}>{busy === row.id ? "Saving…" : label}</button>)}</div>
      </fieldset>}
    </article>)}</div>
    <nav aria-label="Verification request pages" className="mt-3 flex flex-wrap justify-between gap-3 text-xs text-white/50"><span>{total} requests · Page {page} / {Math.max(1, Math.ceil(total / pageSize))}</span><span className="flex gap-4"><button type="button" disabled={loading || !!busy || page <= 1} onClick={() => { resetReview(); setPage(p => p - 1); }}>Previous</button><button type="button" disabled={loading || !!busy || page * pageSize >= total} onClick={() => { resetReview(); setPage(p => p + 1); }}>Next</button></span></nav>
  </section>;
}
