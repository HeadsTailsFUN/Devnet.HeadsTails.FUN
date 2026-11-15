"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletState } from "@/components/wallet/WalletProvider";
import { AirdropTab, ReferralsTab } from "@/components/profile/ProfileModal";
import { CommunityIcon, SolanaIcon, WalletIcon } from "@/components/ui/icons";
import { useRewardResource } from "@/lib/airdrop/useRewardResource";
import type { PointsOverview } from "@/lib/airdrop/earn";
import { GAMEPLAY_DAILY_CAP, GAMEPLAY_LOSS_POINTS, GAMEPLAY_WIN_TOTAL, SOCIAL_CONNECT_X_POINTS, SOCIAL_REPOST_POINTS, SOCIAL_REPLY_POINTS } from "@/lib/airdrop/rules";
import { REFERRAL_INVITEE_ONCE, REFERRAL_REFERRER_ONCE, REFERRAL_PER_GAME } from "@/lib/referrals/logic";
import { VerificationQuests } from "./VerificationQuests";
import { EarnIcon } from "./EarnPointsLink";

const tabs = ["play", "invite", "quests"] as const;
type EarningTab = typeof tabs[number];
const tabIcons = { play: SolanaIcon, invite: CommunityIcon, quests: EarnIcon };
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

/** Shared rewards content; the existing game and wallet remain mounted behind it. */
export function EarnPointsContent({ onConnect, onPlay }: { onConnect: () => void; onPlay: () => void }) {
  const { wallet, account, restoring } = useWalletState();
  const address = account?.address ?? null;
  const [tab, setTab] = useState<EarningTab>("play");
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("earn_notice")?.startsWith("discord_")) setTab("quests");
  }, []);
  const tabList = useRef<HTMLDivElement>(null);
  const points = useRewardResource<PointsOverview>("/api/airdrop/points", wallet, account);
  const data = points.data;

  return <div className="earn-content">
      <section aria-label="Points overview" className="earn-overview glass rounded-[28px] p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Your Points</h2>
          <span className="earn-season">{data?.season ? data.season.replaceAll("_", " ") : "BETA POINTS"}</span>
        </div>
        {!address ? <div className="earn-guest">
          <span className="earn-icon-tile"><WalletIcon className="h-6 w-6" /></span>
          <div><h3 className="font-display text-xl font-semibold">Your next flip is just the beginning</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Connect your wallet to view verified Points, track your progress and share your invite link.</p>
          </div>
          <button type="button" onClick={onConnect} disabled={restoring} className="earn-primary">{restoring ? "Restoring wallet…" : "Connect Wallet"}</button>
        </div> : points.loading ? <div aria-label="Loading Points" role="status" className="earn-skeleton-grid"><span /><span /><span /><span /></div>
        : points.needsAuth ? <div className="earn-callout"><p>Verify wallet ownership to view your private Points and activity.</p>
          <button type="button" className="earn-primary" onClick={() => void points.reload(true)}>Verify wallet</button></div>
        : points.error ? <div role="alert" className="earn-callout"><p>{points.error}</p><button className="earn-secondary" onClick={() => void points.reload()}>Try again</button></div>
        : data ? <>
          <div className="earn-balances">
            <div><p className="earn-label"><span className="earn-dot" />Total Verified Points</p><p className="earn-total">{number(data.verifiedTotal)}</p><p className="earn-caption">Confirmed in your active season</p></div>
            <div className="earn-pending"><p className="earn-label">Pending Points</p><p className="earn-pending-total">{number(data.pendingTotal)}</p><p className="earn-caption">Awaiting review · excluded from verified total</p></div>
          </div>
          <div className="earn-progress-grid">
            <Progress label="Today's Gameplay Points" value={data.today.gameplay} max={data.today.gameplayCap} />
            <div><Progress label="Today's recurring Referral Points" value={data.today.referralRecurring} max={data.today.referralRecurringCap} accent="tails" />
              <p className="earn-caption mt-2">{number(data.today.referral)} total today, including qualification bonuses</p></div>
          </div>
          <p className="earn-caption mt-4">Daily limits reset at 00:00 UTC. Only eligible, verified rewards count.</p>
        </> : <p className="text-sm text-white/60">Preparing your Points…</p>}
      </section>

      <div ref={tabList} role="tablist" aria-label="Ways to earn" className="earn-tabs glass mt-6 grid grid-cols-3 gap-1 rounded-2xl p-1.5">
        {tabs.map((item, index) => { const Icon = tabIcons[item]; return <button key={item} type="button" id={`earn-tab-${item}`} role="tab"
          aria-selected={item === tab} aria-controls={`earn-panel-${item}`} tabIndex={item === tab ? 0 : -1}
          onClick={() => setTab(item)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
            setTab(tabs[next]); tabList.current?.querySelector<HTMLButtonElement>(`#earn-tab-${tabs[next]}`)?.focus();
          }}><Icon className="h-4 w-4" />{item.toUpperCase()}</button>; })}
      </div>
      {tabs.map(item => <section key={item} id={`earn-panel-${item}`} role="tabpanel" aria-labelledby={`earn-tab-${item}`} tabIndex={0} hidden={tab !== item} className="earn-panel glass mt-3 rounded-[28px] p-5 sm:p-7">
        {tab === item && (item === "play" ? <>
          <SectionHeading eyebrow="EVERY ELIGIBLE FLIP COUNTS" title="Play & Earn" description="Pick your side. Points arrive after an eligible match settles, whatever the outcome." />
          <div className="earn-rule-grid"><Reward title="Win a settled match" points={GAMEPLAY_WIN_TOTAL} /><Reward title="Lose a settled match" points={GAMEPLAY_LOSS_POINTS} /><div className="earn-rule-card"><p className="earn-label">Daily Gameplay cap</p><strong>{GAMEPLAY_DAILY_CAP}<small> Points</small></strong><p className="earn-caption">Same rewards in every room</p></div></div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><p className="max-w-lg text-sm text-white/60">Unsettled, cancelled, duplicate and excluded QA games do not earn Points. Eligibility and anti-abuse checks apply.</p><button type="button" className="earn-primary" onClick={onPlay}>Play Now <span aria-hidden="true">↗</span></button></div>
        </> : item === "invite" ? <>
          <SectionHeading eyebrow="GOOD FLIPS. BETTER TOGETHER." title="Invite Friends" description="Share your link. Your friend qualifies after 3 eligible settled matches." />
          <div className="earn-rule-grid mb-5"><Reward title="For the inviter" points={REFERRAL_REFERRER_ONCE} /><Reward title="For your friend" points={REFERRAL_INVITEE_ONCE} /><Reward title="Each eligible subsequent match" points={REFERRAL_PER_GAME} /></div>
          {address ? <ReferralsTab key={address} wallet={wallet} account={account} /> : <ConnectPrompt onConnect={onConnect} text="Connect your wallet to get your actual referral link and qualification progress." />}
        </> : <>
          <SectionHeading eyebrow="SHOW UP FOR THE COMMUNITY" title="Social Quests" description="Connect your accounts, verify community quests and submit X campaign activity for review. Opening X never awards Points." />
          <VerificationQuests onConnect={onConnect} onChanged={() => void points.reload()} />
          <h3 className="font-display mt-8 mb-4 text-xl font-semibold">X quests</h3>
          {address ? <div className="earn-quests"><AirdropTab key={address} wallet={wallet} account={account} questsOnly onChanged={() => void points.reload()} /></div>
            : <><div className="earn-rule-grid mb-5"><Reward title="Connect X account" points={SOCIAL_CONNECT_X_POINTS} /><Reward title="Repost eligible campaign" points={SOCIAL_REPOST_POINTS} /><Reward title="Reply to eligible campaign" points={SOCIAL_REPLY_POINTS} /></div><ConnectPrompt onConnect={onConnect} text="Connect and verify your wallet to check quest availability and submit evidence." /></>}
        </>)}
      </section>)}

      <section aria-labelledby="earn-activity-heading" className="glass mt-6 rounded-[28px] p-5 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3"><h2 id="earn-activity-heading" className="font-display text-xl font-semibold">Points Activity</h2>
          {address && data && <button className="earn-text-button" type="button" onClick={() => void points.reload()}>Refresh ↻</button>}</div>
        {!data ? <p className="earn-empty">{!address ? "Connect your wallet to view your recent rewards." : points.loading ? "Loading your reward history…" : "Verify your wallet or retry loading Points to see your activity."}</p>
          : !data.activity.length ? <div className="earn-empty"><EarnIcon className="mx-auto mb-3 h-6 w-6 text-[var(--heads)]" /><p>No Points activity yet</p><p className="earn-caption mt-1">Your eligible match, referral and quest rewards will appear here.</p></div>
          : <ul className="earn-activity-list">{data.activity.map(event => <li key={event.id}>
            <span aria-hidden="true" className="earn-activity-icon"><EarnIcon /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{activityLabel(event.eventType, event.category)}</p><time className="earn-caption" dateTime={event.date}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(event.date))} UTC</time></div>
            <span className={`earn-status earn-status-${event.status}`}>{event.status === "pending" ? "Pending Verification" : event.status === "verified" ? "Verified" : event.status === "rejected" ? "Rejected" : "Unavailable"}</span>
            <span className={`earn-activity-points ${event.status === "verified" ? "text-[var(--heads)]" : "text-white/50"}`}>{event.points > 0 ? "+" : ""}{number(event.points)}</span>
          </li>)}</ul>}
      </section>

      <aside className="earn-disclosure mt-6 rounded-2xl border border-white/10 px-5 py-4 text-xs leading-relaxed text-[var(--text-secondary)]">
        <h2 className="mb-2 font-semibold text-white/80">About Beta Points & the Airdrop</h2>
        <p>Verified Points are confirmed off-chain rewards. Pending Points await verification and are not confirmed rewards. HTS on Solana Devnet are separate test tokens with no asserted financial value.</p>
        <p className="mt-2">Points may contribute to potential future airdrop eligibility, subject to review and the final rules. They do not guarantee an allocation, token conversion rate or future token value.</p>
      </aside>
  </div>;
}

function Progress({ label, value, max, accent = "heads" }: { label: string; value: number; max: number; accent?: "heads" | "tails" }) {
  return <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="earn-label">{label}</p><span className="text-xs font-semibold tabular-nums">{number(value)} / {number(max)}</span></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(max, Math.max(0, value))} className="earn-progress"><span style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%`, background: `var(--${accent})` }} /></div></div>;
}
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-5"><p className="earn-eyebrow">{eyebrow}</p><h2 className="font-display mt-1 text-2xl font-semibold">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p></div>;
}
function Reward({ title, points }: { title: string; points: number }) {
  return <div className="earn-rule-card"><p className="earn-label">{title}</p><strong>+{points}<small> Points</small></strong><EarnIcon className="earn-rule-spark h-5 w-5" /></div>;
}
function ConnectPrompt({ text, onConnect }: { text: string; onConnect: () => void }) {
  return <div className="earn-callout"><p className="max-w-xl text-sm text-white/70">{text}</p><button type="button" className="earn-secondary" onClick={onConnect}>Connect Wallet</button></div>;
}
function activityLabel(event: string, category: string) {
  return ({ gameplay_match: "Settled match reward", gameplay_win_bonus: "Match win bonus", referral_game: "Referral match reward", referral_qualify_inviter: "Referral qualification", referral_qualify_invitee: "Welcome referral reward", social_connect_x: "Connect X account", social_repost: "Campaign repost", social_reply: "Campaign reply" } as Record<string, string>)[event]
    ?? ({ gameplay: "Match reward", win_bonus: "Win bonus", referral: "Referral reward", social: "Social Quest reward", adjustment: "Points adjustment" } as Record<string, string>)[category] ?? "Points reward";
}
