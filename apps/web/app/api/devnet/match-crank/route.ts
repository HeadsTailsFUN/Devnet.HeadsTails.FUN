import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { maintainRoom } from "@/lib/server/maintainRoom";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Compatibility trigger only. Historical queues are drain-only; all new
 * matching uses the same bounded HTS room reconciler as the active UI. */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  try {
    const results = await Promise.all([maintainRoom(1), maintainRoom(10)]);
    return NextResponse.json({status: results.some(r=>r.matched.length>0)?"matched":"pending"});
  } catch {
    return NextResponse.json({status:"unavailable"},{status:503});
  }
}
