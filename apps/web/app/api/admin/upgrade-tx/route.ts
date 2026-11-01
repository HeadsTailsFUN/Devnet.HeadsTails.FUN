import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The historical hosted V2 upgrade builder is retired for this release. */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({error:"Hosted upgrade signing is disabled. Use the separately approved owner-controlled local release ceremony."},{status:410});
}
