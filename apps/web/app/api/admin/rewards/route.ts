import { NextResponse } from "next/server";
import { adminDb, checkStaff } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Settled payout analytics (chain/indexed data; never editable). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const db = adminDb();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data } = await db
    .from("matches")
    .select("onchain_match_id,winner_wallet,heads_amount,tails_amount,settled_at,transaction_signature")
    .order("settled_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  const rows = (data ?? []) as Array<{
    onchain_match_id: string;
    winner_wallet: string;
    heads_amount: string;
    tails_amount: string;
    settled_at: string | null;
    transaction_signature: string;
  }>;
  let totalPaid = BigInt(0);
  let todayPaid = BigInt(0);
  let todayCount = 0;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  for (const r of rows) {
    try {
      const pot = BigInt(r.heads_amount) + BigInt(r.tails_amount);
      totalPaid += pot;
      if (r.settled_at && Date.parse(r.settled_at) >= dayStart.getTime()) {
        todayPaid += pot;
        todayCount += 1;
      }
    } catch {
      // ignore malformed amounts
    }
  }
  return NextResponse.json({
    totalMatches: rows.length,
    totalPaidBaseUnits: totalPaid.toString(),
    todayCount,
    todayPaidBaseUnits: todayPaid.toString(),
    recent: rows.slice(0, 25),
  });
}
