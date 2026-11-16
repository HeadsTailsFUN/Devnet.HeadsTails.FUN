import { randomBytes } from "node:crypto";
import { earnConfig, NEW_QUESTS, publicEarnConfig } from "./config";
import { activeSeason, dbClient, digest, dispatch, EarnError, failure, json, nonce, rate, readBody, seasonSettings, walletIdentity, xProfile } from "./server";
import { beginDiscord } from "./discord";
import type { RewardBlockReason } from "./telegram-feedback";

export async function earnAction(req: Request) {
  try {
    const wallet = await walletIdentity(req), body = await readBody(req), action = String(body.action ?? "");
    const db = dbClient(), c = earnConfig(), season = await activeSeason(db), settings = await seasonSettings(db, season.id);
    if (!["telegram_token", "telegram_group", "telegram_channel", "discord_connect", "unlink", "x_challenge", "x_submit", "three_days"].includes(action)) throw new EarnError("invalid_action");
    await rate(db, `wallet:${wallet}:${action}`, action === "unlink" ? 3 : action.endsWith("token") || action === "x_challenge" ? 5 : 10, 600);
    let result: Record<string, unknown>;
    if (action === "telegram_token") {
      if (!c.enabled || !c.linking || !c.bot || settings.telegram_linking !== true) throw new EarnError("telegram_unavailable", 503);
      const token = nonce(); result = await dispatch(db, "token", wallet, { provider: "telegram", digest: digest(token) });
      if (result.status === "created") result.deepLink = `https://t.me/${c.bot}?start=${token}`;
    } else if (action === "telegram_group" || action === "telegram_channel") {
      const chat = action === "telegram_group" ? "group" : "channel", id = chat === "group" ? c.groupId : c.channelId;
      if (!c.enabled || !c.jobs || !id || settings.telegram_jobs !== true) throw new EarnError("telegram_unavailable", 503);
      result = await dispatch(db, "telegram_job", wallet, { chat, chat_id: id });
    } else if (action === "discord_connect") {
      if (!c.discord || settings.discord_enabled !== true) throw new EarnError("discord_unavailable", 503);
      return beginDiscord(req, db, wallet);
    } else if (action === "unlink") {
      if (!["telegram", "discord", "x"].includes(String(body.provider))) throw new EarnError("invalid_provider");
      result = await dispatch(db, "wallet_unlink", wallet, { provider: body.provider });
    } else if (action === "x_challenge") {
      if (!c.xManual || settings.x_manual_enabled !== true) throw new EarnError("x_verification_unavailable", 503);
      const profile = xProfile(body.profileUrl);
      result = await dispatch(db, "x_challenge", wallet, { handle: profile.handle, profile_url: profile.profileUrl, code: `HTS-${randomBytes(12).toString("hex").toUpperCase()}` });
    } else if (action === "x_submit") {
      if (!c.xManual || settings.x_manual_enabled !== true) throw new EarnError("x_verification_unavailable", 503);
      if (typeof body.challengeId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.challengeId)) throw new EarnError("invalid_challenge");
      result = await dispatch(db, "x_submit", wallet, { challenge_id: body.challengeId });
    } else {
      result = await dispatch(db, "three_days", wallet, { program: c.program, mint: c.mint, award: c.rewards });
    }
    return json({ wallet, ...result });
  } catch (error) { return failure(error); }
}

export async function earnStatus(req: Request) {
  try {
    const wallet = await walletIdentity(req), db = dbClient(), c = earnConfig();
    const season = await activeSeason(db), settings = await seasonSettings(db, season.id);
    const [links, claims, jobs, identity, disconnect, challenges, days, administrator, exclusion] = await Promise.all([
      db.from("earn_social_links").select("provider,active,membership_status").eq("wallet", wallet),
      db.from("earn_quest_claims").select("quest,status,verified_at").eq("wallet", wallet).eq("season_id", season.id),
      db.from("earn_verification_jobs").select("job_id,chat,result_status,requested_at,expires_at,completed_at").eq("wallet", wallet).eq("season_id", season.id).order("requested_at", { ascending: false }).limit(10),
      db.from("airdrop_x_identities").select("x_handle,status").eq("wallet", wallet).eq("season_id", season.id).maybeSingle(),
      db.from("earn_social_disconnects").select("disconnected").eq("wallet", wallet).eq("provider", "x").maybeSingle(),
      db.from("earn_x_challenges").select("id,code,profile_url,expires_at,status,review_reason").eq("wallet", wallet).eq("season_id", season.id).order("created_at", { ascending: false }).limit(1),
      db.rpc("earn_three_day_progress", { p_wallet: wallet, p_season: season.id, p_program: c.program, p_mint: c.mint }),
      db.from("admin_members").select("wallet").eq("wallet", wallet).limit(1).maybeSingle(),
      db.from("reward_exclusions").select("wallet").eq("wallet", wallet).eq("active", true).limit(1).maybeSingle(),
    ]);
    if ([links, claims, jobs, identity, disconnect, challenges, days, administrator, exclusion].some(r => r.error)) throw new EarnError("verification_temporarily_unavailable", 503);
    const rewardBlockReason: RewardBlockReason = administrator.data ? "admin_account" : exclusion.data ? "reward_excluded"
      : (season.starts_at && Date.parse(season.starts_at) > Date.now()) || (season.ends_at && Date.parse(season.ends_at) <= Date.now()) ? "season_inactive" : null;
    // Evaluate retroactive gameplay eligibility when the authenticated owner opens Earn Points.
    // The existing ledger is credited atomically; no settlement or match writer is involved.
    if (!rewardBlockReason && Number(days.data) >= 3 && c.rewards && settings.new_rewards_enabled === true &&
      (settings.quest_flags as Record<string, boolean> | undefined)?.three_days === true &&
      !(claims.data ?? []).some(claim => claim.quest === "three_days" && claim.status === "verified")) {
      await dispatch(db, "three_days", wallet, { program: c.program, mint: c.mint, award: true });
      const updated = await db.from("earn_quest_claims").select("quest,status,verified_at").eq("wallet", wallet).eq("season_id", season.id);
      if (updated.error) throw new EarnError("verification_temporarily_unavailable", 503);
      claims.data = updated.data;
    }
    const connected = (provider: string) => (links.data ?? []).some(l => l.provider === provider && l.active);
    const flags = (settings.quest_flags ?? {}) as Record<string, boolean>;
    return json({ wallet, season: season.key, connections: { telegram: connected("telegram"), discord: connected("discord"),
      x: identity.data?.status === "verified" && disconnect.data?.disconnected !== true, xHandle: identity.data?.x_handle ?? null },
      capabilities: { telegramLink: c.enabled && c.linking && !!c.bot && settings.telegram_linking === true,
        telegramJobs: c.enabled && c.jobs && !!c.groupId && !!c.channelId && settings.telegram_jobs === true,
        discord: c.discord && settings.discord_enabled === true, xManual: c.xManual && settings.x_manual_enabled === true },
      // Verification can be exercised in staging while issuance remains off.
      newRewardsEnabled: c.rewards && settings.new_rewards_enabled === true,
      rewardBlockReason,
      quests: NEW_QUESTS.map(q => ({ ...q, active: flags[q.id] === true,
        claim: (claims.data ?? []).find(claim => claim.quest === q.id) ?? null,
        job: q.provider === "telegram" ? (jobs.data ?? []).find(job => job.chat === (q.id === "telegram_group" ? "group" : "channel")) ?? null : null })),
      gameplayDays: Math.min(3, Number(days.data) || 0), xChallenge: challenges.data?.[0] ?? null,
      discordMembership: (links.data ?? []).find(l => l.provider === "discord" && l.active)?.membership_status ?? null,
    });
  } catch (error) { return failure(error); }
}
export function earnCatalog() { return json(publicEarnConfig()); }
