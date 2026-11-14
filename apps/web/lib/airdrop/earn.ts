import type { SupabaseClient } from "@supabase/supabase-js";
import { GAMEPLAY_DAILY_CAP, utcDayKey } from "./rules";
import { REFERRAL_MAX_PER_REFERRER_PER_DAY } from "../referrals/logic";

export interface PointsLedgerRow {
  id: string;
  category: string;
  event_type: string;
  points: number;
  status: string;
  created_at: string;
  metadata?: { event_day?: string } | null;
}

/** Page through the existing ledger: PostgREST's default row limit is not a total. */
export async function readPointsLedger(db: SupabaseClient, season: string, wallet: string) {
  const rows: PointsLedgerRow[] = [];
  const pageSize = 500;
  const readStartedAt = new Date().toISOString();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("airdrop_points_ledger")
      .select("id,category,event_type,points,status,created_at,metadata")
      .eq("season_id", season).eq("wallet", wallet)
      .lte("created_at", readStartedAt)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("Points ledger unavailable");
    const page = (data ?? []) as PointsLedgerRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Mirrors the actual cap definitions, including delayed gameplay settlement. */
export function pointsDetails(rows: PointsLedgerRow[], now = new Date()) {
  const day = utcDayKey(now);
  const verified = rows.filter(row => row.status === "verified");
  const gameplay = verified.filter(row =>
    ["gameplay", "win_bonus"].includes(row.category) &&
    (row.metadata?.event_day ?? row.created_at.slice(0, 10)) === day);
  const referrals = verified.filter(row => row.category === "referral" && row.created_at.slice(0, 10) === day);
  const sum = (list: PointsLedgerRow[]) => list.reduce((total, row) => total + Number(row.points), 0);
  return {
    today: {
      day, gameplay: sum(gameplay), gameplayCap: GAMEPLAY_DAILY_CAP,
      referral: sum(referrals),
      referralRecurring: sum(referrals.filter(row => row.event_type === "referral_game")),
      referralRecurringCap: REFERRAL_MAX_PER_REFERRER_PER_DAY,
    },
    // Explicit allowlist: never send raw metadata (which can contain other wallets).
    activity: [...rows].filter(row => row.points !== 0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, 12).map(row => ({
        id: row.id, category: row.category, eventType: row.event_type,
        points: Number(row.points), status: row.status, date: row.created_at,
      })),
  };
}

export type PointsDetails = ReturnType<typeof pointsDetails>;
export interface PointsOverview extends PointsDetails {
  season: string;
  verifiedTotal: number;
  pendingTotal: number;
  campaignUrl: string | null;
  socialAvailable: boolean;
}
