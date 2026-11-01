import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { isSocialTask, socialPendingPoints } from "@/lib/airdrop/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeHandle(h: unknown): string | null {
  if (typeof h !== "string") return null;
  const t = h.trim().replace(/^@/, "").slice(0, 32);
  if (!/^[A-Za-z0-9_]{1,32}$/.test(t)) return null;
  return t;
}

function sanitizeUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u.trim()) return null;
  const t = u.trim().slice(0, 500);
  if (!/^https:\/\/(x\.com|twitter\.com)\//i.test(t)) return null;
  return t;
}

/**
 * X task claim. Real OAuth verification when credentials exist; otherwise
 * manual-pending fallback (enter handle + optional reply URL, Claim Repost ->
 * Pending verification). One claim = one ledger event: a pending social
 * points row is created with the claim and transitions to verified/rejected
 * on admin review. Pending points never count toward VERIFIED total.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const task = b.task as string;
  if (!isSocialTask(task)) {
    return NextResponse.json({ error: "invalid task" }, { status: 400 });
  }
  const handle = sanitizeHandle(b.handle ?? b.x_handle);
  if (!handle) return NextResponse.json({ error: "invalid X handle" }, { status: 400 });
  const evidence = task === "connect_x" ? null : sanitizeUrl(b.evidenceUrl ?? b.evidence_url ?? b.replyUrl);
  const xUserId =
    typeof b.x_user_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.x_user_id.trim())
      ? b.x_user_id.trim()
      : null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data: season } = await db.from("airdrop_seasons").select("id").eq("active", true).limit(1).maybeSingle();
  const seasonId = (season as { id?: string } | null)?.id;
  if (!seasonId) return NextResponse.json({ error: "no active season" }, { status: 503 });
  const profileUrl = `https://x.com/${handle}`;

  // Atomic single transaction: identity bind + claim + pending ledger.
  // Either all three commit or all roll back — no orphan claim is possible.
  // No fake verification: every claim starts pending until admin review.
  let data: unknown;
  let error: unknown;
  try {
    const res = await db.rpc("create_airdrop_social_claim_atomic", {
      p_season_id: seasonId,
      p_wallet: wallet,
      p_task_type: task,
      p_handle: handle,
      p_profile_url: profileUrl,
      p_evidence_url: evidence,
      p_x_user_id: xUserId,
      p_points: socialPendingPoints(task),
    });
    data = res.data;
    error = res.error;
  } catch {
    return NextResponse.json({ error: "could not save claim" }, { status: 503 });
  }
  if (!error) {
    const status = (data as { status?: string; claim_id?: string } | null)?.status;
    const claimId = (data as { claim_id?: string } | null)?.claim_id;
    if (status === "created") return NextResponse.json({ status: "pending-verification", id: claimId });
    if (status === "already-claimed") return NextResponse.json({ status: "already-claimed" });
    return NextResponse.json({ error: "could not save claim" }, { status: 503 });
  }
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  if (/x-taken/i.test(msg)) {
    return NextResponse.json({ error: "X account already linked to another wallet" }, { status: 409 });
  }
  if (/wallet-bound/i.test(msg)) {
    return NextResponse.json({ error: "This wallet is already linked to a different X account." }, { status: 409 });
  }
  if (/invalid-(task|handle|points)/i.test(msg)) {
    return NextResponse.json({ error: "invalid claim" }, { status: 400 });
  }
  return NextResponse.json({ error: "could not save claim" }, { status: 503 });
}
