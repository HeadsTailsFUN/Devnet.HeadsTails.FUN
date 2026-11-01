import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import { checkWebAdmin, devnetAdminContext } from "@/lib/admin/auth";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { resolveServerRpcUrl } from "@/lib/solana/rpc";
import {
  DEVNET_TEST_MINT,
  FAUCET_CLAIM_BASE_UNITS,
  FAUCET_MIN_SOL_LAMPORTS,
} from "@/lib/solana/faucetGate";
import {
  safeDiagnosticDetail,
  type WelcomeGrantDiagnosticFacts,
} from "@/lib/solana/welcomeGrantDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HT-FINAL-001: Devnet-only authenticated welcome-grant diagnostic.
 *
 * Operators could not read Vercel runtime logs (403), so the exact
 * WELCOME_GRANT_* failure for wallets D/E was UNKNOWN. This endpoint lets
 * an OWNER / FULL_ADMIN determine the failure WITHOUT unrestricted log
 * access, returning a SAFE enum only.
 *
 * Safety:
 * - Devnet-only: fail-closed on any Mainnet signal (403).
 * - Requires authenticated Web Admin (OWNER or Devnet FULL_ADMIN).
 * - Never exposes: faucet secret, raw env values, service-role key,
 *   or sensitive transaction material. Only presence booleans, the public
 *   faucet address, and numeric balances.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!devnetAdminContext()) {
    return NextResponse.json({ error: "not available" }, { status: 403 });
  }
  const staff = await checkWebAdmin(req);
  if (!staff.ok) {
    return NextResponse.json(
      { error: staff.error ?? "denied" },
      { status: staff.status ?? 403 }
    );
  }

  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").trim();
  const faucetEnabled =
    (process.env.DEVNET_FAUCET_ENABLED ??
      process.env.NEXT_PUBLIC_DEVNET_FAUCET_ENABLED) === "true";
  const configuredMint = (process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ?? "").trim();
  const supabaseUrlSet = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleSet = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const secretB58 = process.env.DEVNET_FAUCET_SECRET_KEY;
  const faucetKeySet = Boolean(secretB58);

  const baseFacts: Omit<WelcomeGrantDiagnosticFacts, "code" | "detail"> = {
    faucetPubkey: null,
    // Public Devnet test mint under diagnosis (constant, never a secret).
    mint: DEVNET_TEST_MINT,
    treasuryAta: null,
    faucetSolLamports: null,
    treasuryBalanceBaseUnits: null,
    rpcIsDedicated: false,
    rpcMissing: true,
    config: {
      supabaseUrlSet,
      serviceRoleSet,
      faucetKeySet,
      faucetEnabled,
      clusterIsDevnet: cluster === "devnet",
      mintMatches: configuredMint === DEVNET_TEST_MINT,
    },
    recentFailed: null,
  };

  const done = (
    facts: Omit<WelcomeGrantDiagnosticFacts, "code" | "detail">,
    code: WelcomeGrantDiagnosticFacts["code"],
    detail: string
  ): NextResponse =>
    NextResponse.json({ ...facts, code, detail });

  // 1. Config presence (no values leaked).
  if (!supabaseUrlSet || !serviceRoleSet || !faucetKeySet) {
    return done(baseFacts, "WELCOME_GRANT_CONFIG_MISSING", "faucet or database configuration missing");
  }
  if (!faucetEnabled || cluster !== "devnet" || configuredMint !== DEVNET_TEST_MINT) {
    return done(baseFacts, "WELCOME_GRANT_CONFIG_MISSING", "faucet gate disabled or mint/cluster mismatch");
  }

  // 2. Signer validity (public address only).
  let faucetPubkey: PublicKey;
  try {
    const decoded = bs58.decode((secretB58 as string).trim());
    const { Keypair } = await import("@solana/web3.js");
    faucetPubkey = Keypair.fromSecretKey(decoded).publicKey;
  } catch (e) {
    return done(baseFacts, "WELCOME_GRANT_SIGNER_INVALID", safeDiagnosticDetail(e));
  }
  const withSigner = {
    ...baseFacts,
    faucetPubkey: faucetPubkey.toBase58(),
  };

  // 3. RPC selection.
  const serverRpc = resolveServerRpcUrl();
  const withRpc = {
    ...withSigner,
    rpcIsDedicated: serverRpc.isDedicated,
    rpcMissing: serverRpc.missing,
  };
  if (serverRpc.missing) {
    return done(withRpc, "WELCOME_GRANT_RPC_FAILURE", "server Devnet RPC not configured");
  }

  // 4. Live treasury checks (safe numerics only).
  const connection = new Connection(serverRpc.url, "confirmed");
  const mint = new PublicKey(DEVNET_TEST_MINT);
  let treasuryAta: PublicKey;
  try {
    treasuryAta = await getAssociatedTokenAddress(mint, faucetPubkey);
  } catch (e) {
    return done(withRpc, "WELCOME_GRANT_ATA_FAILURE", safeDiagnosticDetail(e));
  }
  const withAta = { ...withRpc, treasuryAta: treasuryAta.toBase58() };

  const faucetSol = await connection.getBalance(faucetPubkey).catch(() => null);
  if (faucetSol === null) {
    return done(withAta, "WELCOME_GRANT_RPC_FAILURE", "faucet SOL balance unreadable");
  }
  const withSol = { ...withAta, faucetSolLamports: faucetSol };
  if (BigInt(faucetSol) < FAUCET_MIN_SOL_LAMPORTS) {
    return done(
      withSol,
      "WELCOME_GRANT_SOL_LOW",
      `faucet SOL ${faucetSol} below minimum ${FAUCET_MIN_SOL_LAMPORTS}`
    );
  }

  const treasuryInfo = await connection.getAccountInfo(treasuryAta).catch(() => null);
  if (!treasuryInfo) {
    return done(withSol, "WELCOME_GRANT_TREASURY_UNAVAILABLE", "treasury token account missing for faucet signer");
  }
  const treasuryBal = await connection.getTokenAccountBalance(treasuryAta).catch(() => null);
  if (!treasuryBal) {
    return done(withSol, "WELCOME_GRANT_TREASURY_UNAVAILABLE", "treasury token balance unreadable");
  }
  const withBal = { ...withSol, treasuryBalanceBaseUnits: treasuryBal.value.amount };
  try {
    if (BigInt(treasuryBal.value.amount) < FAUCET_CLAIM_BASE_UNITS) {
      return done(
        withBal,
        "WELCOME_GRANT_INSUFFICIENT_BALANCE",
        `treasury ${treasuryBal.value.amount} below grant ${FAUCET_CLAIM_BASE_UNITS}`
      );
    }
  } catch (e) {
    return done(withSol, "WELCOME_GRANT_TREASURY_UNAVAILABLE", safeDiagnosticDetail(e));
  }

  // 5. Recent failed-row count (operational hint, best-effort).
  let recentFailed: number | null = null;
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const { count } = await db
        .from("welcome_grants")
        .select("wallet", { count: "exact", head: true })
        .eq("status", "failed");
      recentFailed = typeof count === "number" ? count : null;
    }
  } catch {
    recentFailed = null;
  }

  return done(
    { ...withBal, recentFailed },
    "WELCOME_GRANT_READY",
    "treasury funded; grant path should succeed"
  );
}
