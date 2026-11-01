import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff referrals overview + row list. */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const [{ data: attrs }, { data: codes }] = await Promise.all([
    db.from("referral_attributions").select("*").order("attributed_at", { ascending: false }).limit(200),
    db.from("referral_codes").select("wallet,code"),
  ]);
  const rows = ((attrs ?? []) as Array<Record<string, unknown>>);
  const codeByWallet = new Map<string, string>();
  for (const c of ((codes ?? []) as Array<{ wallet: string; code: string }>)) codeByWallet.set(c.wallet, c.code);

  const wallets = [...new Set([...rows.map((r) => String(r.referrer_wallet ?? "")), ...rows.map((r) => String(r.invitee_wallet ?? ""))])].filter(Boolean);
  const userByWallet = new Map<string, { username: string | null; x_handle: string | null }>();
  if (wallets.length > 0) {
    const [{ data: profiles }, { data: claims }] = await Promise.all([
      db.from("profiles").select("wallet,username").in("wallet", wallets),
      db.from("airdrop_social_claims").select("wallet,x_handle").in("wallet", wallets).eq("status", "verified"),
    ]);
    for (const p of ((profiles ?? []) as Array<{ wallet: string; username: string | null }>)) {
      userByWallet.set(p.wallet, { username: p.username, x_handle: userByWallet.get(p.wallet)?.x_handle ?? null });
    }
    for (const c of ((claims ?? []) as Array<{ wallet: string; x_handle: string }>)) {
      const prev = userByWallet.get(c.wallet) ?? { username: null, x_handle: null };
      userByWallet.set(c.wallet, { ...prev, x_handle: c.x_handle });
    }
  }
  // Eligible games + points per invitee (best-effort).
  const { data: season } = await db.from("airdrop_seasons").select("id").eq("active", true).limit(1).maybeSingle();
  const seasonId = (season as { id?: string } | null)?.id ?? null;
  let gamesByWallet = new Map<string, number>();
  let pointsByInvitee = new Map<string, number>();
  if (seasonId && rows.length > 0) {
    const invitees = rows.map((r) => String(r.invitee_wallet));
    const { data: ledger } = await db
      .from("airdrop_points_ledger")
      .select("wallet,points,metadata")
      .eq("season_id", seasonId)
      .eq("category", "referral");
    for (const l of ((ledger ?? []) as Array<{ wallet: string; points: number; metadata: { invitee?: string } }>)) {
      const inv = (l.metadata as { invitee?: string } | null)?.invitee;
      if (inv) pointsByInvitee.set(inv, (pointsByInvitee.get(inv) ?? 0) + Number(l.points ?? 0));
    }
    const { data: games } = await db
      .from("airdrop_points_ledger")
      .select("wallet")
      .eq("season_id", seasonId)
      .eq("category", "gameplay")
      .eq("status", "verified")
      .in("wallet", invitees);
    for (const g of ((games ?? []) as Array<{ wallet: string }>)) {
      gamesByWallet.set(g.wallet, (gamesByWallet.get(g.wallet) ?? 0) + 1);
    }
  }

  const enriched = rows.map((r) => {
    const inv = String(r.invitee_wallet);
    const ref = String(r.referrer_wallet);
    return {
      ...r,
      referrer_code: codeByWallet.get(ref) ?? null,
      referrer_username: userByWallet.get(ref)?.username ?? null,
      invitee_username: userByWallet.get(inv)?.username ?? null,
      invitee_games: gamesByWallet.get(inv) ?? 0,
      referral_points: pointsByInvitee.get(inv) ?? 0,
      x_handle: userByWallet.get(inv)?.x_handle ?? null,
    };
  });
  const summary = {
    totalLinks: codeByWallet.size,
    attributed: rows.length,
    qualified: rows.filter((r) => r.status === "qualified").length,
  };
  await audit(db, staff.wallet!, "referrals.view", null, sanitizeMetadata({}));
  return NextResponse.json({ summary, rows: enriched });
}
