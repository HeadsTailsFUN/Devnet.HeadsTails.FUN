import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { toLeaderboardRow, type LeaderboardRow, type LeaderboardTab } from "@/lib/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

/** Public leaderboard from chain-derived stats. No fake entries. */
export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const tab: LeaderboardTab = params.get("tab") === "played" ? "played" : "wins";
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 25) || 25, 1), MAX_LIMIT);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Supabase JS secondary ordering: wins desc, games desc (or games desc, wins desc).
  let query = db.from("player_stats").select("wallet,games_played,wins,losses");
  query =
    tab === "wins"
      ? query.order("wins", { ascending: false }).order("games_played", { ascending: false })
      : query.order("games_played", { ascending: false }).order("wins", { ascending: false });
  const { data, error } = await query.limit(limit);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const stats = (data ?? []) as Array<{
    wallet: string;
    games_played: number;
    wins: number;
    losses: number;
  }>;
  if (stats.length === 0) {
    return NextResponse.json({ tab, rows: [] as LeaderboardRow[] });
  }
  const wallets = stats.map((s) => s.wallet);
  const { data: profiles } = await db
    .from("profiles")
    .select("wallet,username,avatar_path,manual_rank_override")
    .in("wallet", wallets);
  const byWallet = new Map(
    ((profiles ?? []) as Array<{
      wallet: string;
      username: string | null;
      avatar_path: string | null;
      manual_rank_override: string | null;
    }>).map((p) => [p.wallet, p])
  );
  const avatarUrlFor = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const { data } = db.storage.from("avatars").getPublicUrl(p);
    return data?.publicUrl ?? null;
  };
  const rows = stats.map((s) => {
    const p = byWallet.get(s.wallet);
    return toLeaderboardRow(
      {
        ...s,
        username: p?.username ?? null,
        avatar_path: p?.avatar_path ?? null,
        manual_rank_override: p?.manual_rank_override ?? null,
      },
      avatarUrlFor
    );
  });
  return NextResponse.json({ tab, rows });
}
