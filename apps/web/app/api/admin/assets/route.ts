import { NextResponse } from "next/server";
import { adminDb, audit, checkWebAdmin, sanitizeMetadata } from "@/lib/admin/auth";
import { validateAvatar } from "@/lib/profiles/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/** Site-asset upload, purely application/storage state (OWNER or Devnet FULL_ADMIN; validated images → site-assets bucket). */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkWebAdmin(req);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "malformed upload" }, { status: 400 });
  }
  const file = form.get("asset");
  const name = form.get("name");
  if (!(file instanceof File) || typeof name !== "string") {
    return NextResponse.json({ error: "asset file and name required" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) {
    return NextResponse.json({ error: "invalid asset name" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "asset must be 1 byte – 5 MB" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateAvatar(bytes, (file.type || "").toLowerCase(), MAX_BYTES);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }
  const objectPath = `${name}-v${Date.now()}.${checked.ext}`;
  const { error } = await db.storage.from("site-assets").upload(objectPath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return NextResponse.json({ error: "upload failed" }, { status: 502 });
  const { data } = db.storage.from("site-assets").getPublicUrl(objectPath);
  await audit(db, staff.wallet as string, "assets.upload", name, sanitizeMetadata({}));
  return NextResponse.json({ status: "ok", url: data?.publicUrl ?? null, path: objectPath });
}
