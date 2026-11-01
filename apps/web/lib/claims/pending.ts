export interface MatchView {
  matchId: string;
  state: string;
  headsPlayer: string;
  tailsPlayer: string;
  headsAmount: string;
  tailsAmount: string;
}

export type PendingCheck =
  | { kind: "win"; matchId: string; amountBaseUnits: string; result: "HEADS" | "TAILS" }
  | { kind: "none" };

/**
 * Authoritative unclaimed-win detection from chain state only.
 * PlayerState.in_match + fulfilled ORAO + computed winner == me + not settled.
 * Losers, settled matches and pending randomness yield no notification.
 */
export function detectUnclaimedWin(args: {
  inMatch: boolean;
  match: MatchView | null;
  fulfilled: boolean;
  resultBit: 0 | 1 | null;
  myWallet: string;
}): PendingCheck {
  if (!args.inMatch || !args.match || !args.fulfilled || args.resultBit === null) {
    return { kind: "none" };
  }
  if (args.match.state === "settled") return { kind: "none" };
  const result = args.resultBit === 0 ? "HEADS" : "TAILS";
  const winner = result === "HEADS" ? args.match.headsPlayer : args.match.tailsPlayer;
  if (winner !== args.myWallet) return { kind: "none" };
  let amount = "0";
  try {
    amount = (BigInt(args.match.headsAmount) + BigInt(args.match.tailsAmount)).toString();
  } catch {
    amount = "0";
  }
  return { kind: "win", matchId: args.match.matchId, amountBaseUnits: amount, result };
}
