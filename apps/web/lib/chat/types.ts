export interface ChatMessageView {
  id: string;
  wallet: string;
  username: string | null;
  avatarUrl: string | null;
  displayRank: string;
  rankColorClass: string;
  body: string;
  createdAt: string;
}
