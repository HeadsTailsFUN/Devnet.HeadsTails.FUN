/**
 * Authoritative profile statistics from REAL indexed settled Matches only.
 * A Match counts only when the completed read model contains it — never
 * optimistic, never pending. Pending (unsettled) matches are simply absent
 * from the input rows and therefore never counted.
 */
export interface SettledMatchRow {
  winner_wallet: string;
  heads_wallet: string;
  tails_wallet: string;
  heads_amount: string;
  tails_amount: string;
}

export interface ProfileStats {
  games: number;
  wins: number;
  losses: number;
  totalWonBaseUnits: string;
}

export function countStats(rows: SettledMatchRow[], wallet: string): ProfileStats {
  let wins = 0;
  let won = BigInt(0);
  for (const r of rows) {
    if (r.winner_wallet === wallet) {
      wins += 1;
      try {
        won += BigInt(r.heads_amount) + BigInt(r.tails_amount);
      } catch {
        // ignore malformed amounts
      }
    }
  }
  const games = rows.length;
  return { games, wins, losses: Math.max(0, games - wins), totalWonBaseUnits: won.toString() };
}
