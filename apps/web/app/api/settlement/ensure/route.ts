import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { ensureSettlement } from "@/lib/settlement/settle";
import { parseMatchId } from "@/lib/settlement/jobPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Request server auto-settlement for exactly one Match ID.
 * Body: { matchId: string }. NOTHING else is trusted: winner/result/pot/
 * destination are all derived server-side from authoritative chain reads.
 * Idempotent: already-settled returns success; duplicate calls are harmless.
 * No wallet signature required (server/sponsor submits permissionless
 * settle_match; the program alone decides the outcome).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const matchId = (body as { matchId?: unknown; match_id?: unknown } | null)?.matchId
    ?? (body as { match_id?: unknown } | null)?.match_id;
  if (parseMatchId(matchId) === null) {
    return NextResponse.json({ error: "invalid match id" }, { status: 400 });
  }
  // Shared settlement admission checks the real owned Match before persistence.
  const out = await ensureSettlement(matchId);
  if (out.status === "settled") {
    return NextResponse.json({ status: "settled", signature: out.signature });
  }
  if (out.status === "already-settled") {
    return NextResponse.json({ status: "already-settled" });
  }
  if (out.status === "pending") {
    return NextResponse.json({ status: "pending", reason: out.reason });
  }
  return NextResponse.json({ error: out.error }, { status: 422 });
}
