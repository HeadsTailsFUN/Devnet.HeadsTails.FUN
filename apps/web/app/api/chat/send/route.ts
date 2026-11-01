import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth/session";
import { CHAT_MAX_PER_MINUTE, CHAT_MIN_INTERVAL_MS, validateBody } from "@/lib/chat/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated chat send with server-side validation + rate limits. */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: "connect and verify your wallet to chat" }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const checked = validateBody((body as { body?: unknown } | null)?.body);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Chat kill-switch (admin).
  const { data: setting } = await db.from("site_settings").select("value").eq("key", "chat_enabled").maybeSingle();
  const enabled = (setting as { value?: { enabled?: boolean } } | null)?.value?.enabled;
  if (enabled === false) {
    return NextResponse.json({ error: "chat is temporarily disabled" }, { status: 503 });
  }

  // Moderation (server-enforced; client limits are not security).
  const { data: mod } = await db
    .from("user_moderation")
    .select("muted,web_restricted")
    .eq("wallet", wallet)
    .maybeSingle();
  const m = (mod ?? {}) as { muted?: boolean; web_restricted?: boolean };
  if (m.muted || m.web_restricted) {
    return NextResponse.json({ error: "you cannot post right now" }, { status: 403 });
  }

  // Rate limits: 1/sec + 20/min per wallet.
  const now = Date.now();
  const [{ data: last }, { count }] = await Promise.all([
    db.from("chat_messages").select("created_at").eq("wallet", wallet).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("chat_messages").select("id", { count: "exact", head: true }).eq("wallet", wallet).gte("created_at", new Date(now - 60_000).toISOString()),
  ]);
  const lastAt = (last as { created_at?: string } | null)?.created_at;
  if (lastAt && now - Date.parse(lastAt) < CHAT_MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "sending too fast" }, { status: 429 });
  }
  if ((count ?? 0) >= CHAT_MAX_PER_MINUTE) {
    return NextResponse.json({ error: "minute limit reached" }, { status: 429 });
  }

  const { data: inserted, error } = await db
    .from("chat_messages")
    .insert({ wallet, body: checked.body })
    .select("id,wallet,body,created_at")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: "could not send" }, { status: 503 });
  }
  const row = inserted as { id: string; wallet: string; body: string; created_at: string };
  return NextResponse.json({ message: row });
}
