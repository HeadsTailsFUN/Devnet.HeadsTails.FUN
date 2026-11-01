import type { Side } from "@/lib/mockGameData";

/**
 * Cancel-target resolution: V2 room position vs legacy global position.
 *
 * Background: pre-V2 queued PlayerStates are 60-byte V1 accounts. The
 * compat decoder normalizes a queued V1 position to queuedTierUsd=1, so a
 * tier value ALONE cannot distinguish "V2 $1 room" from "legacy global".
 * Deterministic detection therefore uses:
 *   1. the account schema (V1 60-byte layout is always legacy), then
 *   2. verification that the expected exact queue PDA exists (covers a
 *      post-migration V2-layout account whose entry still lives at the
 *      legacy PDA).
 *
 * Legacy support is CANCEL/EXIT-ONLY: no code path here (or anywhere in
 * the product) may derive legacy Join or legacy Match instructions.
 */

export type CancelKind = "room" | "legacy";

export interface CompatQueueView {
  schema: "v1" | "v2";
  queuedTierUsd: number;
  queuedSide: number;
  queuedSequence: bigint;
}

export interface CancelTarget {
  kind: CancelKind;
  /** Room tier for room cancels; undefined for legacy. */
  tierUsd?: 1 | 10;
}

/** Pure first-pass classification (no RPC). Existence is verified later. */
export function classifyCancelTarget(st: CompatQueueView): CancelTarget | null {
  if (st.schema === "v1") return { kind: "legacy" };
  if (st.queuedTierUsd === 1) return { kind: "room", tierUsd: 1 };
  if (st.queuedTierUsd === 10) return { kind: "room", tierUsd: 10 };
  return null;
}

/** Anchor method name for the cancel instruction of a resolved target. */
export function cancelMethodFor(target: CancelTarget): "cancelQueueEntryRoom" | "cancelQueueEntry" {
  return target.kind === "room" ? "cancelQueueEntryRoom" : "cancelQueueEntry";
}

export function sideLabel(side: number): Side {
  return side === 0 ? "HEADS" : "TAILS";
}
