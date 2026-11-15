export const NEW_QUESTS = [
  { id: "telegram_group", title: "Join Telegram Group", points: 20, provider: "telegram" },
  { id: "telegram_channel", title: "Join Announcement Channel", points: 5, provider: "telegram" },
  { id: "discord_member", title: "Join Discord Server", points: 15, provider: "discord" },
  { id: "three_days", title: "Play on Three Different Days", points: 20, provider: "gameplay" },
] as const;
export type Quest = typeof NEW_QUESTS[number]["id"];
const yes = (name: string) => process.env[name] === "true";
const https = (raw: string | undefined) => {
  try { const url = new URL(raw ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};
export function earnConfig() {
  const bot = process.env.EARN_TELEGRAM_BOT_USERNAME ?? "";
  const group = process.env.EARN_TELEGRAM_GROUP_ID ?? "";
  const channel = process.env.EARN_TELEGRAM_CHANNEL_ID ?? "";
  const chatsValid = /^-\d{5,16}$/.test(group) && /^-\d{5,16}$/.test(channel) && group !== channel &&
    Number.isSafeInteger(Number(group)) && Number.isSafeInteger(Number(channel));
  return {
    enabled: yes("EARN_TELEGRAM_ENABLED"), linking: yes("EARN_TELEGRAM_LINKING_ENABLED"), jobs: yes("EARN_TELEGRAM_JOBS_ENABLED"),
    rewards: yes("EARN_NEW_REWARDS_ENABLED"), xManual: yes("EARN_X_MANUAL_VERIFICATION_ENABLED"),
    bot: /^[A-Za-z0-9_]{5,64}$/.test(bot) ? bot : null,
    groupId: chatsValid ? Number(group) : null, channelId: chatsValid ? Number(channel) : null,
    groupUrl: https(process.env.EARN_TELEGRAM_GROUP_URL), channelUrl: https(process.env.EARN_TELEGRAM_CHANNEL_URL),
    discord: yes("EARN_DISCORD_ENABLED"), discordGuild: /^\d{16,22}$/.test(process.env.EARN_DISCORD_GUILD_ID ?? "") ? process.env.EARN_DISCORD_GUILD_ID! : null,
    discordJoin: https(process.env.EARN_DISCORD_JOIN_URL),
    program: process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k",
    mint: process.env.NEXT_PUBLIC_HTS_TOKEN_MINT ?? "HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4",
  };
}
export function publicEarnConfig() {
  const c = earnConfig();
  return { quests: NEW_QUESTS, telegramConfigured: !!c.bot && !!c.groupId && !!c.channelId,
    telegramEnabled: c.enabled && c.linking, discordEnabled: c.discord, xManualEnabled: c.xManual,
    rewardsEnabled: c.rewards, groupUrl: c.groupUrl, channelUrl: c.channelUrl, discordJoinUrl: c.discordJoin };
}
