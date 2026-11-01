import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { SPONSOR_OPERATIONAL_TARGET_LAMPORTS, computePrefundLamports, isValidWallet } from "@/lib/solana/sponsorGate";
import { getServerConnection, isValidWalletPk, loadSponsorKeypair, sponsorGateCheck } from "@/lib/solana/sponsorServer";
import { ExpenseBudgetError, sendJournaledTransaction } from "@/lib/solana/expenseJournal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Original operational target; admission and retries are serialized in Postgres. */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  if (!sponsorGateCheck().ok) return NextResponse.json({ error: "Sponsor unavailable" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const wallet = (body as { wallet?: unknown } | null)?.wallet;
  const walletPk = isValidWallet(wallet) ? isValidWalletPk(wallet as string) : null;
  if (!walletPk) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const sponsor = loadSponsorKeypair();
  const { connection } = getServerConnection();
  if (!sponsor || !connection) return NextResponse.json({ error: "Sponsor unavailable" }, { status: 503 });
  try {
    const bal = await connection.getBalance(walletPk);
    if (!Number.isSafeInteger(bal) || bal < 0) throw new Error("Balance unavailable");
    const amount = computePrefundLamports(bal);
    if (amount === 0) return NextResponse.json({ status: "already-funded", wallet: walletPk.toBase58(),
      balanceLamports: bal, operationalTargetLamports: SPONSOR_OPERATIONAL_TARGET_LAMPORTS });
    const result = await sendJournaledTransaction({ connection, signer: sponsor,
      transaction: new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey,
        toPubkey: walletPk, lamports: amount })),
      operationKey: `prefund-${walletPk.toBase58()}-${Math.floor(Date.now()/3_600_000)}`,
      wallet: walletPk.toBase58(), kind: "prefund", transferLamports: amount });
    return NextResponse.json({ status: result.reused ? "already-funded" : "funded", wallet: walletPk.toBase58(),
      sponsorSignature: result.signature, amountLamports: amount, amountSol: amount/LAMPORTS_PER_SOL,
      operationalTargetLamports: SPONSOR_OPERATIONAL_TARGET_LAMPORTS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ExpenseBudgetError ? "daily sponsor cap reached" : "Sponsor unavailable; retry safely" },
      { status: error instanceof ExpenseBudgetError ? 429 : 503 });
  }
}
