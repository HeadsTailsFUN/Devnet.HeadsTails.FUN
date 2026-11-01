import { socialPointsFor } from "./rules";

export type SocialTask = "connect_x" | "repost" | "reply";
export type ClaimStatus = "pending" | "verified" | "rejected";

export const SOCIAL_TASKS: readonly SocialTask[] = ["connect_x", "repost", "reply"] as const;

export function isSocialTask(t: unknown): t is SocialTask {
  return t === "connect_x" || t === "repost" || t === "reply";
}

/** One claim = one ledger event: social_<task> / claim UUID / matching points. */
export function socialEventType(task: SocialTask): string {
  return `social_${task}`;
}

export function socialPendingPoints(task: SocialTask): number {
  return socialPointsFor(task);
}

export function normalizeXHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase().slice(0, 32);
}

export interface SocialClaimRow {
  id: string;
  season_id: string;
  wallet: string;
  x_user_id: string | null;
  x_handle: string;
  task_type: string;
  status: string;
}

export interface XIdentityRow {
  id: string;
  season_id: string;
  wallet: string;
  x_user_id: string | null;
  x_handle: string;
  status: string;
}

export const X_TAKEN_ERROR = "This X account is already verified for another wallet.";
export const WALLET_BOUND_ERROR = "This wallet is already linked to a different X account.";

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23505") return true;
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return /duplicate|unique/i.test(msg);
}

type Db = {
  from: (table: string) => any;
  rpc: (...args: Array<any>) => any;
};
type Outcome = { ok: true } | { ok: false; error: string; status: number };

/**
 * A verified X identity (OAuth id, else normalized handle) cannot belong to
 * two wallets in one season. Checks the identity table first, then verified
 * task rows as a backstop.
 */
export async function verifiedXClash(
  db: Db,
  args: { seasonId: string; xUserId: string | null; normalizedHandle: string; excludeWallet: string }
): Promise<boolean> {
  const { seasonId, xUserId, normalizedHandle, excludeWallet } = args;
  try {
    if (xUserId) {
      const { data } = await db
        .from("airdrop_x_identities")
        .select("wallet")
        .eq("season_id", seasonId)
        .eq("x_user_id", xUserId)
        .eq("status", "verified")
        .limit(50);
      for (const r of ((data ?? []) as Array<{ wallet: string }>)) {
        if (r.wallet !== excludeWallet) return true;
      }
    }
    const { data: identities } = await db
      .from("airdrop_x_identities")
      .select("wallet,x_handle")
      .eq("season_id", seasonId)
      .eq("status", "verified")
      .limit(500);
    for (const r of ((identities ?? []) as Array<{ wallet: string; x_handle: string }>)) {
      if (r.wallet !== excludeWallet && normalizeXHandle(r.x_handle) === normalizedHandle) return true;
    }
    // Backstop: verified task rows (covers rows predating the identity table).
    const { data: claims } = await db
      .from("airdrop_social_claims")
      .select("wallet,x_handle")
      .eq("season_id", seasonId)
      .eq("status", "verified")
      .limit(500);
    for (const r of ((claims ?? []) as Array<{ wallet: string; x_handle: string }>)) {
      if (r.wallet !== excludeWallet && normalizeXHandle(r.x_handle) === normalizedHandle) return true;
    }
    return false;
  } catch {
    // Fail closed: an unreadable check must not admit a duplicate.
    return true;
  }
}

async function ensureVerifiedIdentity(
  db: Db,
  claim: SocialClaimRow,
  normalized: string
): Promise<Outcome> {
  try {
    const { data: existing } = await db
      .from("airdrop_x_identities")
      .select("id,wallet,x_user_id,x_handle,status")
      .eq("season_id", claim.season_id)
      .eq("wallet", claim.wallet)
      .maybeSingle();
    const row = (existing as XIdentityRow | null) ?? null;
    if (row && normalizeXHandle(row.x_handle) !== normalized) {
      return { ok: false, error: WALLET_BOUND_ERROR, status: 409 };
    }
    if (row) {
      const { error } = await db
        .from("airdrop_x_identities")
        .update({
          x_user_id: claim.x_user_id,
          x_handle: claim.x_handle,
          x_profile_url: `https://x.com/${claim.x_handle.replace(/^@/, "")}`,
          status: "verified",
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) {
        if (isUniqueViolation(error)) return { ok: false, error: X_TAKEN_ERROR, status: 409 };
        return { ok: false, error: "could not verify X identity — retry review", status: 503 };
      }
      return { ok: true };
    }
    const { error } = await db.from("airdrop_x_identities").insert({
      season_id: claim.season_id,
      wallet: claim.wallet,
      x_user_id: claim.x_user_id,
      x_handle: claim.x_handle,
      x_profile_url: `https://x.com/${claim.x_handle.replace(/^@/, "")}`,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    if (error) {
      if (isUniqueViolation(error)) {
        // Lost a race: re-read and confirm the winner is us.
        const { data: winner } = await db
          .from("airdrop_x_identities")
          .select("wallet,x_handle,status")
          .eq("season_id", claim.season_id)
          .eq("wallet", claim.wallet)
          .maybeSingle();
        const w = winner as { wallet?: string; x_handle?: string; status?: string } | null;
        if (w && normalizeXHandle(w.x_handle ?? "") === normalized && w.status === "verified") {
          return { ok: true };
        }
        if (w && normalizeXHandle(w.x_handle ?? "") !== normalized) {
          return { ok: false, error: WALLET_BOUND_ERROR, status: 409 };
        }
        return { ok: false, error: X_TAKEN_ERROR, status: 409 };
      }
      return { ok: false, error: "could not verify X identity — retry review", status: 503 };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "could not verify X identity — retry review", status: 503 };
  }
}

/**
 * Idempotent review for one social claim, executed as ONE database
 * transaction via review_airdrop_social_claim_atomic: claim + SAME ledger
 * event + identity move together or all roll back. Never creates a second
 * reward row. Verified identity moves with the claim; revoking the wallet's
 * last verified claim revokes the identity too (history kept, never deleted).
 * Any failure is REPORTED (never a false success) so review can be retried.
 */
export async function reviewSocialClaim(
  db: Db,
  input: { claimId: string; decision: "verified" | "rejected"; reviewer: string; note?: string | null }
): Promise<Outcome> {
  const { claimId, decision, reviewer } = input;
  if (decision !== "verified" && decision !== "rejected") {
    return { ok: false, error: "invalid review", status: 400 };
  }
  let data: unknown;
  let error: unknown;
  try {
    const res = await db.rpc("review_airdrop_social_claim_atomic", {
      p_claim_id: claimId,
      p_decision: decision,
      p_reviewer: reviewer,
      p_note: (input.note ?? "").slice(0, 500) || null,
    });
    data = res.data;
    error = res.error;
  } catch {
    return { ok: false, error: "review failed — retry review", status: 503 };
  }
  if (!error) {
    const status = (data as { status?: string } | null)?.status;
    if (status === decision) return { ok: true };
    return { ok: false, error: "review failed — retry review", status: 503 };
  }
  return mapRpcError(error);
}

function mapRpcError(error: unknown): Outcome {
  const msg = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  if (/x-taken/i.test(msg)) return { ok: false, error: X_TAKEN_ERROR, status: 409 };
  if (/wallet-bound/i.test(msg)) return { ok: false, error: WALLET_BOUND_ERROR, status: 409 };
  if (/claim-not-found/i.test(msg)) return { ok: false, error: "claim not found", status: 404 };
  if (/invalid-decision/i.test(msg)) return { ok: false, error: "invalid review", status: 400 };
  return { ok: false, error: "review failed — retry review", status: 503 };
}
