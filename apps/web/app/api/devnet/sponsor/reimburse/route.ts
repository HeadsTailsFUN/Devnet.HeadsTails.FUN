import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { isUserReimbursableAction, isValidSignature, isValidWallet } from "@/lib/solana/sponsorGate";
import { verifySponsorTransaction } from "@/lib/solana/sponsorVerify";
import { normalizeSponsorTransaction } from "@/lib/solana/sponsorTransaction";
import { dayKey, getServerConnection, isValidWalletPk, loadSponsorKeypair, sponsorGateCheck } from "@/lib/solana/sponsorServer";
import { ExpenseBudgetError, sendJournaledTransaction } from "@/lib/solana/expenseJournal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  if (!sponsorGateCheck().ok) return NextResponse.json({ error: "Sponsor unavailable" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const b = body as { wallet?: unknown; signature?: unknown; action?: unknown } | null;
  if (!isValidWallet(b?.wallet) || !isValidSignature(b?.signature) || !isUserReimbursableAction(b?.action)) {
    return NextResponse.json({ error: "invalid reimbursement request" }, { status: 422 });
  }
  const walletPk = isValidWalletPk(b!.wallet as string);
  if (!walletPk) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const gameSignature = b!.signature as string;
  const action = b!.action as "join" | "cancel";
  const sponsor = loadSponsorKeypair();
  const { connection } = getServerConnection();
  if (!sponsor || !connection) return NextResponse.json({ error: "Sponsor unavailable" }, { status: 503 });
  try {
    const tx = await connection.getTransaction(gameSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return NextResponse.json({ error: "transaction not found" }, { status: 404 });
    if (tx.meta.err) return NextResponse.json({ error: "on-chain transaction failed; nothing to reimburse" }, { status: 422 });
    const { accountKeys, topLevel } = normalizeSponsorTransaction(tx);
    const verified = verifySponsorTransaction({ action, expectedWallet: walletPk.toBase58(),
      txWallet: accountKeys[0], accountKeys, topLevel, preBalances: tx.meta.preBalances,
      postBalances: tx.meta.postBalances, feeLamports: tx.meta.fee });
    if (!verified.ok) return NextResponse.json({ error: `not eligible: ${verified.reason}` }, { status: 422 });
    const eligible = verified.eligibleLamports!;
    const result = await sendJournaledTransaction({ connection, signer: sponsor,
      transaction: new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey,
        toPubkey: walletPk, lamports: eligible })), operationKey: `reimb-${gameSignature}`,
      wallet: walletPk.toBase58(), kind: "reimburse", transferLamports: eligible });
    if (result.reused) return NextResponse.json({ status: "already-reimbursed", signature: gameSignature });
    return NextResponse.json({ status: "reimbursed", wallet: walletPk.toBase58(), gameSignature,
      sponsorSignature: result.signature, amountLamports: eligible, amountSol: eligible/LAMPORTS_PER_SOL, day: dayKey() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ExpenseBudgetError ? "daily sponsor cap reached" : "Reimbursement pending or unavailable; retry safely" },
      { status: error instanceof ExpenseBudgetError ? 429 : 503 });
  }
}
