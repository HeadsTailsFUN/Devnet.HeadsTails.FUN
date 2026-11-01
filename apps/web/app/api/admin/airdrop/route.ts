import { NextResponse } from "next/server";
import { adminDb, audit, checkStaff, checkWebAdmin, sanitizeMetadata } from "@/lib/admin/auth";
import { reviewSocialClaim } from "@/lib/airdrop/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff airdrop overview: per-user verified/pending breakdown + pending claims. */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const params = new URL(req.url).searchParams;
  const q = (params.get("query") ?? "").trim().slice(0, 44).toLowerCase();
  const pendingOnly = params.get("pending") === "1";
  const excludedOnly = params.get("excluded") === "1";
  const eligibleOnly = params.get("eligible") === "1";

  const { data: season } = await db.from("airdrop_seasons").select("id,key").eq("active", true).limit(1).maybeSingle();
  const seasonRow = season as { id?: string; key?: string } | null;
  if (!seasonRow?.id) return NextResponse.json({ error: "no active season" }, { status: 503 });

  const [
    { data: ledger },
    { data: claims },
    { data: profiles },
    { data: stats },
    { data: attrs },
    { data: exclusions },
  ] = await Promise.all([
    db.from("airdrop_points_ledger").select("wallet,category,points,status,created_at").eq("season_id", seasonRow.id).limit(5000),
    db.from("airdrop_social_claims").select("*").eq("season_id", seasonRow.id).order("created_at", { ascending: false }).limit(500),
    db.from("profiles").select("wallet,username").limit(2000),
    db.from("player_stats").select("wallet,games_played,wins,losses").limit(2000),
    db.from("referral_attributions").select("referrer_wallet,status").limit(2000),
    db.from("reward_exclusions").select("wallet,reason,active").eq("active", true).limit(2000),
  ]);
  const rows = ((ledger ?? []) as Array<{ wallet: string; category: string; points: number; status: string; created_at: string }>);
  const claimRows = ((claims ?? []) as Array<Record<string, unknown>>);

  interface Agg {
    verified: number; pending: number; gameplay: number; win_bonus: number;
    referral: number; social: number; games: number; last: string;
  }
  const byWallet = new Map<string, Agg>();
  const touch = (w: string, at: string): Agg => {
    let e = byWallet.get(w);
    if (!e) {
      e = { verified: 0, pending: 0, gameplay: 0, win_bonus: 0, referral: 0, social: 0, games: 0, last: at };
      byWallet.set(w, e);
    }
    return e;
  };
  for (const r of rows) {
    const e = touch(r.wallet, r.created_at);
    const pts = Number(r.points ?? 0);
    if (r.status === "verified") {
      e.verified += pts;
      if (r.category === "gameplay") {
        e.gameplay += pts;
        e.games += 1;
      }
      if (r.category === "win_bonus") e.win_bonus += pts;
      if (r.category === "referral") e.referral += pts;
      if (r.category === "social") e.social += pts;
    } else if (r.status === "pending") {
      e.pending += pts;
    }
    if (r.created_at > e.last) e.last = r.created_at;
  }

  const claimByWallet = new Map<string, Record<string, unknown>[]>();
  for (const c of claimRows) {
    const w = String(c.wallet);
    claimByWallet.set(w, [...(claimByWallet.get(w) ?? []), c]);
    touch(w, String(c.created_at ?? ""));
  }

  const nameByWallet = new Map<string, string | null>();
  for (const p of ((profiles ?? []) as Array<{ wallet: string; username: string | null }>)) {
    nameByWallet.set(p.wallet, p.username);
  }
  const statsByWallet = new Map<string, { games_played: number; wins: number; losses: number }>();
  for (const s of ((stats ?? []) as Array<{ wallet: string; games_played: number; wins: number; losses: number }>)) {
    statsByWallet.set(s.wallet, s);
  }
  const qualifiedByReferrer = new Map<string, number>();
  for (const a of ((attrs ?? []) as Array<{ referrer_wallet: string; status: string }>)) {
    if (a.status === "qualified") {
      qualifiedByReferrer.set(a.referrer_wallet, (qualifiedByReferrer.get(a.referrer_wallet) ?? 0) + 1);
    }
  }
  const exclusionByWallet = new Map<string, string | null>();
  for (const x of ((exclusions ?? []) as Array<{ wallet: string; reason: string | null }>)) {
    exclusionByWallet.set(x.wallet, x.reason ?? null);
  }

  const primaryX = (w: string): { handle: string | null; profileUrl: string | null } => {
    const list = claimByWallet.get(w) ?? [];
    const verified = list.find((c) => c.status === "verified");
    const any = verified ?? list[0];
    if (!any) return { handle: null, profileUrl: null };
    return {
      handle: typeof any.x_handle === "string" ? any.x_handle : null,
      profileUrl: typeof any.x_profile_url === "string" ? any.x_profile_url : null,
    };
  };

  let users = [...byWallet.keys()].map((w) => {
    const agg = byWallet.get(w)!;
    const st = statsByWallet.get(w);
    const x = primaryX(w);
    const list = claimByWallet.get(w) ?? [];
    const taskStatus: Record<string, string> = {};
    for (const c of list) taskStatus[String(c.task_type)] = String(c.status);
    return {
      wallet: w,
      username: nameByWallet.get(w) ?? null,
      xHandle: x.handle,
      xProfileUrl: x.profileUrl,
      verifiedTotal: agg.verified,
      pendingTotal: agg.pending,
      gameplayPoints: agg.gameplay,
      winBonusPoints: agg.win_bonus,
      referralPoints: agg.referral,
      socialPoints: agg.social,
      eligibleGames: agg.games,
      wins: st?.wins ?? 0,
      losses: st?.losses ?? 0,
      qualifiedReferrals: qualifiedByReferrer.get(w) ?? 0,
      taskStatuses: taskStatus,
      lastPointsEvent: agg.last,
      season: seasonRow.key,
      excluded: exclusionByWallet.has(w),
      exclusionReason: exclusionByWallet.get(w) ?? null,
      claims: list,
    };
  });

  if (q) {
    users = users.filter(
      (u) =>
        u.wallet.toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q) ||
        (u.xHandle ?? "").toLowerCase().includes(q)
    );
  }
  if (pendingOnly) {
    users = users.filter((u) => (u.claims as Array<{ status?: string }>).some((c) => c.status === "pending"));
  }
  if (excludedOnly) {
    users = users.filter((u) => u.excluded);
  }
  if (eligibleOnly) {
    users = users.filter((u) => !u.excluded && u.eligibleGames > 0);
  }
  users.sort((a, b) => b.verifiedTotal - a.verifiedTotal);
  await audit(db, staff.wallet!, "airdrop.view", null, sanitizeMetadata({}));
  return NextResponse.json({ season: seasonRow.key, users: users.slice(0, 200), claims: claimRows.slice(0, 200) });
}

/** Staff mutations: verify/reject social claim, manual adjustment (reason required), exclusions. */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const action = b.action as string;

  if (action === "review-claim") {
    const id = typeof b.id === "string" ? b.id : "";
    const decision = b.decision as string;
    if (!id || (decision !== "verified" && decision !== "rejected")) {
      return NextResponse.json({ error: "invalid review" }, { status: 400 });
    }
    const out = await reviewSocialClaim(db, {
      claimId: id,
      decision,
      reviewer: staff.wallet!,
      note: typeof b.note === "string" ? b.note : null,
    });
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.status });
    }
    await audit(db, staff.wallet!, "airdrop.review-claim", id, sanitizeMetadata({ decision }));
    return NextResponse.json({ status: "ok" });
  }

  if (action === "exclude" || action === "restore") {
    // Off-chain ledger control (OWNER or Devnet FULL_ADMIN); moderators are read-only here.
    const admin = await checkWebAdmin(req);
    if (!admin.ok) return NextResponse.json({ error: "owner or full-admin access required" }, { status: 403 });
    const target = typeof b.wallet === "string" ? b.wallet.trim() : "";
    if (!target) return NextResponse.json({ error: "wallet required" }, { status: 400 });
    if (action === "exclude") {
      const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 500) : "";
      if (!reason) return NextResponse.json({ error: "reason required" }, { status: 400 });
      const { error } = await db.from("reward_exclusions").upsert(
        {
          wallet: target,
          reason,
          active: true,
          created_by: staff.wallet,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet" }
      );
      if (error) return NextResponse.json({ error: "could not exclude wallet" }, { status: 503 });
      await audit(db, staff.wallet!, "airdrop.exclude", target, sanitizeMetadata({ reason: reason.slice(0, 200) }));
      return NextResponse.json({ status: "ok" });
    }
    const { error } = await db
      .from("reward_exclusions")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("wallet", target);
    if (error) return NextResponse.json({ error: "could not restore wallet" }, { status: 503 });
    await audit(db, staff.wallet!, "airdrop.restore", target, sanitizeMetadata({}));
    return NextResponse.json({ status: "ok" });
  }

  if (action === "adjust") {
    // Off-chain ledger operation (OWNER or Devnet FULL_ADMIN); reason required, audited.
    const admin = await checkWebAdmin(req);
    if (!admin.ok) return NextResponse.json({ error: "owner or full-admin access required" }, { status: 403 });
    const wallet = typeof b.wallet === "string" ? b.wallet.trim() : "";
    const points = Number(b.points);
    const reason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (!wallet || !Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
      return NextResponse.json({ error: "wallet and non-zero integer points required" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "reason required" }, { status: 400 });
    }
    const { data: season } = await db.from("airdrop_seasons").select("id").eq("active", true).limit(1).maybeSingle();
    const seasonId = (season as { id?: string } | null)?.id;
    if (!seasonId) return NextResponse.json({ error: "no active season" }, { status: 503 });
    const key = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await db.from("airdrop_points_ledger").insert({
      season_id: seasonId,
      wallet,
      category: "adjustment",
      event_type: "manual_adjustment",
      source_key: key,
      points: Math.trunc(points),
      status: "verified",
      verified_at: new Date().toISOString(),
      metadata: { reason: reason.slice(0, 500), by: staff.wallet },
    });
    if (error) return NextResponse.json({ error: "could not record adjustment" }, { status: 503 });
    await audit(db, staff.wallet!, "airdrop.adjust", wallet, sanitizeMetadata({ points, reason: reason.slice(0, 200) }));
    return NextResponse.json({ status: "ok", source_key: key });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
