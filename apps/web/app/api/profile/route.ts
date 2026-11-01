import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { displayRank } from "@/lib/ranks";
import { isValidWallet } from "@/lib/solana/sponsorGate";
import type { PublicProfile } from "@/lib/profiles/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Public profile + chain-derived stats. Stats come only from indexed matches. */
export async function GET(req: Request): Promise<NextResponse> {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const db = admin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data: profile } = await db
    .from("profiles")
    .select("username,avatar_path,manual_rank_override")
    .eq("wallet", wallet as string)
    .maybeSingle();
  const p = (profile ?? {}) as {
    username?: string | null;
    avatar_path?: string | null;
    manual_rank_override?: string | null;
  };

  const { data: rows } = await db
    .from("matches")
    .select("winner_wallet,heads_wallet,tails_wallet,heads_amount,tails_amount")
    .or(`heads_wallet.eq.${wallet},tails_wallet.eq.${wallet}`)
    .limit(5000);
  const list = (rows ?? []) as Array<{
    winner_wallet: string;
    heads_wallet: string;
    tails_wallet: string;
    heads_amount: string;
    tails_amount: string;
  }>;
  // Authoritative stats: settled indexed rows only (shared pure helper).
  const { countStats } = await import("@/lib/profile/stats");
  const computed = countStats(list, wallet as string);
  const games = computed.games;
  const wins = computed.wins;
  const losses = computed.losses;
  const won = { toString: () => computed.totalWonBaseUnits };
  const style = displayRank(games, p.manual_rank_override ?? null);

  let avatarUrl: string | null = null;
  if (p.avatar_path) {
    const { data } = db.storage.from("avatars").getPublicUrl(p.avatar_path);
    avatarUrl = data?.publicUrl ?? null;
  }
  const out: PublicProfile = {
    wallet: wallet as string,
    username: p.username ?? null,
    avatarUrl,
    gamesPlayed: games,
    wins,
    losses,
    winRate: games > 0 ? wins / games : null,
    totalWonBaseUnits: won.toString(),
    displayRank: style.label,
    rankColorClass: style.colorClass,
  };
  return NextResponse.json({ profile: out });
}
