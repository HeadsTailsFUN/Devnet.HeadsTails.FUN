import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { HTS_TOKEN_MINT } from "@/lib/solana/releaseToken";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const wallet = await getSessionWallet(req);
  if (!wallet)
    return NextResponse.json(
      { error: "Verify wallet ownership" },
      { status: 401 },
    );
  const id = new URL(req.url).searchParams.get("match");
  if (!id || !/^\d{1,20}$/.test(id))
    return NextResponse.json({ error: "Invalid match" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { data, error } = await db.rpc("hts_result_reaction", {
    p_wallet: wallet,
    p_match: id,
    p_mint: HTS_TOKEN_MINT,
    p_program: process.env.HEADS_TAILS_PROGRAM_ID,
  });
  if (error)
    return NextResponse.json({ error: "Result unavailable" }, { status: 503 });
  return NextResponse.json(data ?? { pending: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
