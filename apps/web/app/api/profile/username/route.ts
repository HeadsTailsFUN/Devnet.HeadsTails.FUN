import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth/session";
import { normalizeUsername, validateUsername } from "@/lib/profiles/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Authenticated username set/change (identity comes from session, never body). */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const checked = validateUsername((body as { username?: unknown } | null)?.username);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Case-insensitive uniqueness (excluding self).
  const { data: taken } = await db
    .from("profiles")
    .select("wallet")
    .eq("username_normalized", checked.normalized)
    .neq("wallet", wallet)
    .limit(1);
  if (Array.isArray(taken) && taken.length > 0) {
    return NextResponse.json({ error: "username is taken" }, { status: 409 });
  }

  const { data: existing } = await db
    .from("profiles")
    .select("username_updated_at")
    .eq("wallet", wallet)
    .maybeSingle();
  const prev = existing as { username_updated_at?: string | null } | null;
  // Once-per-24h change limit (first set always allowed).
  if (prev?.username_updated_at) {
    const last = Date.parse(prev.username_updated_at);
    if (Number.isFinite(last) && Date.now() - last < CHANGE_COOLDOWN_MS) {
      return NextResponse.json({ error: "username can change once per 24h" }, { status: 429 });
    }
  }

  const display = (body as { username: string }).username.trim();
  const { error } = await db.from("profiles").upsert(
    {
      wallet,
      username: display,
      username_normalized: checked.normalized,
      username_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet" }
  );
  if (error) {
    const msg = error.message.toLowerCase().includes("unique") || error.message.toLowerCase().includes("duplicate")
      ? "username is taken"
      : "unavailable";
    return NextResponse.json({ error: msg }, { status: msg === "username is taken" ? 409 : 503 });
  }
  return NextResponse.json({ status: "ok", username: display });
}
