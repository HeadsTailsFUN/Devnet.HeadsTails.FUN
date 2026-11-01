import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { isSocialTask } from "@/lib/airdrop/social";

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
 * Edit an existing social claim without creating a second reward.
 * - connect_x handle change -> identity + claim back to Pending review.
 * - reply/repost URL change -> claim back to Pending review.
 * Same value -> unchanged. All wallet+season scoped, server resolved.
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
  if (task !== "connect_x" && !evidence) {
    return NextResponse.json({ error: "invalid reply URL" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { data: season } = await db.from("airdrop_seasons").select("id").eq("active", true).limit(1).maybeSingle();
  const seasonId = (season as { id?: string } | null)?.id;
  if (!seasonId) return NextResponse.json({ error: "no active season" }, { status: 503 });

  let data: unknown;
  let error: unknown;
  try {
    const res = await db.rpc("update_airdrop_social_claim_atomic", {
      p_season_id: seasonId,
      p_wallet: wallet,
      p_task_type: task,
      p_handle: handle,
      p_evidence_url: evidence,
    });
    data = res.data;
    error = res.error;
  } catch {
    return NextResponse.json({ error: "could not save edit" }, { status: 503 });
  }
  if (!error) {
    const status = (data as { status?: string; claim_id?: string } | null)?.status;
    if (status === "edited") return NextResponse.json({ status: "pending-verification" });
    if (status === "unchanged") return NextResponse.json({ status: "unchanged" });
    return NextResponse.json({ error: "could not save edit" }, { status: 503 });
  }
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  if (/x-taken/i.test(msg)) {
    return NextResponse.json({ error: "X account already linked to another wallet" }, { status: 409 });
  }
  if (/wallet-bound/i.test(msg)) {
    return NextResponse.json({ error: "This wallet is already linked to a different X account." }, { status: 409 });
  }
  if (/no-(identity|claim)/i.test(msg)) {
    return NextResponse.json({ error: "no existing claim to edit" }, { status: 404 });
  }
  if (/invalid-(task|handle)/i.test(msg)) {
    return NextResponse.json({ error: "invalid edit" }, { status: 400 });
  }
  return NextResponse.json({ error: "could not save edit" }, { status: 503 });
}
