import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";
import { indexSettlementSignature } from "@/lib/history/indexSettlement";
import { getServerConnection } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidSignature(sig: unknown): boolean {
  return (
    typeof sig === "string" &&
    sig.length >= 80 &&
    sig.length <= 100 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)
  );
}

/** Staff reindex/reconcile of a settlement (verified, idempotent). */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
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
  const db = adminDb();
  const { connection } = getServerConnection();
  if (!db || !connection) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const out = await indexSettlementSignature(
    connection,
    db,
    new PublicKey(process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"),
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    signature as string
  );
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: out.status });
  }
  await audit(db, staff.wallet as string, "matches.reindex", signature as string, sanitizeMetadata({}));
  return NextResponse.json({ status: "indexed", matches: out.matches });
}
