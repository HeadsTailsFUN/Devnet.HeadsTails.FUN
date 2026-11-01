import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["mute", "unmute", "restrict", "unrestrict"]);

/**
 * Chat moderation (staff). A web restriction/mute NEVER claims to block
 * direct on-chain program interaction — it only gates this website's
 * chat and profile conveniences.
 */
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
  const b = body as { wallet?: unknown; action?: unknown } | null;
  if (!isValidWallet(b?.wallet) || typeof b?.action !== "string" || !ACTIONS.has(b.action)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const target = b!.wallet as string;
  const action = b!.action as string;

  const { data: existing } = await db
    .from("user_moderation")
    .select("muted,web_restricted")
    .eq("wallet", target)
    .maybeSingle();
  const cur = (existing ?? { muted: false, web_restricted: false }) as {
    muted: boolean;
    web_restricted: boolean;
  };
  const next = {
    muted: action === "mute" ? true : action === "unmute" ? false : cur.muted,
    web_restricted: action === "restrict" ? true : action === "unrestrict" ? false : cur.web_restricted,
  };
  const { error } = await db.from("user_moderation").upsert(
    { wallet: target, ...next, updated_at: new Date().toISOString(), updated_by: staff.wallet },
    { onConflict: "wallet" }
  );
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await audit(db, staff.wallet as string, `moderation.${action}`, target, sanitizeMetadata({}));
  return NextResponse.json({ status: "ok", wallet: target, ...next });
}
