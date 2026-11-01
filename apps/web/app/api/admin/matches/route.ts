import { NextResponse } from "next/server";
import { adminDb, checkStaff } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff match inspection (read-only; chain data is never editable here). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const params = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 25) || 25, 1), 100);
  const q = (params.get("query") ?? "").trim().slice(0, 44);
  let query = db
    .from("matches")
    .select(
      "onchain_match_id,heads_wallet,tails_wallet,winner_wallet,result,heads_amount,tails_amount,token_mint,tier_usd,created_slot,settled_slot,settled_at,transaction_signature,cluster,program_id"
    )
    .order("settled_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (q) {
    query = query.or(
      `onchain_match_id.eq.${q},heads_wallet.ilike.%${q}%,tails_wallet.ilike.%${q}%,winner_wallet.ilike.%${q}%,transaction_signature.ilike.%${q}%`
    );
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ matches: data ?? [] });
}
