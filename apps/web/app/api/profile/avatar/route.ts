import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth/session";
import { AVATAR_MAX_BYTES, validateAvatar } from "@/lib/profiles/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated avatar upload (validated JPEG/PNG/WEBP, max 2MB). */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "malformed upload" }, { status: 400 });
  }
  const file = form.get("avatar");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing avatar file" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: "avatar must be 1 byte – 2 MB" }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateAvatar(bytes, mime);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }
  const kind = checked.ext;

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const objectPath = `${wallet}/v${Date.now()}.${kind}`;
  const { error: upErr } = await db.storage.from("avatars").upload(objectPath, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: "upload failed" }, { status: 502 });
  const { error: dbErr } = await db.from("profiles").upsert(
    { wallet, avatar_path: objectPath, updated_at: new Date().toISOString() },
    { onConflict: "wallet" }
  );
  if (dbErr) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data } = db.storage.from("avatars").getPublicUrl(objectPath);
  return NextResponse.json({ status: "ok", avatarUrl: data?.publicUrl ?? null });
}
