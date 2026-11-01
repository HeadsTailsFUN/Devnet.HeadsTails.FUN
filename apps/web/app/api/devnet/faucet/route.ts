import { NextResponse } from "next/server";
import { POST as welcomeTokens } from "../welcome-tokens/route";
import { DEVNET_TEST_MINT } from "@/lib/solana/faucetGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legacy response contract, shared atomic grant identity and signed-byte journal. */
export async function POST(req: Request): Promise<NextResponse> {
  const response = await welcomeTokens(req);
  const body = await response.json();
  if (body.status === "already-granted") return NextResponse.json({ status: "cooldown" }, { status: 429 });
  if (body.status === "granted") return NextResponse.json({ ...body, status: "ok", mint: DEVNET_TEST_MINT });
  return NextResponse.json(body, { status: response.status });
}
