import { adminDb, checkStaff } from "@/lib/admin/auth";
import { ACTIVITY_LABELS, ACTIVITY_STATES } from "@/lib/earn/admin-report-config";
import { activeSeason, EarnError, failure, json } from "@/lib/earn/server";
import { isValidWallet } from "@/lib/solana/sponsorGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const staff = await checkStaff(req, false);
    if (!staff.ok) throw new EarnError("staff_required", staff.status ?? 403);
    const db = adminDb(); if (!db) throw new EarnError("temporarily_unavailable", 503);
    const params = new URL(req.url).searchParams;
    const mode = params.get("mode") ?? "users", activity = params.get("activity") ?? "all", state = params.get("state") ?? "all";
    const sort = params.get("sort") ?? "events", direction = params.get("direction") ?? "desc";
    const query = (params.get("query") ?? "").trim(), wallet = params.get("wallet");
    const page = Number(params.get("page") ?? 1), limit = Number(params.get("pageSize") ?? 25);
    if (!["users", "events"].includes(mode) || (activity !== "all" && !Object.hasOwn(ACTIVITY_LABELS, activity)) ||
      !ACTIVITY_STATES.some(s => s === state) || !["events", "verified", "pending", "points", "last_activity"].includes(sort) ||
      !["asc", "desc"].includes(direction) || query.length > 64 || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (wallet !== null && !isValidWallet(wallet)) || (mode === "events" && !wallet)) throw new EarnError("invalid_report_filter");
    const dates = [params.get("from"), params.get("to")].map(value => {
      if (!value) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new EarnError("invalid_report_date");
      return new Date(`${value}T00:00:00Z`);
    });
    if (dates[0] && dates[1] && dates[0] > dates[1]) throw new EarnError("invalid_report_date");
    const season = await activeSeason(db);
    const result = await db.rpc("admin_earn_activity_report", { p_season: season.id, p_query: query, p_activity: activity, p_state: state,
      p_sort: sort, p_direction: direction, p_page: page, p_limit: limit, p_wallet: wallet,
      p_from: dates[0]?.toISOString() ?? null, p_to: dates[1] ? new Date(dates[1].getTime() + 86400000).toISOString() : null, p_mode: mode });
    if (result.error || !result.data) throw new EarnError("activity_report_unavailable", 503);
    return json({ ...result.data, season: season.key });
  } catch (error) { return failure(error); }
}
