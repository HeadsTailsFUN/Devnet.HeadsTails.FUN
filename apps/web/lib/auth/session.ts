import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  SESSION_COOKIE,
  buildAuthMessage,
  hashToken,
  isChallengeFresh,
  newNonce,
  newSessionToken,
  type Challenge,
} from "@/lib/auth/message";
import { isValidWallet } from "@/lib/solana/sponsorGate";

function admin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function appDomain(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "";
  if (configured.trim()) return configured.trim();
  try {
    return new URL(req.url).host;
  } catch {
    return "HeadsTails.fun";
  }
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Wallet bound to the request's session cookie, or null. Server-side only. */
export async function getSessionWallet(req: Request): Promise<string | null> {
  try {
    const header = req.headers.get("cookie") ?? "";
    const token = parseCookie(header, SESSION_COOKIE);
    if (!token) return null;
    const db = admin();
    if (!db) return null;
    const { data } = await db
      .from("auth_sessions")
      .select("wallet,expires_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (!data) return null;
    const row = data as { wallet: string; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return row.wallet;
  } catch {
    return null;
  }
}

export function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export async function clearSessionToken(req: Request): Promise<void> {
  try {
    const header = req.headers.get("cookie") ?? "";
    const token = parseCookie(header, SESSION_COOKIE);
    if (!token) return;
    const db = admin();
    if (!db) return;
    await db.from("auth_sessions").delete().eq("token_hash", hashToken(token));
  } catch {
    // ignore
  }
}

export { buildAuthMessage, isChallengeFresh, newNonce, newSessionToken };
export type { Challenge };
export { CHALLENGE_TTL_MS };
