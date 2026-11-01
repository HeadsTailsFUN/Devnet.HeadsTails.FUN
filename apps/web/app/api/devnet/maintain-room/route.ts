import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { maintainRoom } from "@/lib/server/maintainRoom";
import { sponsorGateCheck } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVNET-ONLY browser-independent room maintenance.
 * Body: { tierUsd } — runs the authoritative self-healing reconciler for
 * one tier room (hole-skipping + match attempt). Called by the autonomous
 * cron trigger; browsers may call it as a low-latency fast path after Join.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  const gate = sponsorGateCheck();
  if (!gate.ok) {
    return NextResponse.json({ status: "disabled", error: "Matcher unavailable" }, { status: 503 });
  }
  let tierUsd = 0;
  try {
    const b = (await req.json().catch(() => null)) as { tierUsd?: unknown } | null;
    if (typeof b?.tierUsd === "number") tierUsd = b.tierUsd;
    else if (typeof b?.tierUsd === "string" && /^\d+$/.test(b.tierUsd)) tierUsd = Number(b.tierUsd);
  } catch {
    tierUsd = 0;
  }
  if (tierUsd !== 1 && tierUsd !== 10) {
    return NextResponse.json({ status: "failed", error: "unsupported room" }, { status: 422 });
  }
  try {
    const out = await maintainRoom(tierUsd);
    return NextResponse.json({ status: "maintained", ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "failed", error: msg.slice(0, 160) }, { status: 503 });
  }
}
