import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { isBenignRaceError, isTransientCrankError } from "@/lib/solana/matchCrank";
import { sponsorGateCheck } from "@/lib/solana/sponsorServer";
import { maintainRoom } from "@/lib/server/maintainRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVNET-ONLY tier-scoped match crank (V2 rooms). Body: { tierUsd }.
 * Thin browser fast-path over the authoritative `maintainRoom` reconciler:
 * hole-skipping + match attempt with bounded retry. The autonomous cron
 * trigger guarantees a future attempt even if this HTTP call fails or the
 * tab closes; this route is only low-latency acceleration.
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
    if (out.matched.length > 0) {
      const first = out.matched[0]!;
      return NextResponse.json({
        status: "matched",
        matchId: first.matchId,
        tierUsd,
        signature: first.signature,
        settlement: "queued",
        advanced: out.advanced,
      });
    }
    if (out.notes.includes("in-progress") || out.notes.includes("match in-progress elsewhere")) {
      return NextResponse.json({ status: "in-progress" });
    }
    if (out.deferred === "BUDGET_LIMIT") {
      return NextResponse.json({ status: "retry", reason: "budget-limit" });
    }
    if (out.pending || out.notes.some((n) => /retry later|unreadable/i.test(n))) {
      return NextResponse.json({ status: "retry", reason: out.notes.join("; ").slice(0, 160) || "retry later" });
    }
    if (out.notes.includes("paused")) return NextResponse.json({ status: "paused" });
    if (out.advanced.length > 0) {
      return NextResponse.json({ status: "raced", note: "inactive heads advanced; refresh", advanced: out.advanced });
    }
    return NextResponse.json({ status: "empty", notes: out.notes, invariants: out.invariants });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isBenignRaceError(msg)) {
      return NextResponse.json({ status: "raced", note: "queue changed; refresh" });
    }
    if (isTransientCrankError(msg)) {
      return NextResponse.json({ status: "unavailable", error: "network busy; staying queued" }, { status: 503 });
    }
    return NextResponse.json({ status: "failed", error: msg.slice(0, 160) }, { status: 422 });
  }
}
