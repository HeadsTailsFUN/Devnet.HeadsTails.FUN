import type { SupabaseClient } from "@supabase/supabase-js";
import { earnConfig } from "./config";
import { readCampaignUrls } from "./campaigns";
import { EarnError, xPost } from "./server";

/** Guards the legacy entry points when the new manual-ownership flow is activated. */
export async function guardXSubmission(db: SupabaseClient, season: string, wallet: string, task: string, evidence: unknown, expectedCampaign?: unknown) {
  if (!earnConfig().xManual) return null;
  if (task === "connect_x") throw new EarnError("use_follow_submission", 409);
  const [identity, optOut] = await Promise.all([
    db.from("airdrop_x_identities").select("x_handle,status").eq("wallet", wallet).eq("season_id", season).maybeSingle(),
    db.from("earn_social_disconnects").select("disconnected").eq("wallet", wallet).eq("provider", "x").maybeSingle(),
  ]);
  if (identity.error || optOut.error) throw new EarnError("temporarily_unavailable", 503);
  if (identity.data?.status !== "verified" || optOut.data?.disconnected) throw new EarnError("approved_x_profile_required", 409);
  const urls = await readCampaignUrls(db);
  const campaign = xPost(task === "reply" ? urls.reply : urls.repost);
  if (expectedCampaign !== undefined && xPost(expectedCampaign)?.url !== campaign?.url) throw new EarnError("campaign_changed_reload", 409);
  // A normal repost has no separate author-owned post URL. Staff checks the profile and target post.
  const proof = xPost(task === "repost" && !evidence ? campaign?.url : evidence);
  if (!proof || !campaign) throw new EarnError("campaign_evidence_required", 409);
  if (task === "reply" && proof.handle !== identity.data.x_handle.toLowerCase()) throw new EarnError("reply_author_mismatch", 409);
  if (task === "repost" && proof.handle !== identity.data.x_handle.toLowerCase() && proof.url !== campaign.url) throw new EarnError("repost_evidence_mismatch", 409);
  return { campaignUrl: campaign.url, evidenceUrl: proof.url };
}
