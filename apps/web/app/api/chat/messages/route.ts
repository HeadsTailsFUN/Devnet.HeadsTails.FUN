import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { displayRank } from "@/lib/ranks";
import type { ChatMessageView } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Public read of recent global chat (latest 100, excludes moderated). */
export async function GET(req: Request): Promise<NextResponse> {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 100) || 100, 1), 100);
  const db = admin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data, error } = await db
    .from("chat_messages")
    .select("id,wallet,body,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const rows = ((data ?? []) as Array<{ id: string; wallet: string; body: string; created_at: string }>).reverse();
  if (rows.length === 0) return NextResponse.json({ messages: [] as ChatMessageView[] });

  const wallets = [...new Set(rows.map((r) => r.wallet))];
  const [{ data: profiles }, { data: stats }] = await Promise.all([
    db.from("profiles").select("wallet,username,avatar_path,manual_rank_override").in("wallet", wallets),
    db.from("player_stats").select("wallet,games_played").in("wallet", wallets),
  ]);
  const byProfile = new Map(
    ((profiles ?? []) as Array<{ wallet: string; username: string | null; avatar_path: string | null; manual_rank_override: string | null }>).map((p) => [p.wallet, p])
  );
  const byGames = new Map(
    ((stats ?? []) as Array<{ wallet: string; games_played: number }>).map((s) => [s.wallet, s.games_played])
  );
  const avatarUrlFor = (p: string | null | undefined): string | null => {
    if (!p || !db) return null;
    const { data } = db.storage.from("avatars").getPublicUrl(p);
    return data?.publicUrl ?? null;
  };
  const messages: ChatMessageView[] = rows.map((r) => {
    const p = byProfile.get(r.wallet);
    const style = displayRank(byGames.get(r.wallet) ?? 0, p?.manual_rank_override ?? null);
    return {
      id: r.id,
      wallet: r.wallet,
      username: p?.username ?? null,
      avatarUrl: avatarUrlFor(p?.avatar_path),
      displayRank: style.label,
      rankColorClass: style.colorClass,
      body: r.body,
      createdAt: r.created_at,
    };
  });
  return NextResponse.json({ messages });
}
