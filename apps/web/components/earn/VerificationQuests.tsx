"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletState } from "@/components/wallet/WalletProvider";
import { TelegramIcon, DiscordIcon, XIcon } from "@/components/ui/icons";
import { useRewardResource } from "@/lib/airdrop/useRewardResource";
import { NEW_QUESTS, type Quest } from "@/lib/earn/config";
import { EarnIcon } from "./EarnPointsLink";

interface QuestState { id: Quest; active: boolean; claim: { status: string } | null;
  job: { result_status: string | null; expires_at: string; completed_at: string | null } | null }
export interface VerificationState {
  wallet: string; connections: { telegram: boolean; discord: boolean; x: boolean; xHandle: string | null };
  capabilities: { telegramLink: boolean; telegramJobs: boolean; discord: boolean; xManual: boolean };
  quests: QuestState[]; gameplayDays: number;
  newRewardsEnabled?: boolean;
  discordMembership: string | null;
  xChallenge: { id: string; code: string; profile_url: string; expires_at: string; status: string; review_reason: string | null } | null;
}
interface Catalog { groupUrl: string | null; channelUrl: string | null; discordJoinUrl: string | null; rewardsEnabled: boolean;
  telegramEnabled?: boolean; discordEnabled?: boolean; xManualEnabled?: boolean }

async function action(body: Record<string, unknown>) {
  const r = await fetch("/api/earn/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(String(result.message ?? "Verification is temporarily unavailable"));
  return result;
}

export function VerificationQuests({ onConnect, onChanged }: { onConnect: () => void; onChanged: () => void }) {
  const { wallet, account } = useWalletState();
  const state = useRewardResource<VerificationState>("/api/earn/status", wallet, account);
  const reloadStatus = state.reload;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<{ wallet: string; url: string; expires: number } | null>(null);
  const currentLink = deepLink?.wallet === account?.address ? deepLink : null;
  const refreshedAward = useRef<string | null>(null);
  useEffect(() => {
    const messages: Record<string, string> = {
      discord_verified: "Discord membership verified. Points require an active quest and account eligibility.",
      discord_not_member: "Discord connected, but server membership was not found. Join the official server, then verify again.",
      discord_pending: "Discord verification is pending. Finish Membership Screening if requested, then retry.",
      discord_denied: "Discord authorization was cancelled. You can retry whenever you are ready.",
      discord_rate_limited: "Discord is rate limiting requests. Please wait and retry verification.",
      discord_invalid_state: "Discord authorization expired or your wallet session changed. Start a new connection.",
      discord_conflict: "This Discord account is already bound to another wallet. No reward was issued.",
      discord_unavailable: "Discord could not confirm membership. No new reward was issued; please retry.",
    };
    const url = new URL(window.location.href), notice = url.searchParams.get("earn_notice");
    if (!notice || !messages[notice]) return;
    setNote(messages[notice]); url.searchParams.delete("earn_notice");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    if (!currentLink) return;
    const timer = setTimeout(() => setDeepLink(null), Math.max(0, currentLink.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [currentLink]);
  useEffect(() => {
    const completed = state.data?.quests.find(q => q.id === "three_days")?.claim?.status === "verified";
    if (!completed || !account || refreshedAward.current === account.address) return;
    refreshedAward.current = account.address; onChanged();
  }, [account, state.data, onChanged]);
  const loadCatalog = () => {
    setCatalogError(false);
    return fetch("/api/earn/catalog", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setCatalog).catch(() => setCatalogError(true));
  };
  useEffect(() => { void loadCatalog(); }, []);
  // Bounded status refresh only while a wallet is actively waiting for a link/job.
  const waiting = !!currentLink || state.data?.quests.some(q => q.job && !q.job.completed_at && Date.parse(q.job.expires_at) > Date.now());
  useEffect(() => {
    if (!account || !waiting) return;
    const stopAt = Date.now() + 120000;
    const timer = setInterval(() => {
      if (Date.now() >= stopAt) { clearInterval(timer); return; }
      void reloadStatus();
    }, 10000);
    return () => clearInterval(timer);
  }, [account, waiting, reloadStatus]);
  const run = async (name: string, body: Record<string, unknown>) => {
    if (!account) { onConnect(); return; }
    if (busy) return;
    setBusy(name); setNote(null);
    try {
      const result = await action(body);
      if (typeof result.deepLink === "string") setDeepLink({ wallet: account.address, url: result.deepLink, expires: Number(result.expires_at) * 1000 });
      if (typeof result.authorizeUrl === "string") { window.location.assign(result.authorizeUrl); return; }
      setNote(result.status === "awarded" ? "Verified reward recorded" : result.status === "unlinked" ? "Disconnected. Reward history is preserved. For Telegram, also run /unlink in the official bot." : String(result.status ?? "Request saved").replaceAll("_", " "));
      await state.reload(); onChanged();
    } catch (error) { setNote(error instanceof Error ? error.message : "Please retry verification"); }
    finally { setBusy(null); }
  };
  const data = state.data;
  const integrationsInactive = catalog?.telegramEnabled === false && catalog.discordEnabled === false &&
    catalog.xManualEnabled === false && catalog.rewardsEnabled === false;
  const connectButtons = [
    { provider: "telegram", title: "Telegram", Icon: TelegramIcon, linked: data?.connections.telegram, enabled: data?.capabilities.telegramLink, action: "telegram_token" },
    { provider: "discord", title: "Discord", Icon: DiscordIcon, linked: data?.connections.discord, enabled: data?.capabilities.discord, action: "discord_connect" },
    { provider: "x", title: "X", Icon: XIcon, linked: data?.connections.x, enabled: false, action: "" },
  ];
  return <div className="earn-verification-section">
    <div className="earn-quest-toolbar"><span className="earn-caption">4 seasonal quests · {NEW_QUESTS.reduce((total, q) => total + q.points, 0)} Points total</span>
      {account && <button type="button" className="earn-text-button" disabled={!!busy || state.loading} onClick={() => void state.reload()}>Refresh status ↻</button>}</div>
    <details className="earn-accounts-disclosure">
      <summary><span>Connected accounts</span><span className="earn-caption">{data ? `${connectButtons.filter(c => c.linked).length}/3 connected` : "Manage connections"} ⌄</span></summary>
      <div className="earn-account-list">
      {connectButtons.map(({ provider, title, Icon, linked, enabled, action: command }) => <div className="earn-connection-row" key={provider}>
        <Icon className="h-5 w-5" /><strong>{title}</strong><span>{account && !data ? "Unavailable" : linked ? provider === "x" ? "Manually verified" : "Connected" : "Not connected"}</span>
        {linked ? <button type="button" disabled={!!busy} onClick={() => void run(provider, { action: "unlink", provider })}>Disconnect</button>
          : provider === "x" ? <span className="earn-caption">Ownership reviewed below</span>
          : <button type="button" disabled={!!busy || (!!account && !enabled)} onClick={() => void run(provider, { action: command })}>{busy === provider ? "Please wait…" : `Connect ${title}`}</button>}
      </div>)}
      </div>
      <p className="earn-caption p-3">Your wallet is your website identity. Community XP and prizes are separate from website Points. Disconnecting preserves reward history.</p>
    </details>
    {currentLink && !data?.connections.telegram && <div className="earn-callout mt-3 rounded-xl border border-[var(--heads)]/20 p-3">
      <p className="text-xs text-white/70">Open the official bot privately to finish linking. This link expires shortly; do not share it.</p>
      {Date.now() < currentLink.expires ? <a className="earn-primary" href={currentLink.url} target="_blank" rel="noopener noreferrer">Open official Telegram bot ↗</a> : <span>Link expired — connect again</span>}
    </div>}
    {state.needsAuth && <div className="earn-callout mt-3"><p className="text-sm text-white/60">Verify wallet ownership to manage social connections.</p><button type="button" className="earn-secondary" onClick={async () => { await state.reload(true); onChanged(); }}>Verify wallet</button></div>}
    {state.error && !integrationsInactive && <p role="alert" className="mt-3 text-xs text-amber-200">{state.error} <button type="button" className="underline" onClick={() => void state.reload()}>Retry</button></p>}
    {catalogError && <p role="alert" className="mt-3 text-xs text-amber-200">Quest settings could not load. <button type="button" className="underline" onClick={() => void loadCatalog()}>Retry settings</button></p>}
    <h3 className="sr-only">Community & gameplay quests</h3>
    <p className="earn-caption my-3">{data?.newRewardsEnabled ? "Verified quests earn Points when all eligibility checks pass." : "New quest rewards are inactive until testing and activation are approved."}</p>
    <div className="earn-quest-list">{NEW_QUESTS.map(quest => {
      const row = data?.quests.find(q => q.id === quest.id);
      const completed = row?.claim?.status === "verified";
      const pending = row?.job && !row.job.completed_at && Date.parse(row.job.expires_at) > Date.now();
      const available = !!row?.active && (quest.provider === "telegram" ? data?.capabilities.telegramJobs : quest.provider === "discord" ? data?.capabilities.discord : true);
      const label = completed ? "Completed" : row?.claim?.status === "rejected" ? "Rejected" : !available ? "Unavailable" : pending ? "Pending Verification" : row?.job?.result_status === "NOT_MEMBER" || (quest.provider === "discord" && data?.discordMembership === "NOT_MEMBER") ? "In Progress" : quest.provider === "discord" && data?.discordMembership === "PENDING" ? "Pending Verification" : "Available";
      const destination = quest.id === "telegram_group" ? catalog?.groupUrl : quest.id === "telegram_channel" ? catalog?.channelUrl : quest.id === "discord_member" ? catalog?.discordJoinUrl : null;
      const Icon = quest.provider === "telegram" ? TelegramIcon : quest.provider === "discord" ? DiscordIcon : EarnIcon;
      return <section key={quest.id} aria-label={quest.title}>
        <details className="earn-quest-disclosure" name="earn-quest-details">
        <summary><Icon className="h-5 w-5" /><span className="earn-quest-name"><strong>{quest.title}</strong><small>{quest.id === "three_days" ? data ? `${data.gameplayDays}/3 days` : "3 different UTC dates" : quest.provider === "telegram" ? "Official bot verification" : "Official Discord verification"}</small></span>
          <span className="earn-quest-numbers">+{quest.points} Points<span className={`earn-status ${completed ? "earn-status-verified" : pending ? "earn-status-pending" : ""}`}>{label}</span></span><span className="earn-chevron" aria-hidden="true">⌄</span></summary>
        <div className="earn-quest-body">
        <p>{quest.provider === "telegram" ? "Verified by the official bot. No gameplay is required." : quest.provider === "discord" ? "Official Discord verification, including membership screening. No automatic join." : "At least one eligible settled match on 3 distinct UTC dates. Days need not be consecutive; past eligible matches count."}</p>
        {quest.id === "three_days" && <div className="earn-day-progress" role="progressbar" aria-label="Three-day gameplay quest" aria-valuemin={0} aria-valuemax={3} aria-valuenow={data?.gameplayDays}><span style={{ width: `${(data?.gameplayDays ?? 0) / 3 * 100}%` }} /><strong>{data ? `${data.gameplayDays}/3 UTC days` : account ? "Progress unavailable" : "Connect to view progress"}</strong></div>}
        {destination && <a href={destination} target="_blank" rel="noopener noreferrer" className="earn-text-button">{quest.id === "telegram_group" ? "Join Telegram Group" : quest.id === "telegram_channel" ? "Join Announcement Channel" : "Join Discord Server"} ↗</a>}
        {row?.job?.completed_at && ["ERROR", "UNAVAILABLE", "PENDING"].includes(row.job.result_status ?? "") && !completed && <small>Membership was not confirmed. Retry verification when the service is available.</small>}
        {quest.provider === "telegram" && !completed && !data?.connections.telegram ? <button type="button" className="earn-secondary" disabled={!!busy || (!!account && !data?.capabilities.telegramLink)} onClick={() => void run("telegram", { action: "telegram_token" })}>{!account ? "Connect Wallet" : busy === "telegram" ? "Please wait…" : "Connect Telegram"}</button>
        : !completed && <button type="button" className="earn-secondary" disabled={!!busy || pending || (!!account && !available)}
          onClick={() => void run(quest.id, { action: quest.id === "discord_member" ? "discord_connect" : quest.id })}>
          {!account ? "Connect Wallet" : busy === quest.id ? "Please wait…" : quest.id === "three_days" ? "Check progress & claim" : quest.id === "discord_member" ? "Verify Discord Membership" : "Verify Membership"}</button>}
        {quest.provider === "discord" && <small>Retry verification reopens official Discord authorization.</small>}
        </div></details>
      </section>;
    })}</div>
    {note && <p role="status" className="mt-3 rounded-xl bg-white/5 p-3 text-xs text-white/70">{note}</p>}
  </div>;
}

export function XOwnershipForm({ onChanged }: { onChanged: () => void }) {
  const { wallet, account } = useWalletState();
  const resource = useRewardResource<VerificationState>("/api/earn/status", wallet, account);
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  const challenge = resource.data?.xChallenge;
  const expired = challenge && Date.parse(challenge.expires_at) <= Date.now();
  const run = async (body: Record<string, unknown>) => {
    if (busy) return; setBusy(true); setNote(null);
    try { const r = await action(body); setNote(String(r.status ?? "Request saved").replaceAll("_", " ")); await resource.reload(); onChanged(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return <div className="earn-x-ownership"><h4 className="font-semibold">Verify X ownership · +100 Points</h4>
    <p className="mt-2 text-xs leading-relaxed text-white/60">Submit your profile URL, temporarily place your unique code in your bio, then request manual review. A URL alone is not proof of ownership.</p>
    {resource.data?.connections.x && <p className="mt-2 text-xs text-[var(--heads)]">Manually verified · @{resource.data.connections.xHandle}</p>}
    <label className="mt-3 block text-xs text-white/60">X profile URL<input aria-label="X profile URL" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://x.com/your_handle" maxLength={250} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm" /></label>
    <button type="button" disabled={busy || !resource.data?.capabilities.xManual || !url} className="earn-secondary mt-3" onClick={() => void run({ action: "x_challenge", profileUrl: url })}>Generate ownership challenge</button>
    {challenge && <div className="mt-3 rounded-xl border border-white/10 p-3 text-xs"><p>Place this code temporarily in the bio of {challenge.profile_url}</p><code className="mt-2 block break-all text-sm text-[var(--heads)]">{challenge.code}</code><p className="mt-2 text-white/50">{expired ? "Expired — generate a new challenge" : `Expires ${new Date(challenge.expires_at).toLocaleString()}`}</p>
      <p className="mt-2">{challenge.status.replaceAll("_", " ")}</p>{challenge.review_reason && <p className="mt-2 text-white/60">Review: {challenge.review_reason}</p>}
      <button type="button" disabled={busy || !!expired || ["submitted", "verified"].includes(challenge.status)} className="earn-secondary mt-3" onClick={() => void run({ action: "x_submit", challengeId: challenge.id })}>Submit X Profile for review</button></div>}
    {resource.error && <p role="alert" className="mt-2 text-xs text-amber-200">{resource.error}</p>}
    {note && <p role="status" className="mt-2 text-xs text-white/70">{note}</p>}
  </div>;
}
