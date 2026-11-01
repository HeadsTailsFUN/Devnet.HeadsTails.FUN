import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { indexSettlementSignature } from "@/lib/history/indexSettlement";
import {
  getServerConnection,
  getSupabaseAdmin,
} from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAME_PROGRAM_ID =
  process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

function isValidSignature(sig: unknown): boolean {
  return (
    typeof sig === "string" &&
    sig.length >= 80 &&
    sig.length <= 100 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)
  );
}

/**
 * Index a verified settlement into the public `matches` read model.
 * Body: { signature }. NOTHING client-provided is trusted: the transaction
 * is fetched from the trusted server RPC, MatchSettled events are parsed
 * from canonical program logs, and every row field comes from the
 * authoritative on-chain Match PDA. Idempotent upserts.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  if (CLUSTER !== "devnet") {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const signature = (body as { signature?: unknown } | null)?.signature;
  if (!isValidSignature(signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const { connection, reason } = getServerConnection();
  if (!connection) {
    return NextResponse.json({ error: reason ?? "unavailable" }, { status: 503 });
  }
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const out = await indexSettlementSignature(
    connection,
    db,
    new PublicKey(GAME_PROGRAM_ID),
    CLUSTER,
    signature as string
  );
  if (!out.ok) {
    return NextResponse.json(
      { error: out.error, eventsSeen: (out as { eventsSeen?: number }).eventsSeen ?? 0 },
      { status: out.status }
    );
  }
  return NextResponse.json({
    status: "indexed",
    matches: out.matches,
    degraded: (out as { degraded?: boolean }).degraded ?? false,
  });
}
