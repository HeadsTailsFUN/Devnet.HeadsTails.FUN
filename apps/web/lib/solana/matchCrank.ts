/**
 * Server-side permissionless match crank (pure helpers; unit-tested).
 *
 * Devnet QA: the dedicated sponsor signer calls `matchNext` so users never
 * pay Match/ORAO costs and ORAO refunds return to the sponsor requester.
 * The program remains the sole authority on FIFO, players, Match PDA,
 * match id, ORAO seed, randomness, result and payout. The sponsor is only
 * the transaction caller/payer and chooses nothing.
 *
 * Client may only request "attempt matchmaking" (empty body). Every other
 * value (match id, players, PDAs, seed, treasury) is derived server-side
 * from authoritative chain reads. Extra client fields are ignored.
 */

export type CrankReadiness = "ready" | "empty" | "paused";

export function decideCrankReadiness(args: {
  paused: boolean;
  headsWaiting: bigint;
  tailsWaiting: bigint;
}): CrankReadiness {
  if (args.paused) return "paused";
  if (args.headsWaiting <= BigInt(0) || args.tailsWaiting <= BigInt(0)) return "empty";
  return "ready";
}

export interface QueueHeadView {
  side: number;
  sequence: bigint;
  /** Anchor decodes Rust variants camelCase (`active`); tolerate any case. */
  status: "Active" | "active" | "Cancelled" | "cancelled" | "Matched" | "matched" | string;
  player: string;
}

export interface PlayerView {
  address: string;
  player: string;
  queued: boolean;
  queuedSide: number;
  queuedSequence: bigint;
}

export interface FifoPlan {
  headsEntry: string;
  tailsEntry: string;
  headsState: string;
  tailsState: string;
  matchId: bigint;
}

export type FifoCheck = { ok: true; plan: FifoPlan } | { ok: false; reason: string };

/**
 * Pure FIFO validation mirroring the program's match_next head checks.
 * Proves the crank cannot reorder, skip, or substitute players: it only
 * proceeds when both current heads are Active, correctly sided, and backed
 * by matching queued PlayerStates.
 */
export function checkFifoPlan(args: {
  headsHead: bigint;
  tailsHead: bigint;
  totalMatches: bigint;
  headsEntry: QueueHeadView & { address: string };
  tailsEntry: QueueHeadView & { address: string };
  headsState: PlayerView;
  tailsState: PlayerView;
}): FifoCheck {
  const { headsEntry, tailsEntry, headsState, tailsState } = args;
  const headsStatus = headsEntry.status.toLowerCase();
  const tailsStatus = tailsEntry.status.toLowerCase();
  if (headsStatus !== "active") return { ok: false, reason: "heads head not active" };
  if (tailsStatus !== "active") return { ok: false, reason: "tails head not active" };
  if (headsEntry.side !== 0) return { ok: false, reason: "heads head wrong side" };
  if (tailsEntry.side !== 1) return { ok: false, reason: "tails head wrong side" };
  if (headsEntry.sequence !== args.headsHead) return { ok: false, reason: "heads sequence moved" };
  if (tailsEntry.sequence !== args.tailsHead) return { ok: false, reason: "tails sequence moved" };
  if (headsEntry.player === tailsEntry.player) return { ok: false, reason: "self match" };
  if (
    headsState.player !== headsEntry.player ||
    !headsState.queued ||
    headsState.queuedSide !== 0 ||
    headsState.queuedSequence !== args.headsHead
  ) {
    return { ok: false, reason: "heads player state mismatch" };
  }
  if (
    tailsState.player !== tailsEntry.player ||
    !tailsState.queued ||
    tailsState.queuedSide !== 1 ||
    tailsState.queuedSequence !== args.tailsHead
  ) {
    return { ok: false, reason: "tails player state mismatch" };
  }
  return {
    ok: true,
    plan: {
      headsEntry: headsEntry.address,
      tailsEntry: tailsEntry.address,
      headsState: headsState.address,
      tailsState: tailsState.address,
      matchId: args.totalMatches,
    },
  };
}

/** Client body fields are never trusted; only "attempt" is meaningful. */
export const CRANK_IGNORED_CLIENT_FIELDS = [
  "matchId",
  "match_id",
  "headsEntry",
  "tailsEntry",
  "headsState",
  "tailsState",
  "players",
  "player",
  "caller",
  "payer",
  "feePayer",
  "requester",
  "randomness",
  "seed",
  "treasury",
  "vrfTreasury",
  "amount",
  "sequence",
] as const;

export function sanitizeCrankRequest(body: unknown): { ignored: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ignored: [] };
  const ignored: string[] = [];
  for (const k of Object.keys(body as Record<string, unknown>)) {
    if ((CRANK_IGNORED_CLIENT_FIELDS as readonly string[]).includes(k)) ignored.push(k);
  }
  return { ignored };
}

/**
 * Short in-memory crank lock so simultaneous requests do not double-send.
 * Single-instance best-effort only; the program remains the final authority
 * (a lost race surfaces as a benign race error, never a user-facing failure).
 */
const locks = new Map<string, number>();
export const CRANK_LOCK_TTL_MS = 30_000;

export function tryAcquireCrankLock(key: string, nowMs = Date.now()): boolean {
  const held = locks.get(key);
  if (held !== undefined && nowMs - held < CRANK_LOCK_TTL_MS) return false;
  locks.set(key, nowMs);
  return true;
}

export function releaseCrankLock(key: string): void {
  locks.delete(key);
}

export function clearCrankLocksForTests(): void {
  locks.clear();
}

/**
 * Program-state race errors are benign: another caller matched first, so the
 * client should refresh into Match Found instead of seeing an error.
 * RPC/transient errors are NOT benign (caller may retry the crank).
 */
const BENIGN_RACE_PATTERNS = [
  "InvalidHeadEntry",
  "HeadNotActive",
  "HeadWrongSide",
  "EntryNotActive",
  "AlreadyMatched",
  "SelfMatch",
  "already been processed",
  "AlreadySettled",
];

export function isBenignRaceError(message: string): boolean {
  return BENIGN_RACE_PATTERNS.some((p) => message.includes(p));
}

export function isTransientCrankError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("Rate limit") ||
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("503") ||
    message.includes("timeout") ||
    message.includes("TIMEOUT")
  );
}
