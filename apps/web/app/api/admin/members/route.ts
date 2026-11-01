import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner moderator management (add/remove). Owner is always the on-chain authority. */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, true);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = body as { wallet?: unknown; action?: unknown } | null;
  if (!isValidWallet(b?.wallet) || (b?.action !== "add" && b?.action !== "remove")) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const target = b!.wallet as string;
  if (b!.action === "add") {
    const { error } = await db.from("admin_members").upsert(
      { wallet: target, role: "MODERATOR", added_by: staff.wallet },
      { onConflict: "wallet" }
    );
    if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  } else {
    await db.from("admin_members").delete().eq("wallet", target);
  }
  await audit(db, staff.wallet as string, `members.${b!.action}`, target, sanitizeMetadata({}));
  return NextResponse.json({ status: "ok" });
}
