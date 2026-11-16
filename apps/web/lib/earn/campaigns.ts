import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SETTING_KEYS, campaignPostUrl, normalizeCampaignUrl } from "@/lib/airdrop/campaign";
import { EarnError } from "./server";

/** Read at request time so admin changes require no build or deployment. */
export async function readCampaignUrls(db: SupabaseClient) {
  const result = await db.from("site_settings").select("key,value").in("key", [...CAMPAIGN_SETTING_KEYS]);
  if (result.error) throw new EarnError("campaign_settings_unavailable", 503);
  const resolve = (key: string) => {
    const row = result.data?.find(r => r.key === key);
    return row ? normalizeCampaignUrl(row.value?.text) : campaignPostUrl();
  };
  return { reply: resolve(CAMPAIGN_SETTING_KEYS[0]), repost: resolve(CAMPAIGN_SETTING_KEYS[1]) };
}
