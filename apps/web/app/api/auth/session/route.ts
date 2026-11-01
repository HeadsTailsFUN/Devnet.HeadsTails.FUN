import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current session wallet (or null). No secrets leave the server. */
export async function GET(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  return NextResponse.json({ wallet });
}
