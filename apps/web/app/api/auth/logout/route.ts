import { NextResponse } from "next/server";
import { clearSessionToken } from "@/lib/auth/session";
import { sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Logout: revoke the session server-side and clear the cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  await clearSessionToken(req);
  const res = NextResponse.json({ status: "ok" });
  res.cookies.set("ht_session", "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
