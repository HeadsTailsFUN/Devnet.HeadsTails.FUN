import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveServerRpcUrl } from "./rpc";
import { evaluateSponsorGate, getGlobalDailyCapLamports, EXPECTED_SPONSOR_PUBKEY } from "./sponsorGate";
import { devnetEnvironmentAllowed } from "./devnetSafety";

/** Server-only: load the dedicated Devnet sponsor keypair (never client-visible). */
export function loadSponsorKeypair(): Keypair | null {
  const secretB58 = process.env.DEVNET_SOL_SPONSOR_SECRET_KEY;
  if (!secretB58) return null;
  try {
    const secret = bs58.decode(secretB58.trim());
    const keypair = Keypair.fromSecretKey(secret);
    return keypair.publicKey.toBase58() === EXPECTED_SPONSOR_PUBKEY ? keypair : null;
  } catch {
    return null;
  }
}

export function sponsorGateCheck(): { ok: true } | { ok: false; reason: string } {
  if (!devnetEnvironmentAllowed(process.env)) return { ok: false, reason: "sponsor is devnet-only" };
  return evaluateSponsorGate({
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    sponsorEnabled: process.env.DEVNET_SOL_SPONSOR_ENABLED,
    mainnetRealValue: process.env.MAINNET_REAL_VALUE_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED === "true" ? "true" : "false",
  });
}

export function getServerConnection(): { connection: Connection | null; reason: string | null } {
  const r = resolveServerRpcUrl();
  if (r.missing) {
    return {
      connection: null,
      reason:
        "Server Devnet RPC is not configured (SOLANA_SERVER_RPC_URL). Public api.devnet.solana.com must not be the primary QA RPC.",
    };
  }
  return { connection: new Connection(r.url, "confirmed"), reason: null };
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Authoritative budget read model: historical ledger plus all current holds. */
export async function sponsorExpenseTotals(db: SupabaseClient | null, wallet: string | null): Promise<{ wallet: number; global: number }> {
  if (!db) throw new Error("Operation journal unavailable");
  const { data, error } = await db.rpc("devnet_expense_totals", { p_wallet: wallet });
  if (error || !data) throw new Error("Operation journal unavailable");
  const result = { wallet: Number(data.wallet), global: Number(data.global) };
  if (!Number.isSafeInteger(result.wallet) || !Number.isSafeInteger(result.global)) throw new Error("Invalid budget totals");
  return result;
}

export async function dailySpentLamports(db: SupabaseClient | null, wallet: string): Promise<number> {
  return (await sponsorExpenseTotals(db, wallet)).wallet;
}

export async function globalDailySpentLamports(db: SupabaseClient | null): Promise<number> {
  return (await sponsorExpenseTotals(db, null)).global;
}

export function globalDailyCapLamports(): null {
  return getGlobalDailyCapLamports();
}

export function sponsorPubkeyOrNull(): string | null {
  const kp = loadSponsorKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

export function isValidWalletPk(s: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}
