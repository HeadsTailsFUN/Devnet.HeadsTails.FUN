"use client";

import { useCallback, useEffect, useState } from "react";

type Row = { id: string; wallet: string; task_type: string; x_handle: string; x_profile_url: string; evidence_url: string | null;
  campaign_url: string | null; reviewState: string; created_at: string; review_note: string | null;
  challenge: { code: string; expires_at: string; status: string } | null;
  rewards: Array<{ points: number; status: string; created_at: string }>; history: Array<{ status: string; created_at: string; review_reason: string | null }>;
  reviews: Array<{ created_at: string; review_details: { reviewer: string; decision: string; reason: string } | null }> };
function evidenceHref(raw: string | null) {
  try { const url = new URL(raw ?? ""); return url.protocol === "https:" && ["x.com", "twitter.com"].includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function EarnVerificationQueue({ canReview }: { canReview: boolean }) {
  const [rows, setRows] = useState<Row[]>([]), [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState(false), [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch(`/api/admin/earn-verifications?${new URLSearchParams({ query, state: filter })}`, { cache: "no-store" });
      const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "Review queue unavailable"); setRows(b.rows); setActive(b.active); setNote(null);
    } catch (e) { setNote(e instanceof Error ? e.message : "Review queue unavailable"); }
  }, [query, filter]);
  useEffect(() => { void load(); }, [load]);
  const review = async (row: Row, decision: string) => {
    if (busy || !canReview || !active || reason.trim().length < 5) return;
    setBusy(row.id); setNote(null);
    try { const r = await fetch("/api/admin/earn-verifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId: row.id, decision, reason,
      ownershipConfirmed: row.task_type === "connect_x" && confirmed, evidenceConfirmed: row.task_type !== "connect_x" && confirmed }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "Review could not be saved"); await load(); setNote(`Review saved: ${b.status}`); setConfirmed(false);
    } catch (e) { setNote(e instanceof Error ? e.message : "Review could not be saved"); } finally { setBusy(null); }
  };
  return <section className="glass rounded-3xl p-4"><h3 className="font-display text-lg font-semibold">Social verification review queue</h3>
    <p className="mt-2 text-xs text-white/50">Existing claims and rewards are preserved. Review ownership and actual campaign evidence; a submitted URL is not proof. Showing up to 100 recent claims.</p>
    <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Search verification requests" value={query} onChange={e => setQuery(e.target.value)} placeholder="Wallet / X handle" className="min-w-0 flex-1 rounded-xl bg-black/20 p-3 text-sm" />
      <select aria-label="Verification review status" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl bg-black/20 p-3 text-sm">{["all", "pending", "approved", "rejected", "expired", "needs_review"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select><button type="button" onClick={() => void load()} className="earn-secondary">Refresh</button></div>
    <label className="mt-3 block text-xs text-white/60">Auditable review reason (required)<input aria-label="Verification review reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm" /></label>
    <label className="mt-3 flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked the bio code or evidence author and official campaign post</label>
    {!active && <p className="mt-3 text-xs text-amber-200">New manual verification is inactive. Existing historical records remain visible.</p>}
    {note && <p role="status" className="mt-3 text-xs text-amber-200">{note}</p>}
    <div className="mt-4 max-h-[680px] space-y-3 overflow-auto">{!rows.length && <p className="text-sm text-white/50">No requests in this view.</p>}{rows.map(row => <article key={row.id} className="rounded-2xl border border-white/10 p-4 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><strong>{row.task_type} · @{row.x_handle}</strong><span>{row.reviewState.replaceAll("_", " ")}</span></div>
      <p className="mt-2 break-all font-mono text-white/50">{row.wallet}</p><p className="mt-1 text-white/50">Submitted {new Date(row.created_at).toLocaleString()}</p>
      <div className="mt-3 flex flex-wrap gap-3">{[["Profile", row.x_profile_url], ["Evidence", row.evidence_url], ["Official post", row.campaign_url]].map(([label, value]) => { const href = evidenceHref(value); return href ? <a className="text-[var(--heads)] underline" target="_blank" rel="noopener noreferrer" href={href} key={label}>Open {label} ↗</a> : null; })}</div>
      {row.challenge && <div className="mt-3 rounded-xl bg-white/5 p-3"><p>Bio challenge: <code className="break-all text-[var(--heads)]">{row.challenge.code}</code></p><p className="mt-1">Expires {new Date(row.challenge.expires_at).toLocaleString()} · {row.challenge.status}</p></div>}
      <details className="mt-3 text-white/60"><summary>Verification history and reward issuance</summary><p className="mt-2">{row.review_note ?? "No prior review note"}</p>{row.history.map((h, i) => <p key={i}>{h.created_at} · {h.status} · {h.review_reason}</p>)}{row.reviews.map((r, i) => <p key={`review-${i}`}>{r.created_at} · {r.review_details?.decision} · {r.review_details?.reason} · {r.review_details?.reviewer}</p>)}{row.rewards.map((r, i) => <p key={i}>{r.points} Points · {r.status} · {r.created_at}</p>)}<p className="mt-2 text-amber-200/70">External identities cannot move between wallets to claim twice.</p></details>
      {canReview && <div className="mt-3 flex flex-wrap gap-2">{[["verified", "Approve"], ["rejected", "Reject"], ["needs_review", "Request resubmission"]].map(([decision, label]) => <button className="earn-secondary" type="button" key={decision} disabled={!!busy || !active || reason.trim().length < 5 || (decision === "verified" && !confirmed)} onClick={() => void review(row, decision)}>{label}</button>)}</div>}
    </article>)}</div>
  </section>;
}
