import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, checkWebAdmin, sanitizeMetadata } from "@/lib/admin/auth";
import { validateSetting } from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner settings read (all keys). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data } = await db.from("site_settings").select("key,value,updated_at");
  return NextResponse.json({ settings: data ?? [] });
}

/** Off-chain settings write (OWNER or Devnet FULL_ADMIN; controlled allowlist; HTML/JS rejected). */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkWebAdmin(req);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = body as { key?: unknown; value?: unknown } | null;
  const checked = validateSetting(b?.key, b?.value);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const stored =
    checked.kind === "bool"
      ? { enabled: checked.value }
      : checked.kind === "image"
        ? { url: checked.value }
        : { text: checked.value };
  const { error } = await db.from("site_settings").upsert(
    { key: b!.key as string, value: stored, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await audit(
    db,
    staff.wallet as string,
    "settings.update",
    b!.key as string,
    sanitizeMetadata({ key: b!.key as string })
  );
  return NextResponse.json({ status: "ok" });
}
