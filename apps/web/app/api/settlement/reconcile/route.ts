import { NextResponse } from "next/server";
import { checkStaff } from "@/lib/admin/auth";
import { reconcileUnresolved } from "@/lib/settlement/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Background reconciliation for unresolved Matches (staff-gated admin path;
 * the same function also runs from keeper/cron). Finds
 * WaitingForRandomness matches: leaves randomness-pending alone, ensures
 * settlement jobs for fulfilled ones, ensures history indexed for settled.
 * Bounded RPC load.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  let body: unknown = null;
  try {
    body = await req.json().catch(() => null);
  } catch {
    body = null;
  }
  const b = (body ?? {}) as { lookback?: unknown; limit?: unknown };
  const lookback = typeof b.lookback === "number" ? b.lookback : 50;
  const limit = typeof b.limit === "number" ? b.limit : 10;
  const out = await reconcileUnresolved({ lookback, limit });
  return NextResponse.json({ status: "reconciled", ...out });
}
