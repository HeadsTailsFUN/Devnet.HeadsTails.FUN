"use client";

import { GAMEPLAY_DAILY_CAP, GAMEPLAY_LOSS_POINTS, GAMEPLAY_WIN_TOTAL, SOCIAL_CONNECT_X_POINTS, SOCIAL_REPOST_POINTS, SOCIAL_REPLY_POINTS } from "@/lib/airdrop/rules";
import { REFERRAL_QUALIFYING_GAMES, REFERRAL_INVITEE_ONCE, REFERRAL_REFERRER_ONCE, REFERRAL_PER_GAME, REFERRAL_MAX_PER_INVITEE_PER_DAY, REFERRAL_MAX_PER_REFERRER_PER_DAY } from "@/lib/referrals/logic";
import { NEW_QUESTS } from "@/lib/earn/config";

const rows = [
  { category: "Play", activity: "Eligible settled win", points: GAMEPLAY_WIN_TOTAL },
  { category: "Play", activity: "Eligible settled loss", points: GAMEPLAY_LOSS_POINTS },
  { category: "Invite", activity: "Qualified referral — inviter", points: REFERRAL_REFERRER_ONCE },
  { category: "Invite", activity: "Qualified referral — invited player", points: REFERRAL_INVITEE_ONCE },
  { category: "Invite", activity: "Each subsequent eligible referred match — inviter", points: REFERRAL_PER_GAME },
  { category: "X", activity: "Verified X account ownership", points: SOCIAL_CONNECT_X_POINTS },
  { category: "X", activity: "Approved campaign repost", points: SOCIAL_REPOST_POINTS },
  { category: "X", activity: "Approved campaign reply", points: SOCIAL_REPLY_POINTS },
  ...NEW_QUESTS.map(q => ({ category: q.provider === "telegram" ? "Telegram" : q.provider === "discord" ? "Discord" : "Challenge",
    activity: q.id === "three_days" ? "Eligible play on 3 different UTC dates" : q.id === "telegram_group" ? "Verified group membership" : q.id === "telegram_channel" ? "Verified announcement channel membership" : "Verified server membership", points: q.points })),
];

/** Presentation of existing rules only; never changes reward calculation or activation. */
export function PointsRules() {
  return <details className="earn-rules-disclosure">
    <summary><span>Points table & important rules</span><span className="earn-caption">12 activities <span aria-hidden="true">⌄</span></span></summary>
    <div className="earn-rules-body">
      <table className="earn-points-table">
        <caption className="sr-only">Complete Points rewards</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Activity</th><th scope="col">Points</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.activity}><td>{row.category}</td><th scope="row">{row.activity}</th><td>+{row.points}</td></tr>)}</tbody>
      </table>
      <ul className="earn-important-rules">
        <li><strong>Gameplay:</strong> only eligible, fully settled matches count. Cancelled, incomplete, duplicate and excluded games earn zero. Win +{GAMEPLAY_WIN_TOTAL}, loss +{GAMEPLAY_LOSS_POINTS}; all rooms use the same rate. Gameplay is capped at {GAMEPLAY_DAILY_CAP} Points per wallet per UTC day, resetting at 00:00 UTC.</li>
        <li><strong>Referrals:</strong> after the invited player completes {REFERRAL_QUALIFYING_GAMES} eligible settled matches, the inviter earns +{REFERRAL_REFERRER_ONCE} and the invited player +{REFERRAL_INVITEE_ONCE}, once. From match 4 onward, the inviter earns +{REFERRAL_PER_GAME} per eligible match. Existing caps apply: {REFERRAL_MAX_PER_INVITEE_PER_DAY} recurring match rewards per invited player per UTC day and {REFERRAL_MAX_PER_REFERRER_PER_DAY} recurring Points per inviter per UTC day. Qualification bonuses are separate from the recurring cap. Self-referrals and excluded activity do not qualify.</li>
        <li><strong>X:</strong> ownership requires an expiring code in your bio and manual approval. Repost/reply evidence must match the verified profile and the official campaign post. Opening X or submitting a URL never awards Points by itself.</li>
        <li><strong>New quests:</strong> group +20, channel +5, Discord +15 and three-day play +20 — <strong>{NEW_QUESTS.reduce((total, q) => total + q.points, 0)} Points total</strong>, each once per eligible account and season. Telegram and Discord membership do not require gameplay. Discord Membership Screening must be complete.</li>
        <li><strong>Three-day play:</strong> at least one eligible settled match on each of 3 distinct UTC dates in the current season. Days need not be consecutive; past eligible season matches count.</li>
        <li><strong>Verification:</strong> pending, failed or unavailable verification earns no confirmed Points. New quest rewards remain inactive until testing and activation are approved. No quiz or tutorial quest is included.</li>
      </ul>
    </div>
  </details>;
}
