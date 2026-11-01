"use client";

import { useEffect, useRef, useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { shortAddr } from "@/components/wallet/WalletProvider";
import { currentSessionWallet, ensureSession } from "@/lib/auth/client";
import type { PublicProfile } from "@/lib/profiles/types";
import { BUG_SEVERITIES } from "@/lib/bugs/validate";
import { campaignPostUrl } from "@/lib/airdrop/campaign";
import { TeamPreference, type Team } from "./TeamPreference";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";

type Tab = "profile" | "referrals" | "airdrop" | "bug";

export function ProfileModal({
  wallet,
  account,
  address,
  profile,
  pendingPayout,
  onRetryPayout,
  retryPayoutBusy,
  onClose,
  onChanged,
  onLogout,
}: {
  wallet: Wallet | null;
  account: WalletAccount | null;
  address: string;
  profile: PublicProfile | null;
  /** Rare operational state: ORAO fulfilled + Match not Settled. No wallet tx. */
  pendingPayout?: { matchId: string } | null;
  onRetryPayout?: () => void;
  retryPayoutBusy?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const [nameInput, setNameInput] = useState("");
  const [busy, setBusy] = useState<"name" | "avatar" | "team" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [team, setTeam] = useState<Team>(null);
  useEffect(() => {
    let stopped = false;
    void fetch(`/api/profile/team?wallet=${encodeURIComponent(address)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!stopped && data) setTeam(data.team);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [address]);
  const saveTeam = async (next: Team) => {
    if (busy) return;
    setBusy("team");
    try {
      if (!(await authed())) return;
      const r = await fetch("/api/profile/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team: next, wallet: address }),
      });
      if (!r.ok) throw Error("Could not save team");
      setTeam(next);
      onChanged();
    } catch {
      setNote("Could not save team. Please retry.");
    } finally {
      setBusy(null);
    }
  };
  const fileRef = useRef<HTMLInputElement | null>(null);

  const authed = async (): Promise<boolean> => {
    if (!wallet || !account) return false;
    try {
      if ((await currentSessionWallet()) === address) return true;
      await ensureSession(wallet, account);
      return true;
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Verification failed.");
      return false;
    }
  };

  const saveName = async () => {
    if (busy) return;
    setNote(null);
    setBusy("name");
    try {
      if (!(await authed())) return;
      const res = await fetch("/api/profile/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: nameInput }),
      });
      const b = (await res.json().catch(() => null)) as {
        error?: string;
        username?: string;
      } | null;
      if (!res.ok) {
        setNote(b?.error ?? "Could not save username.");
        return;
      }
      setNameInput("");
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (busy) return;
    setNote(null);
    setBusy("avatar");
    try {
      if (!(await authed())) return;
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: form,
      });
      const b = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setNote(b?.error ?? "Avatar upload failed.");
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const winRate =
    profile && profile.winRate !== null
      ? `${(profile.winRate * 100).toFixed(1)}%`
      : "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close profile"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="glass relative flex max-h-[85svh] w-full max-w-sm flex-col overflow-hidden rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-lg font-bold text-white"
              >
                {(profile?.username ?? address).slice(0, 1).toUpperCase()}
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              title="JPEG, PNG or WebP, up to 2 MB"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="min-h-[36px] px-2 text-xs text-white/70 hover:text-white"
              aria-label="Change avatar"
            >
              {busy === "avatar" ? "Uploading…" : "Change"}
            </button>
          </div>
          <div className="min-w-0">
            <p
              className={`truncate text-[16px] font-bold ${profile?.rankColorClass ?? "text-white"}`}
            >
              {profile?.username ?? shortAddr(address)}
            </p>
            <p className="truncate text-[12px] text-[var(--text-secondary)]">
              {shortAddr(address)}
            </p>
          </div>
          {profile && (
            <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-white/70">
              {profile.displayRank}
            </span>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Profile sections"
          className="mt-3 flex gap-1.5 overflow-x-auto"
        >
          {(["profile", "referrals", "airdrop", "bug"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              type="button"
              onClick={() => setTab(t)}
              className={`min-h-[36px] shrink-0 rounded-2xl px-3 text-[12px] font-bold transition ${
                tab === t
                  ? "bg-white text-black"
                  : "border border-white/15 text-white hover:bg-white/10"
              }`}
            >
              {t === "profile"
                ? "Profile"
                : t === "referrals"
                  ? "Referrals"
                  : t === "airdrop"
                    ? "Airdrop"
                    : "Report Bug"}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {tab === "profile" && (
            <div>
              <dl className="mt-1 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Games", String(profile?.gamesPlayed ?? 0)],
                  ["Wins", String(profile?.wins ?? 0)],
                  ["Losses", String(profile?.losses ?? 0)],
                  ["Win %", winRate],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      {k}
                    </dt>
                    <dd className="text-[15px] font-bold text-white">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <label
                  htmlFor="ht-username"
                  className="text-[12px] font-bold text-white"
                >
                  {profile?.username ? "Change username" : "Choose username"}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="ht-username"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder={profile?.username ?? "e.g. degen_king"}
                    maxLength={18}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[14px] text-white placeholder:text-white/30"
                  />
                  <button
                    type="button"
                    onClick={() => void saveName()}
                    disabled={busy !== null}
                    className="inline-flex min-h-[40px] items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black transition hover:bg-slate-200 disabled:opacity-60"
                  >
                    {busy === "name" ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  3–18 chars, letters/numbers/underscore. Changeable once per
                  24h.
                </p>
              </div>

              <div className="mt-3"></div>

              <TeamPreference
                value={team}
                busy={busy !== null}
                onSave={(next) => void saveTeam(next)}
              />
              {pendingPayout && (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/5 px-4 py-3">
                  <p className="text-[13px] font-bold text-amber-200">
                    Payout pending — Match #{pendingPayout.matchId}
                  </p>
                  <p className="mt-1 text-[12px] text-white/60">
                    Payout is pending on-chain. No action is required.
                  </p>
                  {onRetryPayout && (
                    <button
                      type="button"
                      onClick={onRetryPayout}
                      disabled={retryPayoutBusy}
                      title="Requests the server to ensure the auto-settlement job exists. No wallet transaction."
                      className="mt-2 inline-flex min-h-[40px] items-center rounded-xl bg-white/10 px-4 text-[12.5px] font-bold text-white transition hover:bg-white/15 disabled:opacity-60"
                    >
                      {retryPayoutBusy ? "Requesting…" : "Retry payout"}
                    </button>
                  )}
                </div>
              )}

              {note && (
                <p
                  role="alert"
                  className="mt-3 text-[13px] font-medium text-[#ff9db1]"
                >
                  {note}
                </p>
              )}

              <button
                type="button"
                onClick={onLogout}
                className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-[#ff5d7a]/40 px-4 text-sm font-bold text-[#ff9db1] transition hover:bg-[#ff5d7a]/10"
              >
                Disconnect wallet
              </button>
            </div>
          )}
          {tab === "referrals" && (
            <ReferralsTab wallet={wallet} account={account} />
          )}
          {tab === "airdrop" && (
            <AirdropTab wallet={wallet} account={account} />
          )}
          {tab === "bug" && <BugTab wallet={wallet} account={account} />}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 inline-flex min-h-[40px] w-full shrink-0 items-center justify-center rounded-2xl text-[13px] font-semibold text-[var(--text-secondary)] transition hover:text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function useAuthedFetch<T>(
  url: string | null,
  wallet: Wallet | null,
  account: WalletAccount | null,
) {
  const [data, setData] = useState<T | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (withVerify = false) => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      if (withVerify && wallet && account) {
        await ensureSession(wallet, account);
      }
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) {
        setNeedsAuth(true);
        return;
      }
      const b = (await r.json().catch(() => null)) as T | null;
      if (!r.ok) {
        setError("Could not load.");
        return;
      }
      setData(b);
      setNeedsAuth(false);
    } catch {
      setError("Could not load.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return { data, needsAuth, loading, error, reload: load };
}

function ReferralsTab({
  wallet,
  account,
}: {
  wallet: Wallet | null;
  account: WalletAccount | null;
}) {
  const { data, needsAuth, loading, error, reload } = useAuthedFetch<{
    code?: string;
    link?: string;
    totalInvites?: number;
    qualified?: number;
    pendingInvites?: number;
    referralPoints?: number;
    myReferral?: {
      status: string;
      eligibleGames: number;
      gamesNeeded: number;
    } | null;
  }>("/api/referrals/mine", wallet, account);
  const [copied, setCopied] = useState(false);
  if (loading && !data)
    return <p className="text-[13px] text-white/60">Loading…</p>;
  if (needsAuth)
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-[13px] text-white/70">
          Verify wallet ownership to view referrals.
        </p>
        <button
          type="button"
          onClick={() => void reload(true)}
          className="mt-2 inline-flex min-h-[40px] items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black"
        >
          Verify wallet
        </button>
      </div>
    );
  if (error)
    return (
      <p role="alert" className="text-[13px] text-[#ff9db1]">
        {error}
      </p>
    );
  const link = data?.link ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-[12px] font-bold text-white">Referral link</p>
        <p className="mt-1 break-all text-[12px] text-white/70">
          {link || "—"}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!link) return;
            try {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
          className="mt-2 inline-flex min-h-[40px] items-center rounded-2xl bg-white/10 px-4 text-[12.5px] font-bold text-white hover:bg-white/15"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Invites", String(data?.totalInvites ?? 0)],
          ["Qualified", String(data?.qualified ?? 0)],
          ["Points", String(data?.referralPoints ?? 0)],
        ].map(([k, v]) => (
          <div
            key={k}
            className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {k}
            </dt>
            <dd className="text-[15px] font-bold text-white">{v}</dd>
          </div>
        ))}
      </dl>
      {data?.myReferral && data.myReferral.status !== "blocked" && (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-center text-[12px] font-semibold text-white/80">
          {data.myReferral.status === "qualified"
            ? "Referral qualified ✓"
            : `Referral linked — ${Math.min(data.myReferral.eligibleGames, 3)} / 3 eligible games completed`}
        </p>
      )}
      {(data?.pendingInvites ?? 0) > 0 && (
        <p className="text-center text-[12px] font-semibold text-white/70">
          {data?.pendingInvites} invite{data?.pendingInvites === 1 ? "" : "s"}{" "}
          pending qualification
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-white/40">
        3 settled eligible games → +25 invitee and +50 referrer, once. Game 4+:
        +2 per game (max 25/invitee/day, max 500 recurring/day).
      </p>
    </div>
  );
}

/** Small Pending/Verified/Rejected pill — pending points are never verified points. */
function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  const label =
    s === "verified" ? "Verified" : s === "rejected" ? "Rejected" : "Pending";
  const cls =
    s === "verified"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
      : s === "rejected"
        ? "border-red-400/30 bg-red-500/10 text-red-200"
        : "border-amber-300/30 bg-amber-300/10 text-amber-200";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function AirdropTab({
  wallet,
  account,
}: {
  wallet: Wallet | null;
  account: WalletAccount | null;
}) {
  const { data, needsAuth, loading, error, reload } = useAuthedFetch<{
    season?: string;
    verifiedTotal?: number;
    pendingTotal?: number;
    verified?: Record<string, number>;
    pending?: Record<string, number>;
    social?: {
      handle: string | null;
      handleStatus: string | null;
      connectStatus: string | null;
      replyUrl: string | null;
      replyStatus: string | null;
      repostStatus: string | null;
    };
  }>("/api/airdrop/points", wallet, account);
  const [handle, setHandle] = useState("");
  const [replyUrl, setReplyUrl] = useState("");
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [editingX, setEditingX] = useState(false);
  const [editHandle, setEditHandle] = useState("");
  const [editingReply, setEditingReply] = useState(false);
  const [editReplyUrl, setEditReplyUrl] = useState("");
  const campaignUrl = campaignPostUrl();
  const social = data?.social ?? null;
  const claim = async (task: "connect_x" | "repost" | "reply") => {
    setClaimNote(null);
    setClaiming(true);
    try {
      if (wallet && account) {
        try {
          await ensureSession(wallet, account);
        } catch (e) {
          setClaimNote(e instanceof Error ? e.message : "Verification failed.");
          return;
        }
      }
      const r = await fetch("/api/airdrop/social-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          handle,
          evidenceUrl: task === "reply" ? replyUrl : undefined,
        }),
      });
      const b = (await r.json().catch(() => null)) as {
        error?: string;
        status?: string;
      } | null;
      if (!r.ok) {
        setClaimNote(b?.error ?? "Could not save claim.");
        return;
      }
      setClaimNote(
        b?.status === "already-claimed"
          ? "Already claimed."
          : "Pending verification.",
      );
      if (task === "connect_x") setHandle("");
      if (task === "reply") setReplyUrl("");
      void reload(false);
    } finally {
      setClaiming(false);
    }
  };
  // Edit an existing claim: same reward row back to Pending, never a new one.
  const editClaim = async (task: "connect_x" | "reply") => {
    setClaimNote(null);
    setClaiming(true);
    try {
      if (wallet && account) {
        try {
          await ensureSession(wallet, account);
        } catch (e) {
          setClaimNote(e instanceof Error ? e.message : "Verification failed.");
          return;
        }
      }
      const r = await fetch("/api/airdrop/social-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          handle: task === "connect_x" ? editHandle : (social?.handle ?? ""),
          evidenceUrl: task === "reply" ? editReplyUrl : undefined,
        }),
      });
      const b = (await r.json().catch(() => null)) as {
        error?: string;
        status?: string;
      } | null;
      if (!r.ok) {
        setClaimNote(b?.error ?? "Could not save edit.");
        return;
      }
      setClaimNote(
        b?.status === "unchanged"
          ? "No changes."
          : "Updated — back to pending review.",
      );
      if (task === "connect_x") setEditingX(false);
      else setEditingReply(false);
      void reload(false);
    } finally {
      setClaiming(false);
    }
  };
  if (loading && !data)
    return <p className="text-[13px] text-white/60">Loading…</p>;
  if (needsAuth)
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="text-[13px] text-white/70">
          Verify wallet ownership to view airdrop points.
        </p>
        <button
          type="button"
          onClick={() => void reload(true)}
          className="mt-2 inline-flex min-h-[40px] items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black"
        >
          Verify wallet
        </button>
      </div>
    );
  if (error)
    return (
      <p role="alert" className="text-[13px] text-[#ff9db1]">
        {error}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
        <p className="mt-1 text-[26px] font-bold text-white">
          {data?.verifiedTotal ?? 0}
        </p>
        <p className="text-[11px] text-white/50">
          verified points
          {(data?.pendingTotal ?? 0) > 0
            ? ` • ${data?.pendingTotal} pending`
            : ""}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        {[
          ["Gameplay", String(data?.verified?.gameplay ?? 0)],
          ["Win bonus", String(data?.verified?.win_bonus ?? 0)],
          ["Referral", String(data?.verified?.referral ?? 0)],
          ["Social", String(data?.verified?.social ?? 0)],
        ].map(([k, v]) => (
          <div
            key={k}
            className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {k}
            </dt>
            <dd className="text-[15px] font-bold text-white">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-relaxed text-white/40">
        Points are reviewed for eligibility before any airdrop distribution.
      </p>
      <p className="text-[11px] leading-relaxed text-white/40">
        Social activity is re-checked before rewards are finalized.
      </p>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-[12px] font-bold text-white">X tasks</p>
        <p className="mt-1 text-[11px] text-white/50">
          <a
            href={SOCIAL_LINKS.x}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Official X
          </a>
          {" • "}Link +100 • Reply +50 (pending until reviewed)
        </p>
        {campaignUrl && (
          <p className="mt-1 text-[11px] text-white/50">
            <a
              href={campaignUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View campaign post ↗
            </a>
          </p>
        )}
        {/* Row 1 — X account: persisted server-side, survives refresh. */}
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/50">
          X account
        </p>
        {social?.handle ? (
          editingX ? (
            <div className="mt-1.5 flex gap-2">
              <input
                value={editHandle}
                onChange={(e) => setEditHandle(e.target.value)}
                placeholder="@handle"
                maxLength={33}
                autoComplete="off"
                aria-label="X handle"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
              />
              <button
                type="button"
                disabled={claiming}
                onClick={() => void editClaim("connect_x")}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingX(false)}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl border border-white/15 px-3 text-[13px] font-semibold text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
                @{social.handle.replace(/^@/, "")}
              </span>
              <StatusPill
                status={social.handleStatus ?? social.connectStatus}
              />
              <button
                type="button"
                onClick={() => {
                  setEditHandle(`@${social.handle!.replace(/^@/, "")}`);
                  setEditingX(true);
                }}
                className="shrink-0 text-[12px] font-bold text-[var(--heads)] hover:underline"
              >
                Edit
              </button>
            </div>
          )
        ) : (
          <div className="mt-1.5 flex gap-2">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              maxLength={33}
              autoComplete="off"
              aria-label="X handle"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
            />
            <button
              type="button"
              disabled={claiming}
              onClick={() => void claim("connect_x")}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black disabled:opacity-60"
            >
              Link X
            </button>
          </div>
        )}
        {/* Row 2 — Reply: always submittable, admin-reviewed. */}
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/50">
          Reply
        </p>
        {social?.replyUrl ? (
          editingReply ? (
            <div className="mt-1.5 flex gap-2">
              <input
                value={editReplyUrl}
                onChange={(e) => setEditReplyUrl(e.target.value.slice(0, 500))}
                placeholder="https://x.com/…/status/…"
                maxLength={500}
                autoComplete="off"
                inputMode="url"
                aria-label="X reply URL"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
              />
              <button
                type="button"
                disabled={claiming}
                onClick={() => void editClaim("reply")}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingReply(false)}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl border border-white/15 px-3 text-[13px] font-semibold text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">
                {social.replyUrl}
              </span>
              <StatusPill status={social.replyStatus} />
              <button
                type="button"
                onClick={() => {
                  setEditReplyUrl(social.replyUrl!);
                  setEditingReply(true);
                }}
                className="shrink-0 text-[12px] font-bold text-[var(--heads)] hover:underline"
              >
                Edit
              </button>
            </div>
          )
        ) : (
          <div className="mt-1.5 flex gap-2">
            <input
              value={replyUrl}
              onChange={(e) => setReplyUrl(e.target.value.slice(0, 500))}
              placeholder="Paste your X reply URL"
              maxLength={500}
              autoComplete="off"
              inputMode="url"
              aria-label="X reply URL"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
            />
            <button
              type="button"
              disabled={claiming}
              onClick={() => void claim("reply")}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black disabled:opacity-60"
            >
              Submit Reply
            </button>
          </div>
        )}
        {/* Repost appears only when a real campaign post is configured. */}
        {campaignUrl && !social?.repostStatus && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={claiming}
              onClick={() => void claim("repost")}
              className="inline-flex min-h-[44px] items-center rounded-2xl bg-white/10 px-4 text-[13px] font-bold text-white hover:bg-white/15 disabled:opacity-60"
            >
              Claim Repost +75
            </button>
          </div>
        )}
        {campaignUrl && social?.repostStatus && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">
              Repost claimed
            </span>
            <StatusPill status={social.repostStatus} />
          </div>
        )}
        {claimNote && (
          <p role="status" className="mt-2 text-[12px] text-white/70">
            {claimNote}
          </p>
        )}
      </div>
    </div>
  );
}

function BugTab({
  wallet,
  account,
}: {
  wallet: Wallet | null;
  account: WalletAccount | null;
}) {
  const [what, setWhat] = useState("");
  const [steps, setSteps] = useState("");
  const [telegram, setTelegram] = useState("");
  const [severity, setSeverity] = useState<string>("Medium");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const submit = async () => {
    setNote(null);
    setBusy(true);
    try {
      if (wallet && account) {
        try {
          await ensureSession(wallet, account);
        } catch (e) {
          setNote(e instanceof Error ? e.message : "Verification failed.");
          return;
        }
      }
      const r = await fetch("/api/bugs/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: what, steps, telegram, severity }),
      });
      const b = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) {
        setNote(b?.error ?? "Could not submit report.");
        return;
      }
      setWhat("");
      setSteps("");
      setNote(
        "Submitted. Valid reports may be eligible for a bug bounty after review.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12px] font-bold text-white" htmlFor="ht-bug-what">
        What happened?
      </label>
      <textarea
        id="ht-bug-what"
        value={what}
        onChange={(e) => setWhat(e.target.value.slice(0, 2000))}
        rows={3}
        maxLength={2000}
        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
        placeholder="Describe the issue…"
      />
      <label
        className="text-[12px] font-bold text-white"
        htmlFor="ht-bug-steps"
      >
        Steps to reproduce
      </label>
      <textarea
        id="ht-bug-steps"
        value={steps}
        onChange={(e) => setSteps(e.target.value.slice(0, 2000))}
        rows={2}
        maxLength={2000}
        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
        placeholder="1. … 2. …"
      />
      <label className="text-[12px] font-bold text-white" htmlFor="ht-bug-tg">
        Telegram @username
      </label>
      <input
        id="ht-bug-tg"
        value={telegram}
        onChange={(e) => setTelegram(e.target.value.slice(0, 33))}
        placeholder="@username"
        autoComplete="off"
        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
      />
      <label className="text-[12px] font-bold text-white" htmlFor="ht-bug-sev">
        Severity
      </label>
      <select
        id="ht-bug-sev"
        value={severity}
        onChange={(e) => setSeverity(e.target.value)}
        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white"
      >
        {BUG_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-white px-4 text-[13px] font-bold text-black hover:bg-slate-200 disabled:opacity-60"
      >
        {busy ? "Submitting…" : "Submit Report"}
      </button>
      <p className="text-[11px] text-white/40">
        Valid reports may be eligible for a bug bounty after review.
      </p>
      {note && (
        <p role="status" className="text-[12px] text-white/70">
          {note}
        </p>
      )}
    </div>
  );
}
