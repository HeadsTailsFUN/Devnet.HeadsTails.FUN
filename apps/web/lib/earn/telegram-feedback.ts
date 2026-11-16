export type RewardBlockReason = "admin_account" | "reward_excluded" | "season_inactive" | null;
export interface MembershipJob { result_status: string | null; expires_at: string; completed_at: string | null }
export const rewardBlockMessage = (reason: RewardBlockReason) => reason === "admin_account"
  ? "Administrator wallets are not eligible for Points. Membership verification still works; use a non-admin wallet to test rewards."
  : reason === "reward_excluded" ? "This wallet is excluded from Points rewards. Membership verification does not remove that restriction."
  : reason === "season_inactive" ? "The season is outside its reward period. No new Points can be issued." : null;

/** Membership evidence and a credited reward are separate, authoritative states. */
export function telegramFeedback(job: MembershipJob | null | undefined, claimed: boolean,
  options: { blocked: RewardBlockReason; rewardsEnabled: boolean; active: boolean; now?: number }) {
  if (claimed || !job) return null;
  if (!job.completed_at) return Date.parse(job.expires_at) > (options.now ?? Date.now())
    ? { label: "Pending Verification", message: "Waiting for the official bot to check membership. This page refreshes automatically while waiting.", pending: true, retry: false }
    : { label: "Verification expired", message: "The bot did not return a result before this request expired. Retry verification to create a new request.", pending: false, retry: true };
  if (job.result_status === "VERIFIED") {
    const blocked = rewardBlockMessage(options.blocked);
    return { label: blocked || !options.rewardsEnabled || !options.active ? "Membership verified" : "Reward not recorded",
      message: blocked ? `Membership confirmed by the official bot. ${blocked}`
        : !options.rewardsEnabled ? "Membership confirmed, but new quest rewards are disabled. No Points were issued."
        : !options.active ? "Membership confirmed, but this quest is inactive for the season. No Points were issued."
        : "Membership confirmed, but the Points record is missing. Retry verification; if this persists, contact support. No reward is shown as completed until it is saved.",
      pending: false, retry: !blocked && options.rewardsEnabled && options.active };
  }
  const messages: Record<string, [string, string]> = {
    NOT_MEMBER: ["Membership not found", "The official bot did not find an active membership. Join the official destination with your linked Telegram account, then retry."],
    PENDING: ["Membership approval pending", "Telegram reports that membership is still pending. Complete the join or approval process, then retry."],
    UNAVAILABLE: ["Verification unavailable", "The bot could not check membership with Telegram. No Points were issued. Please retry shortly."],
    ERROR: ["Verification failed", "The verification result failed validity checks or the bot reported an error. No Points were issued. Retry verification; reconnect Telegram if the problem persists."],
  };
  const [label, message] = messages[job.result_status ?? ""] ?? ["Verification failed", "No valid membership result was received. Please retry verification."];
  return { label, message, pending: false, retry: true };
}
