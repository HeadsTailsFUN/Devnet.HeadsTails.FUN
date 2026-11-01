import { getSessionWallet } from "@/lib/auth/session";
import { restrictedQaAdmission } from "@/lib/server/restrictedQa";
import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import { DEVNET_TEST_MINT, FAUCET_CLAIM_BASE_UNITS, FAUCET_MIN_SOL_LAMPORTS, evaluateFaucetGate, isValidWallet } from "@/lib/solana/faucetGate";
import { resolveServerRpcUrl } from "@/lib/solana/rpc";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { devnetEnvironmentAllowed } from "@/lib/solana/devnetSafety";
import { ExpensePendingError, sendJournaledTransaction } from "@/lib/solana/expenseJournal";
import { HTS_SERVICE_SIGNER, validServiceSigner } from "@/lib/solana/releaseToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrantFailure = "WELCOME_GRANT_CONFIG_MISSING" | "WELCOME_GRANT_SIGNER_INVALID" | "WELCOME_GRANT_RPC_FAILURE"
  | "WELCOME_GRANT_ATA_FAILURE" | "WELCOME_GRANT_TREASURY_UNAVAILABLE" | "WELCOME_GRANT_INSUFFICIENT_BALANCE"
  | "WELCOME_GRANT_SOL_LOW" | "WELCOME_GRANT_SEND_FAILURE" | "WELCOME_GRANT_CONFIRMATION_FAILURE";

/** Both grant endpoints use one durable wallet+mint journal, including retries. */
export async function POST(req: Request): Promise<NextResponse> {
  const qaDenied = await restrictedQaAdmission(req);
  if (qaDenied) return qaDenied;
  const gate = evaluateFaucetGate({ cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    faucetEnabled: process.env.DEVNET_FAUCET_ENABLED ?? process.env.NEXT_PUBLIC_DEVNET_FAUCET_ENABLED,
    mainnetRealValue: process.env.MAINNET_REAL_VALUE_ENABLED === "true" || process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED === "true" ? "true" : "false",
    configuredMint: process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT });
  if (!gate.ok || !devnetEnvironmentAllowed(process.env)) return NextResponse.json({ status: "disabled" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ status: "malformed" }, { status: 400 }); }
  const wallet = (body as { wallet?: unknown } | null)?.wallet;
  if (!isValidWallet(wallet)) return NextResponse.json({ status: "invalid" }, { status: 400 });
  if (await getSessionWallet(req) !== wallet) return NextResponse.json({ error: "Verify wallet ownership" }, { status: 401 });
  const db = getSupabaseAdmin();
  const secret = process.env.DEVNET_FAUCET_SECRET_KEY;
  const rpc = resolveServerRpcUrl();
  if (!db || !secret || rpc.missing) {
    console.error("[welcome-grant] code=WELCOME_GRANT_CONFIG_MISSING");
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
  let failCode: GrantFailure = "WELCOME_GRANT_SIGNER_INVALID";
  try {
    const faucet = Keypair.fromSecretKey(bs58.decode(secret.trim()));
    if (!validServiceSigner(HTS_SERVICE_SIGNER) || faucet.publicKey.toBase58() !== HTS_SERVICE_SIGNER) {
      throw new Error("Unapproved service custody");
    }
    failCode = "WELCOME_GRANT_RPC_FAILURE";
    const connection = new Connection(rpc.url, "confirmed");
    const walletPk = new PublicKey(wallet as string);
    const mint = new PublicKey(DEVNET_TEST_MINT);
    failCode = "WELCOME_GRANT_ATA_FAILURE";
    const treasuryAta = await getAssociatedTokenAddress(mint, faucet.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mint, walletPk);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, recipientAta, walletPk, mint),
      createTransferCheckedInstruction(treasuryAta, mint, recipientAta, faucet.publicKey, FAUCET_CLAIM_BASE_UNITS, 6));
    failCode = "WELCOME_GRANT_RPC_FAILURE";
    const result = await sendJournaledTransaction({ connection, signer: faucet, transaction: tx,
      operationKey: `welcome-${DEVNET_TEST_MINT}-${walletPk.toBase58()}`, wallet: walletPk.toBase58(), kind: "faucet", db,
      prepare: async () => {
        failCode = "WELCOME_GRANT_RPC_FAILURE";
        const sol = await connection.getBalance(faucet.publicKey);
        if (BigInt(sol) < FAUCET_MIN_SOL_LAMPORTS) {
          failCode = "WELCOME_GRANT_SOL_LOW";
          throw new Error("Treasury SOL unavailable");
        }
        failCode = "WELCOME_GRANT_TREASURY_UNAVAILABLE";
        if (!await connection.getAccountInfo(treasuryAta)) throw new Error("treasury ATA missing");
        const balance = await connection.getTokenAccountBalance(treasuryAta);
        if (BigInt(balance.value.amount) < FAUCET_CLAIM_BASE_UNITS) {
          failCode = "WELCOME_GRANT_INSUFFICIENT_BALANCE";
          throw new Error("Treasury tokens unavailable");
        }
        failCode = "WELCOME_GRANT_RPC_FAILURE";
      } });
    if (!result.signature) return NextResponse.json({ status: "already-granted" });
    // Compatibility read model only. A failed mirror write cannot reopen the
    // immutable completed expense or permit another token transfer.
    const mirrored = await db.from("welcome_grants").upsert({ wallet: walletPk.toBase58(), mint: DEVNET_TEST_MINT,
      status: "completed", signature: result.signature, updated_at: new Date().toISOString() }, { onConflict: "wallet,mint", ignoreDuplicates: true });
    if (mirrored.error) console.error("[welcome-grant] code=WELCOME_GRANT_LEDGER_UNAVAILABLE");
    return NextResponse.json({ status: result.reused ? "already-granted" : "granted", signature: result.signature,
      amount: result.reused ? undefined : FAUCET_CLAIM_BASE_UNITS.toString(), mint: DEVNET_TEST_MINT, wallet: walletPk.toBase58() });
  } catch (error) {
    // Stable classifications only: never secrets, RPC URLs or exception text.
    if (error instanceof ExpensePendingError) {
      console.error(error.phase === "send" ? "[welcome-grant] code=WELCOME_GRANT_SEND_FAILURE"
        : "[welcome-grant] code=WELCOME_GRANT_CONFIRMATION_FAILURE");
      return NextResponse.json({ status: "pending" });
    }
    console.error(`[welcome-grant] code=${failCode}`);
    return NextResponse.json({ status: "unavailable", error: "transfer failed" }, { status: 503 });
  }
}
