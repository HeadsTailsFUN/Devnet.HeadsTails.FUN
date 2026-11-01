export type RankTier = "ROOKIE" | "PLAYER" | "VETERAN" | "LEGEND";

export interface RankStyle {
  tier: RankTier;
  /** Tailwind-ish username color class fragment (tasteful, no giant badges). */
  colorClass: string;
  label: string;
}

/** Exact games-played thresholds: 0–9 / 10–99 / 100–999 / 1000+. */
export function rankForGames(gamesPlayed: number): RankTier {
  const g = Math.max(0, Math.floor(gamesPlayed));
  if (g >= 1000) return "LEGEND";
  if (g >= 100) return "VETERAN";
  if (g >= 10) return "PLAYER";
  return "ROOKIE";
}

export function rankStyle(tier: RankTier): RankStyle {
  switch (tier) {
    case "LEGEND":
      return { tier, colorClass: "text-amber-300", label: "LEGEND" };
    case "VETERAN":
      return { tier, colorClass: "text-purple-300", label: "VETERAN" };
    case "PLAYER":
      return { tier, colorClass: "text-teal-200", label: "PLAYER" };
    default:
      return { tier: "ROOKIE", colorClass: "text-slate-200", label: "ROOKIE" };
  }
}

const VALID_OVERRIDE = new Set(["AUTO", "ROOKIE", "PLAYER", "VETERAN", "LEGEND"]);

/**
 * Display rank: manual override wins for LOOKS only; chain stats (games,
 * wins, order) are never affected. AUTO (or null) means chain-derived tier.
 */
export function displayRank(gamesPlayed: number, manualOverride: string | null): RankStyle {
  const o = (manualOverride ?? "AUTO").toUpperCase();
  if (o !== "AUTO" && VALID_OVERRIDE.has(o)) {
    return rankStyle(o as RankTier);
  }
  return rankStyle(rankForGames(gamesPlayed));
}

export function isValidRankOverride(v: unknown): boolean {
  return typeof v === "string" && VALID_OVERRIDE.has(v.toUpperCase());
}
