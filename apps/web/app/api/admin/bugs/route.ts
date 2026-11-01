import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, checkWebAdmin, sanitizeMetadata } from "@/lib/admin/auth";
import { validateBountyInput, validatePayoutInput, validateTriageInput } from "@/lib/bugs/adminValidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data: reports } = await db.from("bug_reports").select("*").order("created_at", { ascending: false }).limit(200);
  const rows = ((reports ?? []) as Array<{ id: string }>);
  const { data: bounties } = await db.from("bug_bounties").select("*").in("report_id", rows.map((r) => r.id));
  const bountyByReport = new Map<string, Record<string, unknown>>();
  for (const b of ((bounties ?? []) as Array<Record<string, unknown>>)) {
    bountyByReport.set(String(b.report_id), b);
  }
  const wallets = [...new Set(rows.map((r) => String((r as Record<string, unknown>).wallet)))];
  const names = new Map<string, string | null>();
  if (wallets.length > 0) {
    const { data: p } = await db.from("profiles").select("wallet,username").in("wallet", wallets);
    for (const r of ((p ?? []) as Array<{ wallet: string; username: string | null }>)) names.set(r.wallet, r.username);
  }
  const enriched = (reports as Array<Record<string, unknown>> | null ?? []).map((r) => ({
    ...r,
    username: names.get(String(r.wallet)) ?? null,
    bounty: bountyByReport.get(String(r.id)) ?? null,
  }));
  await audit(db, staff.wallet!, "bugs.view", null, sanitizeMetadata({}));
  return NextResponse.json({ reports: enriched });
}

export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action as string;
  const id = typeof b.id === "string" ? b.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Moderators may triage; bounty + payout are owner-only.
  if (action === "triage") {
    const checked = validateTriageInput(b);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const { error } = await db.from("bug_reports").update(checked.patch).eq("id", id);
    if (error) return NextResponse.json({ error: "could not update report" }, { status: 503 });
    await audit(db, staff.wallet!, "bugs.triage", id, sanitizeMetadata({ status: checked.patch.status }));
    return NextResponse.json({ status: "ok" });
  }

  if (action === "bounty" || action === "payout") {
    // Metadata-only (no token/SOL transfer, no payout signatures): OWNER or
    // Devnet FULL_ADMIN. Any future value-transfer step stays owner-only.
    const admin = await checkWebAdmin(req);
    if (!admin.ok) return NextResponse.json({ error: "owner or full-admin access required" }, { status: 403 });
    if (action === "payout") {
      const checked = validatePayoutInput(b);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      const { error } = await db
        .from("bug_bounties")
        .upsert({ report_id: id, ...checked.patch, approved_by: staff.wallet }, { onConflict: "report_id" });
      if (error) return NextResponse.json({ error: "could not record payout" }, { status: 503 });
      await audit(db, staff.wallet!, "bugs.payout", id, sanitizeMetadata({ reward_type: checked.patch.reward_type }));
      return NextResponse.json({ status: "ok" });
    }
    const checked = validateBountyInput(b);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const { error } = await db
      .from("bug_bounties")
      .upsert({ report_id: id, ...checked.patch, approved_by: staff.wallet }, { onConflict: "report_id" });
    if (error) return NextResponse.json({ error: "could not update bounty" }, { status: 503 });
    await audit(db, staff.wallet!, "bugs.bounty", id, sanitizeMetadata(checked.patch));
    return NextResponse.json({ status: "ok" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
