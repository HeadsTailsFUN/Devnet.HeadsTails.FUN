"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, Transaction } from "@solana/web3.js";
import { WalletModal } from "@/components/wallet/WalletModal";
import { shortAddr, useWalletState, WalletStandardProvider } from "@/components/wallet/WalletProvider";
import { createAnchorWallet } from "@/lib/solana/anchorWallet";
import { RPC_URL } from "@/lib/solana/cluster";
import { currentSessionWallet, ensureSession } from "@/lib/auth/client";
import { planAdminAuth } from "@/lib/admin/sessionFlow";
import { OverviewTab, UsersTab, MatchesTab, RewardsTab } from "@/components/admin/AdminTabsA";
import { AuditTab, ChatTab, GameTab, SettingsTab } from "@/components/admin/AdminTabsB";
import { AirdropTab, BugReportsTab, ReferralsTab } from "@/components/admin/AdminTabsC";

const TABS = ["Overview", "Users", "Matches", "Referrals", "Airdrop", "Bug Reports", "Rewards", "Chat", "Game", "Settings", "Audit"] as const;
type Tab = (typeof TABS)[number];

function AdminClient() {
  const { account, wallet, signBytes, disconnect } = useWalletState();
  const [status, setStatus] = useState<{ isOwner?: boolean; isModerator?: boolean; isFullAdmin?: boolean; role?: string; wallet?: string; authority?: string | null } | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [walletOpen, setWalletOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const address = account?.address ?? null;
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);
  const anchorWallet = useMemo(
    () => (address ? createAnchorWallet(address, signBytes) : null),
    [address, signBytes]
  );
  const [flowNote, setFlowNote] = useState<string | null>(null);
  const addressRef = useRef<string | null>(null);
  addressRef.current = address;
  const flightRef = useRef<string | null>(null);

  /**
   * Session-bound staff check. Re-runs on every wallet change: stale status
   * is cleared, the new wallet is ownership-verified (message signature, no
   * transaction) when its session is missing/mismatched, and only then is
   * /api/admin/status fetched. Disconnected never means denied.
   */
  useEffect(() => {
    let stop = false;
    // New wallet (or disconnect): drop stale state; never sticky-deny.
    setStatus(null);
    setDenied(false);
    if (!address) {
      setFlowNote(null);
      flightRef.current = null;
      return () => {
        stop = true;
      };
    }
    if (flightRef.current === address) return () => { stop = true; };
    flightRef.current = address;
    const myAddr = address;
    const myWallet = wallet;
    const myAccount = account;
    const run = async () => {
      try {
        setFlowNote("Checking wallet session…");
        const session = await currentSessionWallet();
        if (stop || addressRef.current !== myAddr) return;
        const action = planAdminAuth({ address: myAddr, sessionWallet: session, inFlight: false });
        if (action.kind === "verify-session") {
          if (!myWallet || !myAccount) {
            setFlowNote("Wallet not ready — reconnect and try again.");
            return;
          }
          setFlowNote("Verify wallet ownership in your wallet (message signature, no transaction)…");
          try {
            await ensureSession(myWallet, myAccount);
          } catch (e) {
            if (stop || addressRef.current !== myAddr) return;
            setFlowNote(e instanceof Error ? e.message : "Wallet verification failed.");
            return;
          }
          if (stop || addressRef.current !== myAddr) return;
        } else if (action.kind !== "fetch-status") {
          return;
        }
        setFlowNote("Checking admin access…");
        const r = await fetch("/api/admin/status", { cache: "no-store" });
        const b = (await r.json().catch(() => null)) as {
          isOwner?: boolean;
          isModerator?: boolean;
          isFullAdmin?: boolean;
          role?: string;
          wallet?: string;
          authority?: string | null;
        } | null;
        if (stop || addressRef.current !== myAddr) return;
        if (r.ok && b && (b.isOwner || b.isModerator || b.isFullAdmin)) {
          setStatus({
            isOwner: b.isOwner,
            isModerator: b.isModerator,
            isFullAdmin: b.isFullAdmin,
            role: b.role,
            wallet: b.wallet,
            authority: b.authority ?? null,
          });
        } else {
          setDenied(true);
        }
        setFlowNote(null);
      } finally {
        if (flightRef.current === myAddr) flightRef.current = null;
      }
    };
    void run();
    return () => {
      stop = true;
    };
    // Re-verify whenever the connected wallet (or its handle) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, wallet, account]);

  /**
   * Operational fallback: ask the SERVER to ensure auto-settlement for a
   * match. The admin wallet never signs settlement and cannot edit
   * result/winner/pot — the program alone decides from verified chain state.
   */
  const retryAutoSettlement = useCallback(async (matchIdStr: string) => {
    setNote(null);
    try {
      const res = await fetch("/api/settlement/ensure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId: matchIdStr }),
      });
      const b = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (res.ok) {
        setNote(`Auto-settlement: ${b?.status ?? "queued"} (match #${matchIdStr}).`);
      } else {
        setNote(`Auto-settlement request: ${b?.error ?? "failed"} (match #${matchIdStr}).`);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message.slice(0, 160) : "Retry failed.");
    }
  }, []);

  /** Sign an admin-built unsigned tx (pause/resume) with the authority wallet. */
  const signAndSendAdmin = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!anchorWallet) throw new Error("wallet not connected");
      const signed = await anchorWallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [anchorWallet, connection]
  );

  return (
    <div className="relative mx-auto flex min-h-[100svh] w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-bold text-white">Admin</h1>
        <span className="text-[12px] text-[var(--text-secondary)]">Devnet QA • off-chain controls only</span>
        <span className="ml-auto flex items-center gap-2">
          {address ? (
            <>
              <span className="text-[12px] text-white/60">{shortAddr(address)}</span>
              <button type="button" onClick={() => void disconnect()} className="rounded-2xl border border-white/15 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-white/10">
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setWalletOpen(true)} className="rounded-2xl bg-white px-4 py-2 text-[12px] font-bold text-black">
              Connect Wallet
            </button>
          )}
        </span>
      </header>
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      {!address ? (
        <div className="glass rounded-3xl p-5 text-center">
          <p className="text-[14px] text-white">Connect a wallet to check admin access.</p>
          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            className="mt-3 rounded-2xl bg-white px-5 py-2 text-[13px] font-bold text-black"
          >
            Connect Wallet
          </button>
        </div>
      ) : denied ? (
        <p role="alert" className="glass rounded-3xl p-5 text-center text-[14px] text-[#ff9db1]">
          Not authorized. Connect the on-chain authority wallet (owner), the Devnet QA full-admin wallet, or an appointed moderator wallet.
        </p>
      ) : !status ? (
        <p className="text-[13px] text-[var(--text-secondary)]">{flowNote ?? "Checking access…"}</p>
      ) : (
        <>
          <p className="text-[12px] text-white/50">
            Signed in as {status.isOwner ? "OWNER" : status.isFullAdmin ? "FULL_ADMIN (Devnet QA)" : "MODERATOR"} • authority{" "}
            <span className="font-mono">{status.authority ? `${status.authority.slice(0, 4)}…${status.authority.slice(-4)}` : "unknown"}</span>
          </p>
          <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                type="button"
                onClick={() => setTab(t)}
                className={`min-h-[40px] rounded-2xl px-4 text-[13px] font-bold transition ${
                  tab === t ? "bg-white text-black" : "border border-white/15 text-white hover:bg-white/10"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {note && <p role="status" className="text-[13px] text-white/70">{note}</p>}
          {tab === "Overview" && <OverviewTab canWebAdmin={(status.isOwner || status.isFullAdmin) ?? false} />}
          {tab === "Users" && <UsersTab canWebAdmin={(status.isOwner || status.isFullAdmin) ?? false} />}
          {tab === "Matches" && <MatchesTab onRetryAutoSettlement={(id) => void retryAutoSettlement(id)} />}
          {tab === "Referrals" && <ReferralsTab />}
          {tab === "Airdrop" && <AirdropTab canWebAdmin={(status.isOwner || status.isFullAdmin) ?? false} />}
          {tab === "Bug Reports" && <BugReportsTab canWebAdmin={(status.isOwner || status.isFullAdmin) ?? false} />}
          {tab === "Rewards" && <RewardsTab />}
          {tab === "Chat" && <ChatTab />}
          {!status.isOwner && tab === "Game" && (
            <p role="note" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-center text-[12px] font-semibold text-amber-200">
              Owner signature required — on-chain authority actions cannot be signed by FULL_ADMIN or MODERATOR. Read, inspect, and validate freely.
            </p>
          )}
          {tab === "Game" && <GameTab address={address} signAndSendAdmin={signAndSendAdmin} />}
          {tab === "Settings" && <SettingsTab />}
          {tab === "Audit" && <AuditTab />}
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <WalletStandardProvider>
      <AdminClient />
    </WalletStandardProvider>
  );
}
