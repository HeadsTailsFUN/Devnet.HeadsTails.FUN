/**
 * Authoritative room reconciler — pure decision layer (unit-tested).
 *
 * Critical semantic rule: closing the browser MUST NOT remove a legitimate
 * queued player. An Active entry backed by a consistent PlayerState is a
 * real queued player and MUST remain matchable (never auto-skipped), even
 * if the browser closed, the tab crashed, or RPC failed once.
 *
 * Safe automatic advancement: ONLY an existing queue-head entry whose
 * program-valid status is non-Active (Cancelled / Matched / consumed).
 * `advance_head_room` rejects Active heads on-chain, so the program is the
 * final authority; this layer only decides when to attempt it.
 */

export const MAX_ADVANCE_PER_SIDE = 10;
export const MAX_MATCHES_PER_RUN = 3;
export const MAX_HEAD_SCAN = 25;

export type HeadStatus =
  | "active"
  | "cancelled"
  | "matched"
  | "unknown-non-active"
  | "missing"
  | "unreadable-transient";

export function normalizeHeadStatus(raw: unknown): HeadStatus {
  if (raw === "transient") return "unreadable-transient";
  if (raw === null || raw === undefined) return "missing";
  const s = String(raw).toLowerCase();
  if (s === "active") return "active";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "matched" || s === "consumed" || s === "settled") return "matched";
  if (s === "") return "missing";
  return "unknown-non-active";
}

export type HeadAction =
  | { kind: "advance"; reason: string }
  | { kind: "keep-valid"; reason: string }
  | { kind: "retry-transient"; reason: string }
  | { kind: "invariant"; reason: string };

/**
 * Decide what to do with ONE queue head. Pure: no RPC, no signing.
 * - non-Active existing entry -> advance (permissionless hole skip)
 * - transient/unreadable -> retry, DO NOT mutate
 * - Active -> caller must verify PlayerState consistency before keep-valid;
 *   this function alone never declares an Active entry safe to skip.
 * - missing -> invariant (entry should exist when head < next); retry first
 *   at the call-site, then report.
 */
export function decideHeadAction(status: HeadStatus): HeadAction {
  switch (status) {
    case "cancelled":
      return { kind: "advance", reason: "cancelled head" };
    case "matched":
      return { kind: "advance", reason: "matched/consumed head" };
    case "unknown-non-active":
      return { kind: "advance", reason: "non-active head" };
    case "unreadable-transient":
      return { kind: "retry-transient", reason: "transient read; retry, do not mutate" };
    case "missing":
      return { kind: "invariant", reason: "head entry missing while head < next" };
    case "active":
      return { kind: "keep-valid", reason: "active head pending playerstate verification" };
  }
}

export interface PlayerConsistency {
  playerMatches: boolean;
  queued: boolean;
  sideMatches: boolean;
  sequenceMatches: boolean;
  tierMatches: boolean;
  notInMatch: boolean;
}

/** An Active head is legitimate ONLY when every consistency bit holds. */
export function isLegitimateQueuedPlayer(c: PlayerConsistency): boolean {
  return (
    c.playerMatches &&
    c.queued &&
    c.sideMatches &&
    c.sequenceMatches &&
    c.tierMatches &&
    c.notInMatch
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Bounded retry for transient RPC work: refetch → reconcile again. */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseMs?: number; isTransient?: (e: unknown) => boolean }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 4);
  const baseMs = opts?.baseMs ?? 500;
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const transient = opts?.isTransient ? opts.isTransient(e) : true;
      if (!transient || i === attempts - 1) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}
