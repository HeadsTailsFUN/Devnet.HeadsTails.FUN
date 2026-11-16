export const CAMPAIGN_SETTING_KEYS = ["earn_x_reply_campaign_url", "earn_x_repost_campaign_url"] as const;
export function normalizeCampaignUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    const match = u.pathname.match(/^\/HeadsTailsFun\/status\/(\d{1,25})\/?$/i);
    if (u.protocol !== "https:" || !["x.com", "twitter.com"].includes(u.hostname) || u.username || u.password || u.port || !match) return null;
    return `https://x.com/HeadsTailsFun/status/${match[1]}`;
  } catch { return null; }
}
/** Legacy configuration fallback; server-side database settings take precedence. */
export function campaignPostUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL ?? process.env.AIRDROP_X_CAMPAIGN_URL ?? "";
  return normalizeCampaignUrl(raw);
}
