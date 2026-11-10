import { NextResponse, type NextRequest } from "next/server";

const privateCache = { "Cache-Control": "private, no-store" };

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  // These APIs use a host-only wallet session. The request must come from
  // this deployment's origin, not from a sibling subdomain or another site.
  if (
    (origin !== null && origin !== req.nextUrl.origin) ||
    fetchSite === "cross-site" ||
    fetchSite === "same-site"
  ) {
    return NextResponse.json({ error: "cross-origin request denied" }, {
      status: 403,
      headers: privateCache,
    });
  }
  return NextResponse.next({ headers: privateCache });
}

export const config = {
  matcher: ["/api/admin/:path*", "/api/auth/:path*", "/api/airdrop/:path*", "/api/profile/:path*"],
};
