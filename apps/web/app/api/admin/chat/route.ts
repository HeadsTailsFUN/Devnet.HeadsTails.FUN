import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff live chat view (includes soft-deleted for moderation context). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data, error } = await db
    .from("chat_messages")
    .select("id,wallet,body,created_at,deleted_at,deleted_by")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ messages: (data ?? []).reverse() });
}

/** Staff message delete/hide (soft delete + audit). */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = body as { id?: unknown; restore?: unknown } | null;
  if (typeof b?.id !== "string" || b.id.length < 8) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const patch =
    b.restore === true
      ? { deleted_at: null, deleted_by: null }
      : { deleted_at: new Date().toISOString(), deleted_by: staff.wallet };
  const { error } = await db.from("chat_messages").update(patch).eq("id", b.id);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await audit(
    db,
    staff.wallet as string,
    b.restore === true ? "chat.restore" : "chat.delete",
    b.id,
    sanitizeMetadata({})
  );
  return NextResponse.json({ status: "ok" });
}
