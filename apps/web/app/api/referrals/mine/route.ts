import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { normalizeReferralCode, referralCodeForWallet } from "@/lib/referrals/code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Get or create the caller's stable referral code + stats. */
export async function GET(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  let code: string | null = null;
  const { data: existing } = await db.from("referral_codes").select("code").eq("wallet", wallet).maybeSingle();
  code = (existing as { code?: string } | null)?.code ?? null;
  if (!code) {
    const base = referralCodeForWallet(wallet);
    // Unique retry on collision.
    for (let i = 0; i < 5 && !code; i += 1) {
      const candidate = i === 0 ? base : `${base.slice(0, 6)}${String(i).padStart(2, "0")}`;
      const { data, error } = await db
        .from("referral_codes")
        .upsert({ wallet, code: normalizeReferralCode(candidate) }, { onConflict: "wallet" })
        .select("code")
        .maybeSingle();
      if (!error && data) code = (data as { code: string }).code;
      else {
        // Code collision: try next suffix.
        const { data: retry } = await db.from("referral_codes").select("code").eq("wallet", wallet).maybeSingle();
        code = (retry as { code?: string } | null)?.code ?? null;
        if (code) break;
      }
    }
  }
  if (!code) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const origin = (() => {
    try {
      return new URL(req.url).origin;
    } catch {
      return "";
    }
  })();
  // Season-scoped: referral points must never leak across seasons.
  const { data: season } = await db.from("airdrop_seasons").select("id,key").eq("active", true).limit(1).maybeSingle();
  const seasonRow = season as { id?: string; key?: string } | null;
  let points = 0;
  if (seasonRow?.id) {
    const { data: ledger } = await db
      .from("airdrop_points_ledger")
      .select("points")
      .eq("season_id", seasonRow.id)
      .eq("wallet", wallet)
      .eq("category", "referral")
      .eq("status", "verified");
    points = ((ledger ?? []) as Array<{ points: number }>).reduce((s, r) => s + Number(r.points ?? 0), 0);
  }
  const { data: attrs } = await db.from("referral_attributions").select("status").eq("referrer_wallet", wallet);
  const rows = ((attrs ?? []) as Array<{ status: string }>);
  const pendingInvites = rows.filter((r) => r.status === "pending").length;
  // Invitee-side progress: caller's own attribution + VERIFIED eligible
  // settled games (gameplay_match markers, including zero-point capped
  // markers). 3 eligible games -> qualification reward.
  let myReferral: { status: string; eligibleGames: number; gamesNeeded: number } | null = null;
  try {
    const { data: mine } = await db
      .from("referral_attributions")
      .select("status")
      .eq("invitee_wallet", wallet)
      .maybeSingle();
    const myStatus = (mine as { status?: string } | null)?.status ?? null;
    if (myStatus && seasonRow?.id) {
      const { count: eligible } = await db
        .from("airdrop_points_ledger")
        .select("id", { count: "exact", head: true })
        .eq("season_id", seasonRow.id)
        .eq("wallet", wallet)
        .eq("event_type", "gameplay_match")
        .eq("status", "verified");
      const eligibleGames = eligible ?? 0;
      myReferral = {
        status: myStatus,
        eligibleGames,
        gamesNeeded: Math.max(0, 3 - eligibleGames),
      };
    }
  } catch {
    // progress is best-effort; core stats above still return
  }
  return NextResponse.json({
    code,
    link: origin ? `${origin}/?ref=${code}` : `/?ref=${code}`,
    totalInvites: rows.length,
    qualified: rows.filter((r) => r.status === "qualified").length,
    pendingInvites,
    referralPoints: points,
    season: seasonRow?.key ?? null,
    myReferral,
  });
}
