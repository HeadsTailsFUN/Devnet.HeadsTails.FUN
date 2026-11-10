import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CHALLENGE_TTL_MS, buildAuthMessage, newNonce, type Challenge } from "@/lib/auth/message";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a short-lived wallet-ownership challenge. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    const raw = await req.text();
    if (raw.length > 1024) return NextResponse.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const wallet = (body as { wallet?: unknown } | null)?.wallet;
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const configured = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "";
  let domain = configured.trim();
  if (!domain) {
    try {
      domain = new URL(req.url).host;
    } catch {
      domain = "HeadsTails.fun";
    }
  }
  const now = Date.now();
  const challenge: Challenge = {
    nonce: newNonce(),
    domain,
    wallet: wallet as string,
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  };
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // Opportunistic expiry cleanup (best-effort).
  await db.from("auth_nonces").delete().lt("expires_at", new Date(now).toISOString()).then(
    () => undefined,
    () => undefined
  );
  const { error } = await db.from("auth_nonces").insert({
    nonce: challenge.nonce,
    wallet: challenge.wallet,
    expires_at: challenge.expiresAt,
  });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ challenge, message: buildAuthMessage(challenge) });
}
