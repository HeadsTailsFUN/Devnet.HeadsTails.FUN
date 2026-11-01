import { NextResponse } from "next/server";
import { adminDb, audit, checkWebAdmin, sanitizeMetadata } from "@/lib/admin/auth";
import { isValidRankOverride } from "@/lib/ranks";
import { normalizeUsername, validateUsername } from "@/lib/profiles/username";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Off-chain profile edits for another wallet (OWNER or Devnet FULL_ADMIN):
 * set/clear username, clear avatar, set/reset display-rank override.
 * Chain stats are never touched.
 */
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
  const b = body as { wallet?: unknown; username?: unknown; clearAvatar?: unknown; rankOverride?: unknown } | null;
  if (!isValidWallet(b?.wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const target = b!.wallet as string;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (b!.username !== undefined) {
    if (b!.username === null) {
      patch.username = null;
      patch.username_normalized = null;
    } else {
      const checked = validateUsername(b!.username);
      if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });
      const { data: taken } = await db
        .from("profiles")
        .select("wallet")
        .eq("username_normalized", checked.normalized)
        .neq("wallet", target)
        .limit(1);
      if (Array.isArray(taken) && taken.length > 0) {
        return NextResponse.json({ error: "username is taken" }, { status: 409 });
      }
      patch.username = (b!.username as string).trim();
      patch.username_normalized = normalizeUsername((b!.username as string).trim());
    }
  }
  if (b!.clearAvatar === true) {
    patch.avatar_path = null;
  }
  if (b!.rankOverride !== undefined) {
    if (b!.rankOverride === null || b!.rankOverride === "AUTO") {
      patch.manual_rank_override = null;
    } else {
      if (!isValidRankOverride(b!.rankOverride)) {
        return NextResponse.json({ error: "invalid rank override" }, { status: 400 });
      }
      patch.manual_rank_override = (b!.rankOverride as string).toUpperCase();
    }
  }
  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const { error } = await db.from("profiles").upsert({ wallet: target, ...patch }, { onConflict: "wallet" });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await audit(db, staff.wallet as string, "users.profile_edit", target, sanitizeMetadata(patch));
  return NextResponse.json({ status: "ok" });
}
