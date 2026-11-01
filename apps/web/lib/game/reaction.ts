export function reactionAsset(
  side: "HEADS" | "TAILS",
  win: boolean,
  ordinal: number,
): string {
  const names =
    side === "HEADS"
      ? win
        ? ["HeadFirstWin", "HeadSecondWin", "HeadThirdWin", "HeadFourthWin"]
        : ["HeadLose"]
      : win
        ? ["TailFirstWin", "TailSecondWin"]
        : ["TailFirstLose", "TailsSecondLose"];
  // Confirmed chronological counts saturate at the final supplied asset.
  const safeOrdinal =
    Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1;
  return `/assets/emotions/${names[Math.min(names.length - 1, safeOrdinal - 1)]}.png`;
}
export const WIN_PHRASES = [
  "GG!",
  "YOU WON!",
  "BIG W!",
  "CLEAN FLIP!",
  "THAT'S A WIN!",
  "WINNER TAKES ALL!",
];
export const LOSS_PHRASES = [
  "BETTER LUCK NEXT TIME!",
  "GG, NEXT ROUND!",
  "NOT YOUR FLIP!",
  "CLOSE ONE!",
  "RUN IT BACK!",
  "NEXT FLIP, NEW CHANCE!",
];
