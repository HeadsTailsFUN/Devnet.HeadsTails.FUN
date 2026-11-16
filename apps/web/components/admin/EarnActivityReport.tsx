"use client";

import { useEffect, useState } from "react";
import { ACTIVITY_LABELS, ACTIVITY_STATES, activityLabel, type ActivityEvent, type ActivityPage, type ActivityReport, type ActivityUser } from "@/lib/earn/admin-report-config";

const field = "min-w-0 rounded-xl border border-white/10 bg-black/30 p-2 text-sm";
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
export function activityEvidenceHref(raw: string | undefined) {
  try { const url = new URL(raw ?? ""); return url.protocol === "https:" && ["x.com", "twitter.com"].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; }
}
function Pager({ page, total, pageSize, disabled, change, label }: { page: number; total: number; pageSize: number; disabled: boolean; change: (page: number) => void; label: string }) {
  return <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
    <span>{total.toLocaleString()} records · Page {page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
    <span className="flex gap-3"><button type="button" disabled={disabled || page <= 1} onClick={() => change(page - 1)}>Previous</button><button type="button" disabled={disabled || page * pageSize >= total} onClick={() => change(page + 1)}>Next</button></span>
  </nav>;
}
export function EarnActivityReport({ revision = 0, onReviewWallet }: { revision?: number; onReviewWallet: (wallet: string) => void }) {
  const [query, setQuery] = useState(""), [activity, setActivity] = useState("all"), [state, setState] = useState("all");
  const [sort, setSort] = useState("events"), [direction, setDirection] = useState("desc"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [filters, setFilters] = useState({ query: "", activity: "all", state: "all", sort: "events", direction: "desc", from: "", to: "" });
  const [page, setPage] = useState(1), [version, setVersion] = useState(0), [data, setData] = useState<ActivityReport | null>(null);
  const [selected, setSelected] = useState<ActivityUser | null>(null), [eventPage, setEventPage] = useState(1), [events, setEvents] = useState<ActivityPage<ActivityEvent> | null>(null);
  const [loading, setLoading] = useState(false), [eventLoading, setEventLoading] = useState(false), [error, setError] = useState<string | null>(null), [eventError, setEventError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null); setData(null);
    void fetch(`/api/admin/earn-activity?${new URLSearchParams({ ...filters, page: String(page) })}`, { cache: "no-store", signal: abort.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "Activity report unavailable"); return b as ActivityReport; })
      .then(b => { if (!abort.signal.aborted) setData(b); }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Activity report unavailable"); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [filters, page, revision, version]);
  useEffect(() => {
    setEvents(null); setEventError(null);
    if (!selected) return;
    const abort = new AbortController(); setEventLoading(true);
    void fetch(`/api/admin/earn-activity?${new URLSearchParams({ ...filters, mode: "events", wallet: selected.wallet, page: String(eventPage) })}`, { cache: "no-store", signal: abort.signal })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.message ?? "User history unavailable"); return b as ActivityPage<ActivityEvent>; })
      .then(b => { if (!abort.signal.aborted) setEvents(b); }).catch(e => { if (!abort.signal.aborted) setEventError(e instanceof Error ? e.message : "User history unavailable"); })
      .finally(() => { if (!abort.signal.aborted) setEventLoading(false); });
    return () => abort.abort();
  }, [selected, eventPage, filters, revision, version]);
  return <section aria-label="Earn Points activity report" className="glass rounded-3xl p-4">
    <h3 className="font-display text-lg font-semibold">Earn Points activity</h3>
    <p className="mt-2 text-xs text-white/50">All recorded season activity, including zero-Point capped games and failed verification attempts. One game includes its win bonus. Counts measure records, not token volume. Incomplete/unrecorded actions are not invented.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={e => { e.preventDefault(); setPage(1); setSelected(null); setFilters({ query, activity, state, sort, direction, from, to }); }}>
      <label className="text-xs text-white/60">User<input aria-label="Search activity users" value={query} maxLength={64} onChange={e => setQuery(e.target.value)} placeholder="Wallet / username / X handle" className={`${field} mt-1 w-full`} /></label>
      <label className="text-xs text-white/60">Activity<select aria-label="Activity type" value={activity} onChange={e => setActivity(e.target.value)} className={`${field} mt-1 w-full`}><option value="all">All activities</option>{Object.entries(ACTIVITY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="text-xs text-white/60">Status<select aria-label="Activity status" value={state} onChange={e => setState(e.target.value)} className={`${field} mt-1 w-full`}>{ACTIVITY_STATES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-xs text-white/60">Sort by<select aria-label="Sort activity users" value={sort} onChange={e => setSort(e.target.value)} className={`${field} mt-1 w-full`}><option value="events">Most activity</option><option value="verified">Verified activity</option><option value="pending">Pending activity</option><option value="points">Verified Points</option><option value="last_activity">Last activity</option></select></label>
      <label className="text-xs text-white/60">From (UTC)<input aria-label="Activity from date" type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${field} mt-1 w-full`} /></label>
      <label className="text-xs text-white/60">Through (UTC)<input aria-label="Activity through date" type="date" value={to} onChange={e => setTo(e.target.value)} className={`${field} mt-1 w-full`} /></label>
      <label className="text-xs text-white/60">Order<select aria-label="Activity sort order" value={direction} onChange={e => setDirection(e.target.value)} className={`${field} mt-1 w-full`}><option value="desc">Highest / newest first</option><option value="asc">Lowest / oldest first</option></select></label>
      <span className="flex items-end gap-3"><button type="submit" className="earn-primary">Apply filters</button><button type="button" className="earn-secondary" onClick={() => setVersion(v => v + 1)}>Refresh report</button></span>
    </form>
    {loading && <p role="status" className="mt-4 text-sm text-white/60">Loading activity…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-amber-200">{error} <button onClick={() => setVersion(v => v + 1)} className="underline">Retry report</button></p>}
    {data && <><div className="my-4 grid gap-2 sm:grid-cols-4">{[["Users", data.summary.users], ["Recorded activity", data.summary.events], ["Pending activity", data.summary.pending], ["Verified Points", data.summary.points]].map(([label, count]) => <div key={label} className="rounded-xl border border-white/10 p-3"><span className="block text-xs text-white/50">{label}</span><strong className="text-xl">{Number(count).toLocaleString()}</strong></div>)}</div>
      <div className="overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><caption className="mb-3 text-left text-white/50">{data.season} · filtered user activity</caption><thead><tr>{["User", "Activity", "Verified", "Pending", "Rejected / expired", "Verified Points", "Last activity", "Details"].map(h => <th key={h} scope="col" className="p-2 text-white/50">{h}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.wallet} className="border-t border-white/10"><td className="p-2"><strong>{row.username ?? "Unnamed"}</strong><span className="block max-w-[230px] break-all font-mono text-[10px] text-white/50">{row.wallet}</span>{row.xHandle && <span className="block">@{row.xHandle}</span>}{row.excluded && <span className="text-amber-200">Reward excluded</span>}</td><td className="p-2">{row.events}</td><td className="p-2">{row.verified}</td><td className="p-2">{row.pending}</td><td className="p-2">{row.rejected}</td><td className="p-2">{row.points}</td><td className="p-2">{stamp(row.lastActivity)}</td><td className="p-2"><button type="button" className="underline" onClick={() => { setSelected(row); setEventPage(1); }}>View activity for {row.username ?? row.wallet.slice(0, 6)}</button></td></tr>)}</tbody></table></div>
      {!data.rows.length && <p className="mt-4 text-sm text-white/50">No users match these filters.</p>}
      <Pager label="Activity users pages" page={page} total={data.total} pageSize={data.pageSize} disabled={loading} change={setPage} />
    </>}
    {selected && <section aria-label="Selected user activity" className="mt-5 rounded-2xl border border-[var(--heads)]/20 p-4">
      <div className="flex flex-wrap justify-between gap-3"><h4 className="font-semibold">{selected.username ?? "User"} · full activity history</h4><button type="button" onClick={() => setSelected(null)}>Close user activity</button></div>
      <p className="my-2 break-all font-mono text-xs text-white/50">{selected.wallet}</p>
      <button type="button" className="earn-secondary" onClick={() => onReviewWallet(selected.wallet)}>Review this user’s X requests</button>
      <div className="my-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">{Object.entries(ACTIVITY_LABELS).map(([key, label]) => <div key={key} className="rounded-xl bg-white/5 p-2 text-xs"><span className="text-white/50">{label}</span><strong className="ml-2">{events?.activities?.[key]?.events ?? selected.activities[key]?.events ?? 0}</strong></div>)}</div>
      {eventLoading && <p role="status">Loading user history…</p>}{eventError && <p role="alert">{eventError}</p>}
      <div className="max-h-[650px] space-y-2 overflow-auto">{events?.rows.map(event => <article key={event.id} className="rounded-xl border border-white/10 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{activityLabel(event.activity)}</strong><span>{event.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-white/50">{stamp(event.occurred_at)} · {event.source_type.replaceAll("_", " ")} · {event.verified_points} verified Points / {event.points} recorded</p><p className="mt-1 break-all font-mono text-white/40">Reference: {event.source_key}</p>{event.details.reason && <p className="mt-2">Reason: {event.details.reason}</p>}{event.details.checkStatus && <p>Membership check: {event.details.checkStatus}</p>}<div className="mt-2 flex gap-4">{[["X profile", event.details.profileUrl], ["Evidence", event.details.evidenceUrl], ["Campaign", event.details.campaignUrl]].map(([label, raw]) => { const href = activityEvidenceHref(raw); return href ? <a key={label} className="underline" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null; })}</div></article>)}</div>
      {events && <>{!events.rows.length && <p>No recorded activity in this view.</p>}<Pager label="User history pages" page={eventPage} total={events.total} pageSize={events.pageSize} disabled={eventLoading} change={setEventPage} /></>}
    </section>}
  </section>;
}
