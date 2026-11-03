import type { GameStateId, Side } from "@/lib/mockGameData";

/** A revealed result survives passive polls; a different wallet/round or explicit intent supersedes it. */
export function anchoredResultState(args: {
  state: GameStateId;
  result: { wallet: string; matchId: string; iWon: boolean } | null;
  wallet: string | null;
  activeMatchId: string | null;
  hasNewIntent: boolean;
}): GameStateId {
  const r=args.result;
  if (!r || r.wallet!==args.wallet || args.hasNewIntent ||
      (args.activeMatchId!==null && args.activeMatchId!==r.matchId) ||
      ["joining","queued-heads","queued-tails"].includes(args.state)) return args.state;
  return r.iWon ? "win" : "loss";
}

/** Explain known access denials without reflecting arbitrary backend errors. */
export function networkFeePreparationMessage(reason?: string): string {
  if (reason === "Restricted QA access only") {
    return "This wallet is not enabled for restricted testing. Use an approved QA wallet.";
  }
  if (reason === "Verify wallet ownership" || reason === "Verify wallet ownership for restricted QA" ||
      reason === "Connected wallet does not match verified session") {
    return "Verify your connected wallet before preparing Devnet network fees.";
  }
  return "Network fee preparation unavailable. Try again in a moment.";
}

/**
 * Local-intent epoch guard: a stale async refresh must NEVER clear a newer
 * user side selection.
 *
 * Each refresh captures (epoch, selectedSide) at start. Before committing a
 * `ready`/selection UI state, the committer must call this. Chain-proven
 * position states (queued/matched/settled) always win regardless.
 */
export function shouldCommitSelectionRefresh(args: {
  startEpoch: number;
  currentEpoch: number;
  selAtStart: Side | null;
  selNow: Side | null;
  chainHasPosition: boolean;
}): boolean {
  if (args.chainHasPosition) return true;
  if (args.currentEpoch !== args.startEpoch) return false;
  if (args.selNow !== args.selAtStart) return false;
  return true;
}

/**
 * Play Again lifecycle (auto-settlement): only after settlement is observed
 * on-chain. While randomness is fulfilled but unsettled, the UI shows the
 * Finalizing payout/match line + optional server-side Retry payout — never
 * a wallet Claim/Settle transaction. `claimPending` here means
 * auto-settlement still pending.
 */
export function playAgainReady(args: {
  isWinOrLoss: boolean;
  claimPending: boolean;
  settledObserved: boolean;
}): boolean {
  return args.isWinOrLoss && !args.claimPending && args.settledObserved;
}

/** Queue position line: simple game language. Never invent a number. */
export function queuePositionText(
  side: Side,
  position: number | null | undefined
): string {
  void side;
  if (typeof position === "number" && Number.isFinite(position) && position >= 1) {
    return `#${position} In Queue`;
  }
  return "In Queue";
}
