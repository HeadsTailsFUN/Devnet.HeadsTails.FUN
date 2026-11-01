import { NextResponse } from "next/server";

// HT-QA-006: guarantee GET /favicon.ico returns 200 (no console 404).
// Serves the project coin-mark SVG bytes at the legacy .ico path; browsers
// accept SVG here and Next.js also serves /icon from app/icon.svg.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#f5b942"/><circle cx="32" cy="32" r="25" fill="none" stroke="#7a4d00" stroke-width="3"/><text x="32" y="42" font-family="Arial,sans-serif" font-size="28" font-weight="bold" text-anchor="middle" fill="#1a1000">H</text></svg>';

export async function GET(): Promise<NextResponse> {
  return new NextResponse(SVG, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
