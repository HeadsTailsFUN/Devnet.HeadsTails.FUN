import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import {
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  buildAuthMessage,
  hashToken,
  isChallengeFresh,
  newSessionToken,
  type Challenge,
} from "@/lib/auth/message";
import { sessionCookieOptions } from "@/lib/auth/session";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

/** Verify an ownership signature and issue a session cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return NextResponse.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = body as { wallet?: unknown; signature?: unknown; challenge?: unknown } | null;
  if (!isValidWallet(b?.wallet) || typeof b?.signature !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const wallet = b!.wallet as string;
  const signature = b!.signature as string;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    return NextResponse.json({ error: "invalid signature encoding" }, { status: 401 });
  }
  const c = b!.challenge as Partial<Challenge> | null;
  if (!c || typeof c.nonce !== "string" || !/^[0-9a-f]{64}$/.test(c.nonce) ||
      typeof c.expiresAt !== "string" || typeof c.issuedAt !== "string") {
    return NextResponse.json({ error: "invalid challenge" }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // The nonce must exist, belong to this wallet, be fresh and unused.
  const { data: row } = await db
    .from("auth_nonces")
    .select("wallet,expires_at,used_at")
    .eq("nonce", c.nonce)
    .maybeSingle();
  const rec = row as { wallet: string; expires_at: string; used_at: string | null } | null;
  if (!rec || rec.wallet !== wallet || rec.used_at) {
    return NextResponse.json({ error: "unknown or reused challenge" }, { status: 401 });
  }
  if (!isChallengeFresh({ expiresAt: rec.expires_at })) {
    return NextResponse.json({ error: "challenge expired" }, { status: 401 });
  }

  // Rebuild both timestamps from the stored expiry in the exact ISO format
  // used by challenge issuance, so neither display field is caller-chosen.
  const expiry = Date.parse(rec.expires_at);
  const expiresAt = new Date(expiry).toISOString();
  const issuedAt = new Date(expiry - CHALLENGE_TTL_MS).toISOString();
  if (c.expiresAt !== expiresAt || c.issuedAt !== issuedAt) {
    return NextResponse.json({ error: "invalid challenge" }, { status: 401 });
  }
  const configured = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "";
  let domain = configured.trim();
  if (!domain) {
    try {
      domain = new URL(req.url).host;
    } catch {
      domain = "HeadsTails.fun";
    }
  }
  const full: Challenge = {
    nonce: c.nonce,
    domain,
    wallet,
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    issuedAt,
    expiresAt,
  };
  const message = new TextEncoder().encode(buildAuthMessage(full));

  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
  } catch {
    return NextResponse.json({ error: "invalid signature encoding" }, { status: 401 });
  }
  if (sigBytes.length !== 64) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let owner: Uint8Array;
  try {
    owner = new PublicKey(wallet).toBytes();
  } catch {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  // Raw Ed25519 verification against the claimed wallet (no prefixes added).
  if (!nacl.sign.detached.verify(message, sigBytes, owner)) {
    return NextResponse.json({ error: "signature does not match wallet" }, { status: 401 });
  }

  const token = newSessionToken();
  const now = Date.now();
  // Consumption and session insertion must commit together. A replay or a
  // database failure must never receive a successful session cookie.
  const { data: issued, error: issueError } = await db.rpc("issue_wallet_session_atomic", {
    p_nonce: c.nonce,
    p_wallet: wallet,
    p_token_hash: hashToken(token),
    p_expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    p_ip: clientIp(req),
  });
  if (issueError) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (issued !== true) {
    return NextResponse.json({ error: "unknown or reused challenge" }, { status: 401 });
  }
  const res = NextResponse.json({ status: "ok", wallet });
  res.cookies.set("ht_session", token, sessionCookieOptions());
  return res;
}
