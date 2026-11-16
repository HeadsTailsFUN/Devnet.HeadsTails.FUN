import { checkStaff, checkWebAdmin, adminDb } from "@/lib/admin/auth";
import { earnConfig } from "@/lib/earn/config";
import { activeSeason, EarnError, failure, json, readBody, seasonSettings } from "@/lib/earn/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const staff = await checkStaff(req, false); if (!staff.ok) throw new EarnError("staff_required", staff.status ?? 403);
    const db = adminDb(); if (!db) throw new EarnError("temporarily_unavailable", 503);
    const season = await activeSeason(db), params = new URL(req.url).searchParams;
    const query = (params.get("query") ?? "").trim(), state = params.get("state") ?? "all", task = params.get("task") ?? "all";
    const page = Number(params.get("page") ?? 1), direction = params.get("direction") ?? "desc";
    if (query.length > 64 || !["all", "pending", "approved", "rejected", "expired", "needs_review"].includes(state) ||
      !["all", "connect_x", "reply", "repost"].includes(task) || !["asc", "desc"].includes(direction) || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw new EarnError("invalid_review_filter");
    const settings = await seasonSettings(db, season.id);
    const result = await db.rpc("admin_earn_activity_report", { p_season: season.id, p_query: query, p_activity: task, p_state: state,
      p_direction: direction, p_page: page, p_limit: 25, p_mode: "reviews" });
    if (result.error || !result.data) throw new EarnError("review_queue_unavailable", 503);
    return json({ ...result.data, active: true, canReview: staff.role === "OWNER" || staff.role === "FULL_ADMIN",
      newSubmissionsActive: earnConfig().xManual && settings.x_manual_enabled === true });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin"); if (origin && origin !== new URL(req.url).origin) throw new EarnError("origin_denied", 403);
    const staff = await checkWebAdmin(req); if (!staff.ok) throw new EarnError("admin_required", staff.status ?? 403);
    const body = await readBody(req), db = adminDb(); if (!db) throw new EarnError("temporarily_unavailable", 503);
    if (typeof body.claimId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.claimId) || !["verified", "rejected", "needs_review"].includes(String(body.decision))) throw new EarnError("invalid_review");
    if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) throw new EarnError("reason_required");
    const result = await db.rpc("admin_review_earn_claim", { p_claim: body.claimId, p_decision: body.decision, p_reviewer: staff.wallet!, p_reason: body.reason.trim(),
      p_ownership: body.ownershipConfirmed === true, p_evidence: body.evidenceConfirmed === true });
    if (result.error) {
      const message = result.error.message ?? "";
      if (/ownership-challenge-required|evidence-review-required/.test(message)) throw new EarnError("review_evidence_required", 409);
      if (/unknown-claim/.test(message)) throw new EarnError("not_found", 404);
      if (/ineligible|x-taken|wallet-bound/.test(message)) throw new EarnError("ineligible_or_identity_conflict", 409);
      throw new EarnError("review_could_not_be_saved", 503);
    }
    return json(result.data);
  } catch (error) { return failure(error); }
}
