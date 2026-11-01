import { NextResponse } from "next/server";
import { checkStaff } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Staff gate: owner, full admin (Devnet), or moderator (+ on-chain authority for reference). */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  return NextResponse.json({
    isOwner: staff.role === "OWNER",
    isModerator: staff.role === "MODERATOR",
    isFullAdmin: staff.role === "FULL_ADMIN",
    role: staff.role,
    wallet: staff.wallet,
    authority: staff.authority ?? null,
  });
}
