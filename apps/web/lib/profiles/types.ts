export interface PublicProfile {
  wallet: string;
  username: string | null;
  avatarUrl: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalWonBaseUnits: string;
  displayRank: string;
  rankColorClass: string;
}
