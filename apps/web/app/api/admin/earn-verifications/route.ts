import { checkStaff, checkWebAdmin, adminDb } from "@/lib/admin/auth";
import { earnConfig } from "@/lib/earn/config";
import { activeSeason, dispatch, EarnError, failure, json, readBody, seasonSettings } from "@/lib/earn/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const staff = await checkStaff(req, false); if (!staff.ok) throw new EarnError("staff_required", staff.status ?? 403);
    const db = adminDb(); if (!db) throw new EarnError("temporarily_unavailable", 503);
    const season = await activeSeason(db), params = new URL(req.url).searchParams;
    const settings = await seasonSettings(db, season.id);
    const query = (params.get("query") ?? "").trim().toLowerCase().slice(0, 44), state = params.get("state") ?? "all";
    const [claims, challenges] = await Promise.all([
      db.from("airdrop_social_claims").select("id,wallet,task_type,x_handle,x_profile_url,evidence_url,campaign_url,status,review_state,created_at,reviewed_at,review_note,ownership_challenge_id,verification_method")
        .eq("season_id", season.id).order("created_at", { ascending: false }).limit(100),
      db.from("earn_x_challenges").select("id,code,expires_at,status,review_reason,created_at,claim_id").eq("season_id", season.id).order("created_at", { ascending: false }).limit(200),
    ]);
    if (claims.error || challenges.error) throw new EarnError("verification_not_installed", 503);
    const ids = (claims.data ?? []).map(c => c.id);
    const ledger = ids.length ? await db.from("airdrop_points_ledger").select("source_key,points,status,created_at,verified_at").eq("season_id", season.id).in("source_key", ids).limit(200) : { data: [], error: null };
    if (ledger.error) throw new EarnError("temporarily_unavailable", 503);
    const audit = ids.length ? await db.from("earn_verification_audit").select("related_ref,created_at,review_details")
      .eq("event", "x_review").in("related_ref", ids).order("created_at", { ascending: false }).limit(500) : { data: [], error: null };
    if (audit.error) throw new EarnError("temporarily_unavailable", 503);
    const rows = (claims.data ?? []).map(claim => {
      const challenge = (challenges.data ?? []).find(c => c.id === claim.ownership_challenge_id) ?? null;
      const reviewState = challenge && Date.parse(challenge.expires_at) <= Date.now() && challenge.status !== "verified" ? "expired"
        : claim.review_state ?? (claim.status === "verified" ? "approved" : claim.status);
      return { ...claim, reviewState, challenge, history: (challenges.data ?? []).filter(c => c.claim_id === claim.id),
        rewards: (ledger.data ?? []).filter(r => r.source_key === claim.id),
        reviews: (audit.data ?? []).filter(r => r.related_ref === claim.id),
        conflictWarning: "External identities remain reserved across wallets; inspect ownership and prior claim history before approval." };
    }).filter(c => (state === "all" || c.reviewState === state) && (!query || `${c.wallet} ${c.x_handle}`.toLowerCase().includes(query)));
    return json({ rows, active: earnConfig().xManual && settings.x_manual_enabled === true, limit: 100 });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin"); if (origin && origin !== new URL(req.url).origin) throw new EarnError("origin_denied", 403);
    const staff = await checkWebAdmin(req); if (!staff.ok) throw new EarnError("admin_required", staff.status ?? 403);
    if (!earnConfig().xManual) throw new EarnError("manual_verification_not_activated", 503);
    const body = await readBody(req), db = adminDb(); if (!db) throw new EarnError("temporarily_unavailable", 503);
    const season = await activeSeason(db), settings = await seasonSettings(db, season.id);
    if (settings.x_manual_enabled !== true) throw new EarnError("manual_verification_not_activated", 503);
    if (typeof body.claimId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.claimId) || !["verified", "rejected", "needs_review"].includes(String(body.decision))) throw new EarnError("invalid_review");
    if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) throw new EarnError("reason_required");
    return json(await dispatch(db, "x_review", staff.wallet!, { claim_id: body.claimId, decision: body.decision, reason: body.reason.trim(),
      ownership_confirmed: body.ownershipConfirmed === true, evidence_confirmed: body.evidenceConfirmed === true }));
  } catch (error) { return failure(error); }
}
