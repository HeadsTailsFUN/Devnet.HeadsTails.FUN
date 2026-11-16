import { NextResponse, type NextRequest } from "next/server";
import { welcomeEntry } from "@/lib/site/welcome-entry";

const privateCache = { "Cache-Control": "private, no-store" };

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname === "/" || req.nextUrl.pathname === "/welcome") return welcomeEntry(req);
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
  matcher: ["/", "/welcome", "/api/admin/:path*", "/api/auth/:path*", "/api/airdrop/:path*", "/api/profile/:path*"],
};
