import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  SPONSOR_DAILY_CAP_LAMPORTS,
  SPONSOR_OPERATIONAL_TARGET_LAMPORTS,
  isValidWallet,
} from "@/lib/solana/sponsorGate";
import {
  sponsorExpenseTotals,
  getServerConnection,
  getSupabaseAdmin,
  globalDailyCapLamports,
  loadSponsorKeypair,
  sponsorGateCheck,
} from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEVNET-ONLY sponsor status (public facts only; no secrets).
 * GET /api/devnet/sponsor/status?wallet=<base58>
 */
export async function GET(req: Request): Promise<NextResponse> {
  const gate = sponsorGateCheck();
  if (!gate.ok) {
    return NextResponse.json({ enabled: false, error: "Sponsor unavailable" }, { status: 503 });
  }
  const url = new URL(req.url);
  const walletStr = url.searchParams.get("wallet");
  const sponsor = loadSponsorKeypair();
  if (!sponsor) {
    return NextResponse.json({ enabled: false, error: "Sponsor unavailable" }, { status: 503 });
  }
  const { connection, reason } = getServerConnection();
  if (!connection) {
    return NextResponse.json({ enabled: false, error: reason ?? "Sponsor unavailable" }, { status: 503 });
  }
  const sponsorBalance = await connection.getBalance(sponsor.publicKey).catch(() => null);
  if (walletStr && !isValidWallet(walletStr)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  let walletBalance: number | null = null;
  let totals: { wallet: number; global: number };
  let globalCap: null;
  try {
    totals = await sponsorExpenseTotals(getSupabaseAdmin(), walletStr);
    globalCap = globalDailyCapLamports();
  } catch {
    return NextResponse.json({ enabled: false, error: "Sponsor unavailable" }, { status: 503 });
  }
  if (walletStr) {
    try {
      walletBalance = await connection.getBalance(new PublicKey(walletStr)).catch(() => null);
    } catch {
      walletBalance = null;
    }
  }
  return NextResponse.json({
    enabled: true,
    cluster: "devnet",
    sponsor: sponsor.publicKey.toBase58(),
    sponsorBalanceLamports: sponsorBalance,
    wallet: walletStr,
    walletBalanceLamports: walletBalance,
    needsPrefund: walletBalance !== null ? walletBalance < SPONSOR_OPERATIONAL_TARGET_LAMPORTS : null,
    operationalTargetLamports: SPONSOR_OPERATIONAL_TARGET_LAMPORTS,
    dailyCapLamports: SPONSOR_DAILY_CAP_LAMPORTS,
    dailyCapsEnabled: false,
    dailyUsedLamports: totals.wallet,
    globalDailyCapLamports: globalCap,
    globalDailyUsedLamports: totals.global,
    note: "DEVNET — network costs sponsored",
  });
}
