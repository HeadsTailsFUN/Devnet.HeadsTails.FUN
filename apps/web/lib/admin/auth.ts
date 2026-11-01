import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { gameIdlJson, type HeadsOrTails } from "@heads-or-tails/game-sdk";
import { getSessionWallet } from "@/lib/auth/session";
import { resolveServerRpcUrl } from "@/lib/solana/rpc";

export type StaffRole = "OWNER" | "MODERATOR" | "FULL_ADMIN";

// Staff identities are read from admin_members, never granted by source constants.

/** FULL_ADMIN is Devnet-only: cluster == devnet AND no Mainnet real value. */
export function devnetAdminContext(): boolean {
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").trim();
  const mainnet =
    process.env.MAINNET_REAL_VALUE_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED === "true";
  return cluster === "devnet" && !mainnet;
}

function adminDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function serverConnection(): Connection | null {
  const r = resolveServerRpcUrl();
  if (r.missing) return null;
  return new Connection(r.url, "confirmed");
}

/** Current on-chain GameConfig authority (bootstrap owner). Never stored. */
export async function getOnchainAuthority(): Promise<string | null> {
  try {
    const connection = serverConnection();
    if (!connection) return null;
    const programId = new PublicKey(
      process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
    );
    const provider = new AnchorProvider(
      connection,
      // Read-only facade (Anchor's Wallet helper is browser-oriented).
      { publicKey: Keypair.generate().publicKey } as Wallet,
      { commitment: "confirmed" }
    );
    const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
    const cfg = await program.account.gameConfig.fetch(config);
    return (cfg.authority as PublicKey).toBase58();
  } catch {
    return null;
  }
}

export interface StaffCheck {
  ok: boolean;
  wallet?: string;
  role?: StaffRole;
  authority?: string | null;
  status?: number;
  error?: string;
}

/**
 * Server-side staff check.
 * - OWNER: session wallet IS the live on-chain GameConfig authority.
 * - FULL_ADMIN: listed in admin_members with role FULL_ADMIN; satisfies
 *   OFF-CHAIN checks on DEVNET ONLY (fail-closed on any Mainnet signal)
 *   and NEVER satisfies ownerOnly (on-chain) checks.
 * - MODERATOR: existing limited staff behavior.
 */
export async function checkStaff(req: Request, ownerOnly: boolean): Promise<StaffCheck> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return { ok: false, status: 401, error: "authentication required" };
  const db = adminDb();
  if (!db) return { ok: false, status: 503, error: "unavailable" };
  const authority = await getOnchainAuthority();
  if (authority && wallet === authority) {
    return { ok: true, wallet, role: "OWNER", authority };
  }
  if (ownerOnly) {
    return { ok: false, status: 403, error: "owner access required" };
  }
  const { data } = await db.from("admin_members").select("role").eq("wallet", wallet).maybeSingle();
  const role = (data as { role?: string } | null)?.role ?? null;
  if (role === "MODERATOR") {
    return { ok: true, wallet, role: "MODERATOR", authority };
  }
  if (role === "FULL_ADMIN") {
    // Fail closed outside Devnet: never a Mainnet admin substitute.
    if (!devnetAdminContext()) {
      return { ok: false, status: 403, error: "staff access required" };
    }
    return { ok: true, wallet, role: "FULL_ADMIN", authority };
  }
  return { ok: false, status: 403, error: "staff access required" };
}

/**
 * Full off-chain Web Admin check (B) — distinct from on-chain owner
 * authority (A).
 * - OWNER (live GameConfig authority): always allowed.
 * - FULL_ADMIN: allowed on DEVNET ONLY (fail-closed on any Mainnet signal).
 * - MODERATOR: never admitted here (limited behavior preserved elsewhere).
 *
 * Use for OFF-CHAIN admin reads/mutations (audit, review, adjustments,
 * exclusions, settings, profile moderation, metadata-only bounty, asset
 * uploads). NEVER use for routes that build/submit instructions requiring
 * the GameConfig authority or Program upgrade authority — those stay on
 * checkStaff(req, true), which FULL_ADMIN can never satisfy.
 */
export async function checkWebAdmin(req: Request): Promise<StaffCheck> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) return staff;
  if (staff.role === "OWNER") return staff;
  if (staff.role === "FULL_ADMIN") {
    // Belt-and-braces: checkStaff already fail-closes FULL_ADMIN
    // off-Devnet, but this boundary must never depend on that alone.
    if (!devnetAdminContext()) {
      return { ok: false, status: 403, error: "staff access required" };
    }
    return staff;
  }
  return { ok: false, status: 403, error: "staff access required" };
}

/** Immutable-ish audit write. Metadata is sanitized by callers. */
export async function audit(
  db: SupabaseClient,
  adminWallet: string,
  action: string,
  target: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await db.from("admin_audit_log").insert({
      admin_wallet: adminWallet,
      action,
      target,
      metadata,
    });
  } catch {
    // audit must never break the admin action itself
  }
}

/** Strip secret-bearing keys from audit metadata. */
export function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (/key|secret|signature|token|password/i.test(k)) continue;
    if (typeof v === "string" && v.length <= 500) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export { adminDb };
