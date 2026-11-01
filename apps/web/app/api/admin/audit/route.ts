import { NextResponse } from "next/server";
import { adminDb, checkWebAdmin } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Off-chain audit log read (OWNER or Devnet FULL_ADMIN; newest first). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkWebAdmin(req);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 100) || 100, 1), 200);
  const { data, error } = await db
    .from("admin_audit_log")
    .select("id,admin_wallet,action,target,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ entries: data ?? [] });
}
