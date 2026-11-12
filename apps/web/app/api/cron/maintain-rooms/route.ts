import { NextResponse } from "next/server";
import { maintainRoom } from "@/lib/server/maintainRoom";
import { reconcileUnresolved } from "@/lib/settlement/settle";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { reconcileSettledMatchRewards } from "@/lib/airdrop/reconcile";
import { authorizeRecovery, CANONICAL_RECOVERY_ORIGIN, recoveryHealth } from "@/lib/server/recoveryAuth";
import { devnetEnvironmentAllowed } from "@/lib/solana/devnetSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Browser-independent bounded matchmaking, settlement and reward recovery.
 * Supabase pg_cron/pg_net provides minute-level attempts using a short-lived,
 * single-use HMAC. The inherited Hobby Vercel cron is daily, not minute-level.
 * Browsers calling match-crank-room after Join remain the low-latency path.
 * Scheduling requires separate activation and stops on ambiguous transport
 * outcomes; a scheduled attempt is not a guarantee of eventual payout.
 *
 * Legacy auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Local
 * dev without a secret is allowed; production without a matching secret
 * is rejected.
 */
async function cronAuthorized(req: Request): Promise<boolean> {
  if (req.headers.has("x-ht-recovery-mac")) {
    if (!devnetEnvironmentAllowed(process.env)) return false;
    const db = getSupabaseAdmin();
    if (!db) return false;
    return authorizeRecovery(req, {
      secret: process.env.RECOVERY_HMAC_SECRET ?? "",
      origin: new URL(req.url).origin === CANONICAL_RECOVERY_ORIGIN
        ? CANONICAL_RECOVERY_ORIGIN
        : process.env.NEXT_PUBLIC_SITE_URL ?? "",
      mint: process.env.NEXT_PUBLIC_HTS_TOKEN_MINT ?? "",
      nowSeconds: Math.floor(Date.now() / 1000),
    }, async (nonce, timestamp) => {
      const { data, error } = await db.rpc("claim_headstails_recovery_request", {
        p_nonce: nonce, p_timestamp: timestamp,
      });
      return !error && data === true;
    });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!await cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Recover existing obligations before new matchmaking consumes the invocation budget.
  const settle = await reconcileUnresolved({ lookback: 50, limit: 3, budgetMs: 15_000 }).catch((e) => ({
    error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
  }));
  const r1 = await maintainRoom(1).catch((e) => ({
    tierUsd: 1,
    error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
  }));
  const r10 = await maintainRoom(10).catch((e) => ({
    tierUsd: 10,
    error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
  }));
  // Bounded reward backfill: idempotent reprocessing of indexed settled
  // matches. Best-effort only — failures are reported, never thrown, and
  // game settlement/room maintenance are unaffected.
  let rewards: unknown = { skipped: true };
  try {
    const db = getSupabaseAdmin();
    if (db) {
      // Visit the same recent 50 matches in ten bounded batches. A large
      // all-at-once reward pass must not time out the recovery transport.
      const rewardOffset = (Math.floor(Date.now() / 60_000) % 10) * 5;
      rewards = await reconcileSettledMatchRewards(db, { limit: 5, sinceDays: 7, offset: rewardOffset });
    } else {
      rewards = { error: "supabase unavailable" };
    }
  } catch (e) {
    rewards = { error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) };
  }
  const body = { status: "cron-maintained", rooms: [r1, r10], settle, rewards };
  return NextResponse.json(req.headers.has("x-ht-recovery-mac") ? recoveryHealth(body) : body);
}
