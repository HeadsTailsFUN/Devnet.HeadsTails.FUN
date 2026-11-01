/** Configured official X campaign post, or null when not configured. */
export function campaignPostUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL ?? process.env.AIRDROP_X_CAMPAIGN_URL ?? "";
  const url = raw.trim();
  if (!url) return null;
  if (!/^https:\/\/(x\.com|twitter\.com)\//i.test(url)) return null;
  return url;
}
