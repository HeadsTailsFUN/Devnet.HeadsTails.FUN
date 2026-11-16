"use client";

import { useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useRewardResource } from "@/lib/airdrop/useRewardResource";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";

interface XState {
  wallet: string; socialAvailable: boolean; campaignUrl?: string | null;
  campaignUrls?: { reply: string | null; repost: string | null };
  social?: { handle: string | null; handleStatus: string | null; connectStatus: string | null;
    replyUrl: string | null; replyStatus: string | null; repostStatus: string | null;
    replyCampaignUrl?: string | null; repostCampaignUrl?: string | null };
}
const statusLabel = (value: string | null | undefined) => value === "verified" ? "Completed" : value === "pending" ? "Pending Review" : value === "rejected" ? "Rejected" : "Available";
export const X_RETENTION_RULE = "Keep following our X account and keep your submitted replies and reposts until airdrop rewards are distributed. If you unfollow or delete an activity before payout, you will not receive the reward for that task. Eligibility is checked again before distribution.";

export function XQuests({ wallet, account, onChanged }: { wallet: Wallet | null; account: WalletAccount | null; onChanged?: () => void }) {
  const resource = useRewardResource<XState>("/api/airdrop/points", wallet, account);
  const [profile, setProfile] = useState<string | null>(null), [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const data = resource.data, social = data?.social;
  const profileUrl = profile ?? (social?.handle ? `https://x.com/${social.handle.replace(/^@/, "")}` : "");
  const replyUrl = reply ?? social?.replyUrl ?? "";
  const targets = data?.campaignUrls ?? { reply: data?.campaignUrl ?? null, repost: data?.campaignUrl ?? null };
  const approved = social?.handleStatus === "verified";
  const unavailable = !data || data.socialAvailable === false || !!busy;
  const run = async (task: "follow" | "reply" | "repost") => {
    if (busy || !wallet || !account) return;
    setBusy(task); setNote(null);
    try {
      const editing = task === "reply" ? !!social?.replyStatus : task === "repost" ? !!social?.repostStatus : false;
      const body = task === "follow" ? { action: "x_follow", profileUrl }
        : { task, handle: social?.handle, ...(task === "reply" ? { evidenceUrl: replyUrl } : {}), campaignUrl: targets[task] };
      const response = await fetch(task === "follow" ? "/api/earn/action" : editing ? "/api/airdrop/social-edit" : "/api/airdrop/social-claim",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { if(response.status===401)await resource.reload(); throw new Error(result.message ?? result.error ?? "Could not submit. Please retry."); }
      setNote(result.status === "completed" || result.status === "already-claimed" ? "This task is already saved. Check its review status below." : "Submitted for manual review. Points are confirmed only after approval.");
      await resource.reload(); onChanged?.();
    } catch (e) { setNote(e instanceof Error ? e.message : "Could not submit. Please retry."); }
    finally { setBusy(null); }
  };
  const postLink = (task: "reply" | "repost") => {
    const target = targets[task];
    return target ? <a className="x-campaign-link" href={target} target="_blank" rel="noopener noreferrer">{task === "reply" ? "Open Post & Reply" : "Open Post & Repost"}<span aria-hidden="true">↗</span></a>
      : <p className="x-task-notice">Unavailable — no active campaign post is configured.</p>;
  };
  const savedPost = (task: "reply" | "repost") => {
    const url = task === "reply" ? social?.replyCampaignUrl : social?.repostCampaignUrl;
    return url && url.toLowerCase() !== targets[task]?.toLowerCase() ? <a className="x-submitted-link" href={url} target="_blank" rel="noopener noreferrer">View the post used for your saved submission ↗</a> : null;
  };
  return <div className="x-quest-stack">
    {resource.needsAuth && <div className="x-task-notice"><p>Verify your wallet to submit tasks.</p><button className="earn-secondary" onClick={() => void resource.reload(true)}>Verify wallet</button></div>}
    {resource.error && <p role="alert" className="x-task-notice">{resource.error} <button onClick={() => void resource.reload()}>Retry</button></p>}
    {data?.socialAvailable === false && <p role="alert" className="x-task-notice">Quest verification is temporarily unavailable. Try refreshing.</p>}
    <section className="x-task-card" aria-label="Follow on X">
      <div className="x-task-top"><span className="x-task-kicker">X COMMUNITY</span><span className={`earn-status ${social?.connectStatus === "verified" ? "earn-status-verified" : ""}`}>{statusLabel(social?.connectStatus)}</span></div>
      <h4>Follow on X <span>+100 Points</span></h4>
      <p>Submit your profile URL.</p>
      <a className="x-campaign-link" href={SOCIAL_LINKS.x} target="_blank" rel="noopener noreferrer">Follow @HeadsTailsFun<span aria-hidden="true">↗</span></a>
      <label htmlFor="x-follow-profile">X Profile URL</label>
      <input id="x-follow-profile" aria-label="X profile URL" type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={250} placeholder="https://x.com/your_handle" value={profileUrl} onChange={e => setProfile(e.target.value)} disabled={social?.connectStatus === "verified"} />
      <button type="button" className="x-submit" disabled={unavailable || !profileUrl.trim() || social?.connectStatus === "verified" || (social?.connectStatus === "pending" && profile === null)} onClick={() => void run("follow")}>{busy === "follow" ? "Submitting…" : social?.connectStatus === "verified" ? "Completed" : social?.connectStatus === "pending" && profile === null ? "Pending Review" : "Submit for Review"}</button>
      <small>Our team manually checks that this profile follows the official account.</small>
    </section>
    <section className="x-task-card" aria-label="Reply quest">
      <div className="x-task-top"><span className="x-task-kicker">REPLY QUEST</span><span className="earn-status">{statusLabel(social?.replyStatus)}</span></div>
      <h4>Reply to the Campaign Post <span>+50 Points</span></h4>
      <p>Reply to our campaign post, then submit your reply link for review.</p>
      {postLink("reply")}{savedPost("reply")}
      <label htmlFor="x-reply-link">Reply URL</label>
      <input id="x-reply-link" aria-label="X reply URL" type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} placeholder="https://x.com/your_handle/status/…" value={replyUrl} onChange={e => setReply(e.target.value)} disabled={social?.replyStatus === "verified"} />
      <button type="button" className="x-submit" disabled={unavailable || !approved || !targets.reply || !replyUrl.trim() || social?.replyStatus === "verified" || (social?.replyStatus === "pending" && reply === null)} onClick={() => void run("reply")}>{busy === "reply" ? "Submitting…" : social?.replyStatus === "verified" ? "Completed" : social?.replyStatus === "pending" && reply === null ? "Pending Review" : "Submit for Review"}</button>
      {!approved && <small>Your X profile must be approved before submitting campaign tasks.</small>}
    </section>
    <section className="x-task-card" aria-label="Repost quest">
      <div className="x-task-top"><span className="x-task-kicker">REPOST QUEST</span><span className="earn-status">{statusLabel(social?.repostStatus)}</span></div>
      <h4>Repost the Campaign <span>+75 Points</span></h4>
      <p>Repost our campaign post, then submit it for manual review.</p>
      {postLink("repost")}{savedPost("repost")}
      <button type="button" className="x-submit" disabled={unavailable || !approved || !targets.repost || ["verified", "pending"].includes(social?.repostStatus ?? "")} onClick={() => void run("repost")}>{busy === "repost" ? "Submitting…" : social?.repostStatus === "verified" ? "Completed" : social?.repostStatus === "pending" ? "Pending Review" : "Submit for Review"}</button>
      <small>{approved ? "No separate repost URL is needed. Our team checks your profile and the campaign post." : "Your X profile must be approved before submitting campaign tasks."}</small>
    </section>
    {note && <p role="status" className="x-task-notice">{note}</p>}
    <aside className="x-retention-rule"><strong>Before airdrop payout</strong><p>{X_RETENTION_RULE}</p></aside>
  </div>;
}
