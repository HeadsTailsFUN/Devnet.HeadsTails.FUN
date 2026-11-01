import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Caller's airdrop points: verified total + category breakdown + pending. */
export async function GET(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data: season } = await db.from("airdrop_seasons").select("id,key").eq("active", true).limit(1).maybeSingle();
  const seasonRow = season as { id?: string; key?: string } | null;
  if (!seasonRow?.id) return NextResponse.json({ error: "no active season" }, { status: 503 });

  const { data } = await db
    .from("airdrop_points_ledger")
    .select("category,points,status")
    .eq("season_id", seasonRow.id)
    .eq("wallet", wallet);
  const rows = ((data ?? []) as Array<{ category: string; points: number; status: string }>);
  const verified = rows.filter((r) => r.status === "verified");
  const pending = rows.filter((r) => r.status === "pending");
  const byCategory = (list: typeof rows) => {
    const out: Record<string, number> = { gameplay: 0, win_bonus: 0, referral: 0, social: 0, adjustment: 0 };
    for (const r of list) {
      if (r.category in out) out[r.category] += Number(r.points ?? 0);
    }
    return out;
  };
  // Social state for the simplified X-task UI: persisted handle, identity
  // status, per-task claim statuses + stored reply URL. Season + wallet
  // scoped, server resolved (never trusted from the request body).
  let social: {
    handle: string | null;
    handleStatus: string | null;
    connectStatus: string | null;
    replyUrl: string | null;
    replyStatus: string | null;
    repostStatus: string | null;
  } = { handle: null, handleStatus: null, connectStatus: null, replyUrl: null, replyStatus: null, repostStatus: null };
  try {
    const { data: ident } = await db
      .from("airdrop_x_identities")
      .select("x_handle,status")
      .eq("season_id", seasonRow.id)
      .eq("wallet", wallet)
      .maybeSingle();
    const idRow = ident as { x_handle?: string; status?: string } | null;
    const { data: claims } = await db
      .from("airdrop_social_claims")
      .select("task_type,status,evidence_url")
      .eq("season_id", seasonRow.id)
      .eq("wallet", wallet);
    const byTask: Record<string, { status: string; evidence_url: string | null }> = {};
    for (const c of ((claims ?? []) as Array<{ task_type: string; status: string; evidence_url: string | null }>)) {
      byTask[c.task_type] = { status: c.status, evidence_url: c.evidence_url };
    }
    social = {
      handle: idRow?.x_handle ?? null,
      handleStatus: idRow?.status ?? null,
      connectStatus: byTask.connect_x?.status ?? null,
      replyUrl: byTask.reply?.evidence_url ?? null,
      replyStatus: byTask.reply?.status ?? null,
      repostStatus: byTask.repost?.status ?? null,
    };
  } catch {
    // social block is best-effort; point totals above still return
  }
  return NextResponse.json({
    season: seasonRow.key,
    verifiedTotal: verified.reduce((s, r) => s + Number(r.points ?? 0), 0),
    pendingTotal: pending.reduce((s, r) => s + Number(r.points ?? 0), 0),
    verified: byCategory(verified),
    pending: byCategory(pending),
    social,
  });
}
