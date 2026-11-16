export const ACTIVITY_LABELS = {
  win: "Settled wins", loss: "Settled losses", referral_inviter: "Qualified referrals (inviter)",
  referral_invitee: "Referral qualification (invitee)", referral_recurring: "Recurring referral games",
  connect_x: "X account ownership", repost: "X reposts", reply: "X replies", telegram_group: "Telegram group",
  telegram_channel: "Telegram channel", discord_member: "Discord membership", three_days: "Three-day gameplay",
  telegram_connection: "Telegram connections", discord_connection: "Discord connections", adjustment: "Point adjustments", other: "Other recorded activity",
} as const;
export const ACTIVITY_STATES = ["all", "verified", "pending", "needs_review", "rejected", "expired", "unavailable", "in_progress", "connected", "disconnected"] as const;
export type ActivityUser = { wallet: string; username: string | null; xHandle: string | null; events: number; verified: number; pending: number; rejected: number; points: number; lastActivity: string | null; excluded: boolean;
  activities: Record<string, { events: number; verified: number; pending: number; points: number }> };
export type ActivityEvent = { id: string; activity: string; status: string; occurred_at: string; points: number; verified_points: number; source_type: string; source_key: string;
  details: { claimId?: string; xHandle?: string; profileUrl?: string; evidenceUrl?: string; campaignUrl?: string; reason?: string; checkStatus?: string; reviewedAt?: string } };
export type ActivityPage<T> = { rows: T[]; total: number; page: number; pageSize: number; activities?: Record<string, { events: number }> };
export type ActivityReport = ActivityPage<ActivityUser> & { season: string; summary: { users: number; events: number; verified: number; pending: number; points: number } };
export function activityLabel(value: string) { return ACTIVITY_LABELS[value as keyof typeof ACTIVITY_LABELS] ?? value; }
