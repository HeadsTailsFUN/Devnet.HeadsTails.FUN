import { displayRank } from "@/lib/ranks";

export type LeaderboardTab = "wins" | "played";

export interface LeaderboardRow {
  wallet: string;
  username: string | null;
  avatarUrl: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  displayRank: string;
  rankColorClass: string;
}

export interface StatsInput {
  wallet: string;
  games_played: number;
  wins: number;
  losses: number;
  username?: string | null;
  avatar_path?: string | null;
  manual_rank_override?: string | null;
}

/** Pure row mapping: chain stats in, display rank attached. No mock users. */
export function toLeaderboardRow(
  s: StatsInput,
  avatarUrlFor: (path: string | null | undefined) => string | null
): LeaderboardRow {
  const style = displayRank(s.games_played, s.manual_rank_override ?? null);
  return {
    wallet: s.wallet,
    username: s.username ?? null,
    avatarUrl: avatarUrlFor(s.avatar_path),
    gamesPlayed: s.games_played,
    wins: s.wins,
    losses: s.losses,
    displayRank: style.label,
    rankColorClass: style.colorClass,
  };
}

export function shortWallet(w: string): string {
  return w.length > 8 ? `${w.slice(0, 3)}…${w.slice(-4)}` : w;
}

/** HT-QA-009: count-aware labels — 0 wins, 1 win, 2 wins (same for games). */
export function pluralize(count: number, singular: string, plural?: string): string {
  const p = plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : p}`;
}

export function winsLabel(count: number): string {
  return pluralize(count, "win");
}

export function gamesLabel(count: number): string {
  return pluralize(count, "game");
}
