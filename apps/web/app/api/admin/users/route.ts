import { NextResponse } from "next/server";
import { adminDb, checkStaff } from "@/lib/admin/auth";
import { displayRank } from "@/lib/ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff user search by username or wallet (chain stats included, read-only). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const q = (new URL(req.url).searchParams.get("query") ?? "").trim().slice(0, 44);

  let query = db
    .from("profiles")
    .select("wallet,username,avatar_path,manual_rank_override")
    .order("updated_at", { ascending: false })
    .limit(25);
  if (q) {
    query = query.or(`username_normalized.ilike.%${q.toLowerCase()}%,wallet.ilike.%${q}%`);
  }
  const { data } = await query;
  const list = (data ?? []) as Array<{
    wallet: string;
    username: string | null;
    avatar_path: string | null;
    manual_rank_override: string | null;
  }>;
  const wallets = list.map((p) => p.wallet);
  const stats = new Map<string, { games_played: number; wins: number; losses: number }>();
  const mods = new Map<string, { muted: boolean; web_restricted: boolean }>();
  if (wallets.length > 0) {
    const [{ data: s }, { data: m }] = await Promise.all([
      db.from("player_stats").select("wallet,games_played,wins,losses").in("wallet", wallets),
      db.from("user_moderation").select("wallet,muted,web_restricted").in("wallet", wallets),
    ]);
    for (const r of (s ?? []) as Array<{ wallet: string; games_played: number; wins: number; losses: number }>) {
      stats.set(r.wallet, r);
    }
    for (const r of (m ?? []) as Array<{ wallet: string; muted: boolean; web_restricted: boolean }>) {
      mods.set(r.wallet, r);
    }
  }
  // HT-FINAL-003: ONE canonical Admin user shape. The client model is
  // camelCase (`gamesPlayed`, matching PublicProfile/leaderboard); the
  // database stays snake_case (`games_played`). Normalize here so the UI
  // never needs ad-hoc fallbacks like `u.games ?? u.gamesPlayed`.
  const users = list.map((p) => {
    const s = stats.get(p.wallet) ?? { games_played: 0, wins: 0, losses: 0 };
    return {
      wallet: p.wallet,
      username: p.username,
      avatar_path: p.avatar_path,
      manual_rank_override: p.manual_rank_override,
      gamesPlayed: s.games_played,
      wins: s.wins,
      losses: s.losses,
      displayRank: displayRank(s.games_played, p.manual_rank_override).label,
      muted: mods.get(p.wallet)?.muted ?? false,
      webRestricted: mods.get(p.wallet)?.web_restricted ?? false,
    };
  });
  return NextResponse.json({ users });
}
