import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { isValidReferralCode, normalizeReferralCode } from "@/lib/referrals/code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ip(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

const hits = new Map<string, { n: number; at: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { n: 1, at: now });
    return false;
  }
  h.n += 1;
  return h.n > 10;
}

/** Attribute the caller's wallet to a referrer code (immutable, no self-ref). */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (rateLimited(`attr:${ip(req)}:${wallet}`)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const raw = (body as { code?: unknown } | null)?.code;
  if (!isValidReferralCode(raw)) return NextResponse.json({ error: "invalid code" }, { status: 400 });
  const code = normalizeReferralCode(raw as string);
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  // Resolve CODE server-side; never trust client-submitted referrer wallet.
  const { data: codeRow } = await db.from("referral_codes").select("wallet").eq("code", code).maybeSingle();
  const referrer = (codeRow as { wallet?: string } | null)?.wallet ?? null;
  if (!referrer) return NextResponse.json({ error: "unknown code" }, { status: 404 });
  if (referrer === wallet) return NextResponse.json({ error: "self referral blocked" }, { status: 400 });

  const { data: existing } = await db
    .from("referral_attributions")
    .select("referrer_wallet")
    .eq("invitee_wallet", wallet)
    .maybeSingle();
  if ((existing as { referrer_wallet?: string } | null)?.referrer_wallet) {
    return NextResponse.json({ status: "already-attributed" });
  }
  const { error } = await db.from("referral_attributions").insert({
    invitee_wallet: wallet,
    referrer_wallet: referrer,
    referral_code: code,
    status: "pending",
  });
  if (error) {
    // Race: row appeared concurrently -> immutable, keep existing.
    return NextResponse.json({ status: "already-attributed" });
  }
  return NextResponse.json({ status: "attributed" });
}
