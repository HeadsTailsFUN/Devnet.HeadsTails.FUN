import { NextResponse } from "next/server";
import { getSettlementStatus } from "@/lib/settlement/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public auto-settlement status for one Match ID (UI polling). */
export async function GET(req: Request): Promise<NextResponse> {
  const matchId = new URL(req.url).searchParams.get("matchId");
  if (!matchId) return NextResponse.json({ error: "invalid match id" }, { status: 400 });
  const out = await getSettlementStatus(matchId);
  return NextResponse.json(out);
}
