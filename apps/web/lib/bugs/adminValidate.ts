import { BUG_SEVERITIES } from "./validate";

export const BUG_STATUS_VALUES = [
  "new",
  "triaged",
  "needs_info",
  "accepted",
  "duplicate",
  "rejected",
  "resolved",
  "rewarded",
] as const;

export const REWARD_TYPES = ["none", "project_token", "sol"] as const;
export const BOUNTY_STATUS_VALUES = ["none", "approved", "paid"] as const;

export function isBugStatus(s: unknown): boolean {
  return typeof s === "string" && (BUG_STATUS_VALUES as readonly string[]).includes(s);
}

export function isRewardType(s: unknown): boolean {
  return typeof s === "string" && (REWARD_TYPES as readonly string[]).includes(s);
}

export function isBountyStatus(s: unknown): boolean {
  return typeof s === "string" && (BOUNTY_STATUS_VALUES as readonly string[]).includes(s);
}

export function isAdminSeverity(s: unknown): boolean {
  return typeof s === "string" && (BUG_SEVERITIES as readonly string[]).includes(s);
}

export function isTxSignature(s: unknown): boolean {
  return (
    typeof s === "string" &&
    s.trim().length >= 80 &&
    s.trim().length <= 100 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s.trim())
  );
}

export function validateTriageInput(
  body: Record<string, unknown>
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!isBugStatus(body.status)) return { ok: false, error: "invalid status" };
    patch.status = body.status;
  }
  if (body.admin_severity !== undefined) {
    if (!isAdminSeverity(body.admin_severity)) return { ok: false, error: "invalid admin severity" };
    patch.admin_severity = body.admin_severity;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== "string") return { ok: false, error: "invalid note" };
    patch.admin_notes = body.note.slice(0, 2000);
  }
  if (Object.keys(patch).length <= 1) return { ok: false, error: "nothing to update" };
  return { ok: true, patch };
}

export function validateBountyInput(
  body: Record<string, unknown>
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};
  if (body.reward_type !== undefined) {
    if (!isRewardType(body.reward_type)) return { ok: false, error: "invalid reward_type" };
    patch.reward_type = body.reward_type;
  }
  const status = (body.bounty_status ?? body.status) as unknown;
  if (status !== undefined) {
    if (!isBountyStatus(status)) return { ok: false, error: "invalid bounty status" };
    if (status === "paid") return { ok: false, error: "use payout action to mark paid" };
    patch.status = status;
  }
  for (const k of ["suggested_usd_min", "suggested_usd_max"] as const) {
    if (body[k] !== undefined && body[k] !== null) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `invalid ${k}` };
      patch[k] = n;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
  return { ok: true, patch };
}

export function validatePayoutInput(
  body: Record<string, unknown>
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const rewardType = body.reward_type as unknown;
  if (rewardType !== "sol" && rewardType !== "project_token") {
    return { ok: false, error: "reward_type must be sol or project_token to mark paid" };
  }
  const amountRaw = body.reward_amount_base_units as unknown;
  const amount = typeof amountRaw === "string" ? amountRaw.trim() : "";
  if (!amount || !/^[1-9][0-9]*$/.test(amount)) {
    return { ok: false, error: "positive reward_amount_base_units required" };
  }
  if (!isTxSignature(body.payout_signature)) {
    return { ok: false, error: "payout_signature (transaction signature) required" };
  }
  if (rewardType === "project_token") {
    if (typeof body.reward_mint !== "string" || !body.reward_mint.trim()) {
      return { ok: false, error: "reward_mint required for project_token payouts" };
    }
  }
  const patch: Record<string, unknown> = {
    reward_type: rewardType,
    status: "paid",
    reward_amount_base_units: amount,
    payout_signature: (body.payout_signature as string).trim(),
    paid_at: new Date().toISOString(),
  };
  if (typeof body.reward_mint === "string" && body.reward_mint.trim()) {
    patch.reward_mint = body.reward_mint.trim();
  }
  return { ok: true, patch };
}
