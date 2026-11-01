import type { GameStateId, Side } from "@/lib/mockGameData";
import type { SelectionIntent } from "./selectionIntent";

/**
 * Intent-preserving presentation for FAILED background work.
 *
 * Once the user explicitly selects HEADS/TAILS, that choice is USER INTENT.
 * A transient failure (price feed, balance read, RPC hiccup, slow room
 * probe) must NOT flip the UI to error/neutral and hide Confirm. Chain-
 * proven positions (queued/matched/settled) always take precedence via the
 * normal refresh branches; this helper only covers the failure paths.
 */

/** The selected visual state for a pending intent, or null when none. */
export function intentSelectedState(intent: SelectionIntent | null): GameStateId | null {
  if (!intent) return null;
  return intent.side === "HEADS" ? "heads-selected" : "tails-selected";
}

/**
 * State to present when a background refresh FAILS while the user holds an
 * explicit selection with no chain position yet. Returns the intent side so
 * selection + Confirm stay visible; null when there is nothing to preserve
 * (caller falls back to the error state).
 */
export function failedRefreshState(args: {
  intent: SelectionIntent | null;
  hasChainPosition: boolean;
}): GameStateId | null {
  if (args.hasChainPosition) return null;
  return intentSelectedState(args.intent);
}

/**
 * SINGLE authoritative transition rule for every passive/background refresh
 * branch (the video-reset fix). Call this instead of writing a neutral state
 * directly:
 *
 * - pending intent + no chain position → the intent side stays visible,
 *   regardless of WHY the refresh cannot proceed (stale response, price or
 *   balance failure, RPC hiccup, unconfirmed room, missing config).
 * - otherwise → `fallback` (the branch's honest neutral/error state).
 *
 * Only explicitly terminal/user actions may clear a pending intent:
 * user-picked-other-side, user-changed-tier, join-success, explicit
 * cancel/back, play-again, wallet-disconnect, wallet-account-changed, or a
 * confirmed terminal join failure. Chain-proven positions always win via
 * their own branches.
 */
export function resolvePassiveSelectionView(args: {
  intent: SelectionIntent | null;
  hasChainPosition: boolean;
  fallback: GameStateId;
}): GameStateId {
  return (
    failedRefreshState({ intent: args.intent, hasChainPosition: args.hasChainPosition }) ??
    args.fallback
  );
}

/** Side recorded by an intent (test helper for intent-vs-UI consistency). */
export function intentSide(intent: SelectionIntent | null): Side | null {
  return intent?.side ?? null;
}

export interface PassiveResponse {
  /** Proposed neutral/background state the refresh computed. */
  proposedState: GameStateId;
  /** Why this response exists (trail + debugging). */
  reason: string;
  /** Epoch/tier/intent captured when this async response STARTED (null = unknown). */
  responseEpoch: number | null;
  responseTier: number | null;
  responseIntentId: number | null;
  /** Authoritative chain position observed by this response. */
  chainHasPosition: boolean;
}

export interface PassiveUiContext {
  intent: SelectionIntent | null;
  currentEpoch: number;
  currentTier: number;
  hasChainPosition: boolean;
}

export interface PassiveCommit {
  state: GameStateId;
  /** True when the response was stale relative to current UI context. */
  stale: boolean;
  /** True when a pending intent overrode the proposed neutral state. */
  preserved: boolean;
}

/**
 * ONE authoritative passive-state commit. Every background refresh branch
 * must commit neutral/error states through here instead of calling
 * setLiveState directly.
 *
 * 1. Staleness: a response started before a newer epoch, tier switch, or
 *    intent must not overwrite newer interactive state.
 * 2. Intent priority: pending intent + no chain position preserves
 *    HEADS/TAILS regardless of why the refresh cannot proceed.
 * 3. Otherwise the proposed state commits unchanged.
 */
export function commitPassiveState(
  response: PassiveResponse,
  ctx: PassiveUiContext
): PassiveCommit {
  const stale =
    (response.responseEpoch !== null && response.responseEpoch !== ctx.currentEpoch) ||
    (response.responseTier !== null && response.responseTier !== ctx.currentTier) ||
    (ctx.intent !== null &&
      response.responseIntentId !== null &&
      response.responseIntentId !== ctx.intent.intentId);
  if (stale) {
    const kept = intentSelectedState(ctx.intent);
    if (kept && !ctx.hasChainPosition && !response.chainHasPosition) {
      return { state: kept, stale: true, preserved: true };
    }
    return { state: response.proposedState, stale: true, preserved: false };
  }
  const kept = resolvePassiveSelectionView({
    intent: ctx.intent,
    hasChainPosition: ctx.hasChainPosition || response.chainHasPosition,
    fallback: response.proposedState,
  });
  return { state: kept, stale: false, preserved: kept !== response.proposedState };
}
