import type { Side } from "@/lib/mockGameData";

/**
 * Local side-selection intent lock (selection-reset race fix).
 *
 * Once the user explicitly selects HEADS/TAILS, that intent is authoritative
 * until ONE of: user picks the other side, user cancels, Join succeeds,
 * Join returns a terminal error requiring reset, room switches (intentional
 * reset), or chain proves queue/match entry. A stale background refresh must
 * NEVER reset HEADS_SELECTED/TAILS_SELECTED back to Ready.
 */

export type IntentReason =
  | "user-pick"
  | "user-cancel"
  | "join-success"
  | "join-terminal-error"
  | "room-switch"
  | "chain-proven";

export interface SelectionIntent {
  side: Side;
  /** Monotonic id so late async responses can be ignored. */
  intentId: number;
  /** Room (tier) the intent belongs to; cross-room responses are stale. */
  tierUsd: number;
  /** Epoch at creation (pairs with the older epoch guard). */
  epoch: number;
}

let nextId = 1;

export function createIntent(side: Side, tierUsd: number, epoch: number): SelectionIntent {
  return { side, intentId: nextId++, tierUsd, epoch };
}

/**
 * Decide whether an async refresh may clear/replace the current intent.
 * Returns true only when the response is for the SAME room AND same-or-newer
 * intent AND chain has NOT proven a position (chain-proven states always win
 * via a separate explicit clear).
 */
export function mayClearIntentForRefresh(args: {
  intent: SelectionIntent | null;
  responseTierUsd: number;
  responseIntentId: number | null;
  chainHasPosition: boolean;
}): boolean {
  if (args.chainHasPosition) return true;
  if (!args.intent) return true;
  if (args.responseTierUsd !== args.intent.tierUsd) return false;
  if (args.responseIntentId !== null && args.responseIntentId !== args.intent.intentId) {
    return false;
  }
  return false;
}

/** Explicit terminal transitions that ARE allowed to clear the intent. */
export function shouldClearIntentOn(reason: IntentReason): boolean {
  switch (reason) {
    case "user-cancel":
    case "join-success":
    case "join-terminal-error":
    case "room-switch":
    case "chain-proven":
      return true;
    case "user-pick":
      return false;
  }
}
