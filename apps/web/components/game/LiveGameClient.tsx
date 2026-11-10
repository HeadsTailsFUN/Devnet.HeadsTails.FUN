"use client";

import { DevnetUsdQuoteAdapter } from "@/lib/solana/usdQuote";
import { configPda, matchPda, playerPda } from "@/lib/solana/activeGame";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import { useMobileNavigation } from "@/lib/mobile/useMobileNavigation";
import { canChangeMobileRoom, canReturnToSidePicker, mobilePlayShowsProgress, mobileGameFeedback, type InformationPage } from "@/lib/mobile/navigation";
import { MobileNavigation, MobileSocialSwitch } from "@/components/mobile/MobileNavigation";
import { MobileRoomSelector } from "@/components/mobile/MobileRoomSelector";
import { MobileFlips } from "@/components/mobile/MobileFlips";
import { WalletButton } from "@/components/wallet/WalletButton";
import {
  AnchorProvider,
  Program,
  Wallet as AnchorWallet,
} from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  GameClient as SdkClient,
  StaleQuoteError,
  fetchPlayerStateCompat,
  fetchRandomnessStatus,
  gameIdlJson,
  stakeForUsd,
  type HeadsOrTails,
} from "@heads-or-tails/game-sdk";
import { AppHeader } from "@/components/brand/AppHeader";
import { AppFooter } from "@/components/brand/AppFooter";
import {HowToOverlay} from "@/components/fairness/HowToOverlay";
import { GameHero } from "@/components/game/GameHero";
import { LegacyPositionNotice } from "@/components/game/LegacyPositionNotice";
import { StakeTierSelector } from "@/components/game/StakeTierSelector";
import { TeamWelcome } from "@/components/profile/TeamPreference";
import {
  GameStatePanel,
  TransactionStatus,
} from "@/components/game/GameStatePanel";
import { RecentFlips } from "@/components/history/RecentFlips";
import { QueueStatusBar } from "@/components/status/QueueStatusBar";
import { DevStateSwitcher } from "@/components/ui/DevStateSwitcher";
import { WalletModal } from "@/components/wallet/WalletModal";
import { ProfileModal } from "@/components/profile/ProfileModal";
import { PublicProfileModal } from "@/components/profile/PublicProfileModal";
import { LeaderboardPanel } from "@/components/leaderboard/LeaderboardPanel";
import { shortAddr, useWalletState } from "@/components/wallet/WalletProvider";
import { useDevnetWelcomeTokens } from "@/lib/solana/useWelcomeTokens";
import {
  IS_DEVNET,
  DEVNET_SPONSOR_UI_ENABLED,
  PROJECT_TOKEN_MINT,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  RPC_URL,
  RPC_MISSING,
  RPC_IS_PUBLIC_FALLBACK,
} from "@/lib/solana/cluster";
import { createAnchorWallet } from "@/lib/solana/anchorWallet";
import { recoverySigFromError, signAndSend } from "@/lib/solana/send";
import { classifyError } from "@/lib/solana/errors";
import { probeJoinRecovery } from "@/lib/solana/txRecovery";
import {
  clearPendingSignature,
  getPendingSignature,
} from "@/lib/solana/session";
import {
  ensureSponsoredBalance,
  requestReimbursement,
  type ReimbursableAction,
} from "@/lib/solana/sponsorClient";
import {
  fetchRecentFlips,
  type HistoryResult,
  type RecentFlip,
} from "@/lib/solana/history";
import { useProfile } from "@/lib/profile/useProfile";
import {
  currentSessionWallet,
  ensureSession,
  logoutSession,
} from "@/lib/auth/client";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useSiteSettings } from "@/lib/site/useSiteSettings";
import {
  fetchRoomQueueSnapshot,
  fetchUserRoomQueuePosition,
  type QueueSnapshot,
} from "@/lib/solana/queueSnapshot";
import {
  playAgainReady,
  queuePositionText,
  shouldCommitSelectionRefresh,
  networkFeePreparationMessage,
  anchoredResultState,
} from "@/lib/game/uiGuards";
import { decideIdleRefresh } from "@/lib/game/matchLabel";
import { useVisibleFlipAnchor } from "@/components/game/useVisibleFlipAnchor";
import {
  DEFAULT_TIER_USD,
  ROOM_ACTIVATION_COPY,
  isRoomJoinable,
  mergeRoomLiveness,
  roomForTier,
} from "@/lib/game/rooms";
import { traceGameEvent, traceTransition } from "@/lib/game/stateTrail";
import {
  commitPassiveState,
  resolvePassiveSelectionView,
} from "@/lib/game/selectionGuard";
import {
  createIntent,
  mayClearIntentForRefresh,
  shouldClearIntentOn,
  type SelectionIntent,
} from "@/lib/game/selectionIntent";
import type { GameStateId, Side } from "@/lib/mockGameData";
import {
  MIN_FLIP_REVEAL_MS,
  classifyMatchObservation,
  planVisibleReveal,
} from "@/lib/game/flipReveal";

// State-aware polling: active play stays snappy, idle slows down, hidden pauses.
const REFRESH_ACTIVE_MS = 4000;
const REFRESH_IDLE_MS = 10000;
const REFRESH_DISCONNECTED_MS = 30000;
const REFRESH_FINAL_MS = 15000;
const HISTORY_MS = 30000;
const SNAPSHOT_CACHE_MS = 5000;

function isActiveState(s: GameStateId): boolean {
  return (
    s === "joining" ||
    s === "queued-heads" ||
    s === "queued-tails" ||
    s === "match-found" ||
    s === "flipping"
  );
}

function isFinalState(s: GameStateId): boolean {
  return s === "win" || s === "loss";
}

interface CompletedRound {
  matchId: string;
  result: Side;
  iWon: boolean;
}
const MobileInformation = dynamic(()=>import("@/components/mobile/MobileInformation"));

export function LiveGameClient() {
  const mobileNav = useMobileNavigation();
  const [socialView,setSocialView] = useState<"chat"|"leaderboard">("chat");
  const { account, wallet, signBytes, disconnect } = useWalletState();
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);
  const [walletOpen, setWalletOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inspectedWallet, setInspectedWallet] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);

  const address = account?.address ?? null;
  const { profile, reload: reloadProfile } = useProfile(address);
  const site = useSiteSettings();

  // Room selection: a tier is joinable only while its on-chain RoomState
  // exists + is active. $100/$1000 stay Opening Soon.
  const [selectedTier, setSelectedTier] = useState<number>(DEFAULT_TIER_USD);
  const selectedTierRef = useRef<number>(DEFAULT_TIER_USD);
  selectedTierRef.current = selectedTier;
  const [roomLive, setRoomLive] = useState<Record<number, boolean>>({});
  const roomLiveRef = useRef<Record<number, boolean>>({});
  roomLiveRef.current = roomLive;
  const roomProbeRef = useRef<{ at: number }>({ at: 0 });
  const liveTiers = [1, 10].filter((t) => roomLive[t]);
  const room = roomForTier(selectedTier);
  const usdCents = room?.usdCents ?? 100;

  const reloadSession = useCallback(() => {
    if (!address) {
      setSessionWallet(null);
      return;
    }
    void currentSessionWallet().then((w) => {
      setSessionWallet(w === address ? w : null);
    });
  }, [address]);

  useEffect(() => {
    reloadSession();
  }, [reloadSession, address]);

  // HT-FINAL-002: whenever ANY child flow (Profile verify, airdrop claim,
  // bug submit, chat auth) successfully establishes a wallet session, the
  // parent session state becomes aware immediately via the shared event.
  // No polling: ensureSession notifies, we refresh once.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cleared: (() => void) | undefined;
    void import("@/lib/auth/sessionEvents")
      .then((m) => {
        unsub = m.subscribeSessionEstablished(() => {
          reloadSession();
        });
        cleared = m.subscribeSessionCleared(() => {
          setSessionWallet(null);
        });
      })
      .catch(() => undefined);
    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
      try {
        cleared?.();
      } catch {
        // ignore
      }
    };
  }, [reloadSession]);

  // Referral attribution: store ?ref=CODE on landing (30 days), attribute
  // once the visitor connects + verifies (immutable, server-resolved).
  // After a successful Profile verification the pending ?ref= attribution
  // retries immediately because reloadSession() above flips sessionWallet.
  useEffect(() => {
    void import("@/lib/referrals/client")
      .then((m) => {
        try {
          m.storePendingReferralFromUrl();
        } catch {
          // ignore
        }
      })
      .catch(() => undefined);
  }, []);
  const refAttrRef = useRef<string | null>(null);
  useEffect(() => {
    if (!address || !sessionWallet) return;
    void import("@/lib/referrals/client")
      .then((m) => {
        const code = m.getPendingReferral();
        if (!code || refAttrRef.current === code) return;
        refAttrRef.current = code;
        void fetch("/api/referrals/attribute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        })
          .then(async (r) => {
            // fetch() resolving is NOT success: only TERMINAL successful
            // attribution clears the pending ref. Retryable failures
            // (401/429/5xx, network) preserve ht_pending_ref for retry
            // after auth/reconnect; self-referral is terminal-invalid.
            const b = (await r.json().catch(() => null)) as {
              status?: string;
              error?: string;
            } | null;
            if (
              r.ok &&
              (b?.status === "attributed" || b?.status === "already-attributed")
            ) {
              m.clearPendingReferral();
              return;
            }
            if (r.status === 400 && /self referral/i.test(b?.error ?? "")) {
              m.clearPendingReferral();
              return;
            }
            refAttrRef.current = null;
          })
          .catch(() => {
            refAttrRef.current = null;
          });
      })
      .catch(() => undefined);
  }, [address, sessionWallet]);

  // P0: inline chat auth-then-send. Send stays a CHAT action: verify wallet
  // ownership here, refresh session, return success so ChatPanel continues
  // the ORIGINAL send. Never opens Profile, never closes mobile chat.
  const ensureChatAuth = useCallback(async (): Promise<boolean> => {
    if (!wallet || !account || !address) return false;
    try {
      await ensureSession(wallet, account);
      await currentSessionWallet().then((w) => {
        setSessionWallet(w === address ? w : null);
      });
      return true;
    } catch {
      return false;
    }
  }, [wallet, account, address]);

  const anchorWallet = useMemo(
    () => (address ? createAnchorWallet(address, signBytes) : null),
    [address, signBytes],
  );

  const program = useMemo(() => {
    const provider = new AnchorProvider(
      connection,
      (anchorWallet ?? {}) as AnchorWallet,
      { commitment: "confirmed" },
    );
    return new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  }, [connection, anchorWallet]);

  const sdk = useMemo(() => {
    const [config] = configPda(program.programId);
    return new SdkClient(program, config, "hts");
  }, [program]);

  // Historical helper names retain cents, but this release always converts
  // nominal tier IDs to exact HTS units; it never promises a USD peg.
  const priceAdapter = useMemo(() => new DevnetUsdQuoteAdapter(), []);
  const roomProbePendingRef=useRef<Promise<void>|null>(null);
  const updateRoomLiveness=useCallback(async()=>{
    if(RPC_MISSING)return;
    if(roomProbePendingRef.current)return roomProbePendingRef.current;
    if(Date.now()-roomProbeRef.current.at<=30_000)return;
    roomProbeRef.current.at=Date.now();
    const pending=(async()=>{
      const results:Array<{tier:number;live:boolean|null}>=[];
      for(const tier of [1,10]){try{const value=await sdk.fetchRoom(tier);results.push({tier,live:value.active===true});}catch{results.push({tier,live:null});}}
      const merged=mergeRoomLiveness(roomLiveRef.current,results);
      if(merged.changed){roomLiveRef.current=merged.next;setRoomLive(merged.next);}
    })();
    roomProbePendingRef.current=pending;
    try{await pending;}finally{if(roomProbePendingRef.current===pending)roomProbePendingRef.current=null;}
  },[sdk]);
  useEffect(()=>{
    if(!mobileNav.mobile)return;
    const load=()=>{if(!document.hidden)void updateRoomLiveness();};
    load();const timer=setInterval(load,30_000);
    return()=>clearInterval(timer);
  },[mobileNav.mobile,updateRoomLiveness]);

  const [liveState, setLiveState] = useState<GameStateId>("disconnected");
  const [override, setOverride] = useState<GameStateId | null>(null);
  const [selectedSide, setSelectedSide] = useState<Side | null>(null);
  const [matchResult, setMatchResult] = useState<Side | null>(null);
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [busyKind, setBusyKind] = useState<"join" | "leave" | null>(null);
  const busyRef = useRef(false);
  const lastMatchRequestAt = useRef(0);
  const [hasPosition, setHasPosition] = useState(false);
  const [queue, setQueue] = useState<{ heads: number; tails: number } | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryResult>({ status: "empty" });
  // Ready copy is Pick Side — never a Loading… placeholder in user-facing UX.
  // entryLabel is kept for internal quote tracking; main status copy stays
  // simplified (ready copy only, no quote internals).
  const [, setEntryLabel] = useState<string>("Pick Side");
  const [visible, setVisible] = useState(true);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [tokenBalanceLabel, setTokenBalanceLabel] = useState<string | null>(
    null,
  );
  const [tokenBalanceBaseUnits, setTokenBalanceBaseUnits] = useState<
    bigint | null
  >(null);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [lastCompleted, setLastCompleted] = useState<CompletedRound | null>(
    null,
  );
  // Ref mirrors so the polling refresh closure always sees fresh values
  // without re-subscribing the interval on every round transition.
  const activeMatchIdRef = useRef<string | null>(null);
  activeMatchIdRef.current = activeMatchId;
  const lastCompletedRef = useRef<CompletedRound | null>(null);
  lastCompletedRef.current = lastCompleted;
  // A revealed ORAO result is presentation evidence, not proof of payout.
  const [revealedRound,setRevealedRound]=useState<(CompletedRound & {wallet:string})|null>(null);
  const revealedRoundRef=useRef(revealedRound);
  revealedRoundRef.current=revealedRound;
  const dismissedResultRef=useRef<{wallet:string;matchId:string}|null>(null);
  // A settled result stays anchored until the player explicitly continues.
  const [settlePending, setSettlePending] = useState(false);
  const settlePendingRef = useRef(settlePending);
  settlePendingRef.current = settlePending;
  const [settleLine, setSettleLine] = useState<string | null>(null);
  const [retryPayoutBusy, setRetryPayoutBusy] = useState(false);
  // Authoritative HTS quote and balance checks.
  const selRef = useRef<Side | null>(null);
  selRef.current = selectedSide;
  const hasPositionRef = useRef(false);
  hasPositionRef.current = hasPosition;
  const matchedAtRef = useRef<number | null>(null);
  const lockedStakeRef = useRef<bigint | null>(null);
  const stateRef = useRef<GameStateId>("disconnected");
  stateRef.current = liveState;
  const addressRef = useRef<string | null>(null);
  addressRef.current = address;
  const lastAddressRef = useRef<string | null>(null);
  // Local-intent epoch + explicit intent lock: stale refresh must never clear
  // a newer user selection (selection-reset race fix).
  const selectionEpochRef = useRef(0);
  const intentRef = useRef<SelectionIntent | null>(null);
  const settledSeenRef = useRef<Set<string>>(new Set());
  const ensureSentRef = useRef<Set<string>>(new Set());
  // Minimum 5s Flipping presentation (presentation-only; chain never delayed).
  // Timing anchor is visibleFlipStartedAtRef (post-render). Round ownership
  // is flipMatchIdRef. There is intentionally no observation-time start
  // ref: pre-network timestamps must never drive the reveal timer.
  const pendingFlipRef = useRef<{
    matchId: string;
    resultSide: Side;
    iWon: boolean;
    settled: boolean;
    arrivedAt: number;
  } | null>(null);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setFlipTick] = useState(0);
  const bumpEpoch = useCallback(() => {
    selectionEpochRef.current += 1;
  }, []);
  const snapshotCacheRef = useRef<{
    at: number;
    tier: number;
    data: QueueSnapshot | null;
  }>({ at: 0, tier: 1, data: null });

  // Which live Match ID currently owns the flip presentation. First
  // observation registers it; repeat polls must never re-register it; round
  // resets release it. Ownership (live vs historical) is separate from the
  // VISIBLE presentation start below.
  const flipMatchIdRef = useRef<string | null>(null);
  // When the Flipping presentation for a Match ID actually committed to
  // the screen (post-render anchor). The 5000ms reveal timer runs from
  // here — never from pre-network observation time.
  const visibleFlipStartedAtRef = useRef<{
    matchId: string;
    startedAt: number;
  } | null>(null);

  const resetFlipReveal = useCallback((matchId?: string | null) => {
    if (
      matchId &&
      pendingFlipRef.current &&
      pendingFlipRef.current.matchId !== matchId
    ) {
      // New match gets a fresh timer.
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
      pendingFlipRef.current = null;
      flipMatchIdRef.current = null;
      visibleFlipStartedAtRef.current = null;
      return;
    }
    if (!matchId) {
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
      pendingFlipRef.current = null;
      flipMatchIdRef.current = null;
      visibleFlipStartedAtRef.current = null;
    }
  }, []);

  // Shared round reset (Play Again + automatic Ready after the result
  // hold): identical clean ready state from either path. Presentation-only;
  // chain/settlement/payout/profile/history are untouched and never wait.
  const resetRoundState = useCallback(() => {
    if(revealedRoundRef.current) dismissedResultRef.current=revealedRoundRef.current;
    bumpEpoch();
    intentRef.current = null;
    resetFlipReveal();
    setLastCompleted(null);
    lastCompletedRef.current=null;
    setRevealedRound(null);
    revealedRoundRef.current=null;
    setSelectedSide(null);
    selRef.current=null;
    setLiveState(addressRef.current ? "ready" : "disconnected");
    setHasPosition(false);
    hasPositionRef.current=false;
    setMatchResult(null);
    setSettlePending(false);
    setSettleLine(null);
    setDetail(undefined);
    lockedStakeRef.current = null;
    matchedAtRef.current = null;
    setActiveMatchId(null);
    setQueuePos(null);
  }, [bumpEpoch, resetFlipReveal]);

  const revealFlipResult = useCallback(
    (matchId: string, resultSide: Side, iWon: boolean, settled: boolean) => {
      pendingFlipRef.current = null;
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
      setMatchResult(resultSide);
      setRevealedRound({matchId,result:resultSide,iWon,wallet:addressRef.current ?? ""});
      setLiveState(iWon ? "win" : "loss");
      if (settled) {
        setSettlePending(false);
        setSettleLine(iWon ? "Payout sent ✓" : null);
        setLastCompleted({ matchId, result: resultSide, iWon });
        setDetail(resultSide);
      } else {
        // The result is known; payout confirmation is a separate state.
        setSettlePending(true);
        setSettleLine("Finalizing payout…");
        setDetail(resultSide);
      }
      setFlipTick((t) => t + 1);
    },
    [],
  );

  // Single scheduling point for delayed reveals: (re)arms the timer for
  // exactly one Match ID. The callback re-reads the CURRENT pending entry
  // at fire time, so fulfilled→settled upgrades reveal the latest data.
  const scheduleFlipReveal = useCallback(
    (forMatchId: string, delayMs: number) => {
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
      flipTimerRef.current = setTimeout(
        () => {
          const p = pendingFlipRef.current;
          if (p && p.matchId === forMatchId) {
            revealFlipResult(p.matchId, p.resultSide, p.iWon, p.settled);
          }
        },
        Math.max(0, delayMs),
      );
    },
    [revealFlipResult],
  );

  const showError = useCallback((e: unknown) => {
    const c = classifyError(e);
    setLiveState("error");
    setDetail(c.message);
  }, []);

  const loadHistory = useCallback(async (tier?: number) => {
    const t = tier ?? selectedTierRef.current;
    const h = await fetchRecentFlips(50, t);
    setHistory(h);
  }, []);

  const refreshQueueSnapshot = useCallback(
    async (tier?: number): Promise<QueueSnapshot | null> => {
      const t = tier ?? selectedTierRef.current;
      const cached = snapshotCacheRef.current;
      if (
        cached.data &&
        cached.tier === t &&
        Date.now() - cached.at < SNAPSHOT_CACHE_MS
      )
        return cached.data;
      try {
        // Every room (including $1) reads its tier-scoped V2 RoomState. The
        // legacy V1 global pool is drain-only and never used for new joins.
        const roomState = await sdk.fetchRoom(t);
        const snap = await fetchRoomQueueSnapshot(
          connection,
          program.programId,
          t,
          {
            headsHead: roomState.headsHead,
            headsNext: roomState.headsNext,
            tailsHead: roomState.tailsHead,
            tailsNext: roomState.tailsNext,
          },
        );
        snapshotCacheRef.current = { at: Date.now(), tier: t, data: snap };
        setQueue({ heads: snap.headsActive, tails: snap.tailsActive });
        return snap;
      } catch {
        // Room uninitialized/unreadable: honest empty, never another tier's
        // cached counts.
        if (t !== (snapshotCacheRef.current.tier ?? 1)) setQueue(null);
        return cached.tier === t ? cached.data : null;
      }
    },
    [connection, program, sdk],
  );

  const refreshBalances = useCallback(
    async (owner: PublicKey): Promise<void> => {
      try {
        if (!PROJECT_TOKEN_MINT) {
          setTokenBalanceLabel(null);
          setTokenBalanceBaseUnits(null);
          return;
        }
        const mint = new PublicKey(PROJECT_TOKEN_MINT);
        const ata = await getAssociatedTokenAddress(mint, owner);
        const bal = await connection
          .getTokenAccountBalance(ata)
          .catch(() => null);
        if (!bal) {
          setTokenBalanceLabel(null);
          setTokenBalanceBaseUnits(null);
          return;
        }
        try {
          setTokenBalanceBaseUnits(BigInt(bal.value.amount));
        } catch {
          setTokenBalanceBaseUnits(null);
        }
        const ui =
          bal.value.uiAmountString ??
          (() => {
            try {
              return (
                Number(BigInt(bal.value.amount)) /
                10 ** TOKEN_DECIMALS
              ).toFixed(2);
            } catch {
              return null;
            }
          })();
        setTokenBalanceLabel(ui === null ? null : `${ui} ${TOKEN_SYMBOL}`);
      } catch {
        setTokenBalanceLabel(null);
        setTokenBalanceBaseUnits(null);
      }
    },
    [connection],
  );
  const refreshBalancesRef = useRef(refreshBalances);
  refreshBalancesRef.current = refreshBalances;

  // DEVNET-ONLY first-connect auto-grant (no visible faucet button).
  // Server ledger is authoritative; refreshes balance after a grant.
  const welcomeGranted = useCallback(() => {
    if (!addressRef.current) return;
    try {
      const me = new PublicKey(addressRef.current);
      void refreshBalancesRef.current(me);
    } catch {
      // ignore; next refresh cycle picks it up
    }
    reloadProfile();
  }, [reloadProfile]);
  useDevnetWelcomeTokens(address, welcomeGranted, sessionWallet === address);

  const ensureAutoSettlement = useCallback(
    async (matchId: string) => {
      if (ensureSentRef.current.has(matchId)) return;
      ensureSentRef.current.add(matchId);
      try {
        const res = await fetch("/api/settlement/ensure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ matchId }),
        });
        if (res.ok) {
          // Indexing/profile refresh happens when the chain shows Settled.
          await loadHistory();
        } else {
          ensureSentRef.current.delete(matchId);
          setSettleLine("Payout pending — recovery will retry. You can retry safely.");
        }
      } catch {
        // Reconciler + next refresh cycle retry; never surface infra errors.
        ensureSentRef.current.delete(matchId);
      }
    },
    [loadHistory],
  );

  // Settlement resets PlayerState to idle. Confirm the previously revealed
  // match itself before enabling replay; idle alone never proves payout.
  const reconcileIdleResult=useCallback(async(walletAddress:string)=>{
    const shown=revealedRoundRef.current;
    const matchId=pendingFlipRef.current?.matchId ?? (shown?.wallet===walletAddress ? shown.matchId : null);
    if(!matchId || intentRef.current!==null)return false;
    if(lastCompletedRef.current?.matchId===matchId)return true;
    const epoch=selectionEpochRef.current;
    try{
      const [pk]=matchPda(program.programId,BigInt(matchId));
      const m=await program.account.match.fetch(pk);
      if(addressRef.current!==walletAddress || selectionEpochRef.current!==epoch ||
        (activeMatchIdRef.current!==null && activeMatchIdRef.current!==matchId))return false;
      if(Object.keys(m.state as object)[0]!=="settled")return shown?.matchId===matchId;
      const me=new PublicKey(walletAddress);
      if(!(m.headsPlayer as PublicKey).equals(me) && !(m.tailsPlayer as PublicKey).equals(me))return false;
      const resultSide:Side=Object.keys(m.result as object)[0]==="heads" ? "HEADS" : "TAILS";
      const mySide:Side=(m.headsPlayer as PublicKey).equals(me) ? "HEADS" : "TAILS";
      const completed={matchId,result:resultSide,iWon:resultSide===mySide};
      setHasPosition(false);hasPositionRef.current=false;
      if(pendingFlipRef.current?.matchId===matchId){
        pendingFlipRef.current={...pendingFlipRef.current,settled:true,resultSide,iWon:completed.iWon};
      }else{
        setLastCompleted(completed);lastCompletedRef.current=completed;
        setRevealedRound({...completed,wallet:walletAddress});
        setMatchResult(resultSide);setLiveState(completed.iWon ? "win" : "loss");
        setSettlePending(false);setSettleLine(completed.iWon ? "Payout sent ✓" : null);setDetail(resultSide);
      }
      if(!settledSeenRef.current.has(matchId)){settledSeenRef.current.add(matchId);reloadProfile();void loadHistory();}
      return true;
    }catch{
      // Keep the known result and pending payout during transient read failures.
      return shown?.wallet===walletAddress && shown.matchId===matchId;
    }
  },[program,reloadProfile,loadHistory]);

  const refresh = useCallback(async () => {
    if (RPC_MISSING) {
      setLiveState(
        commitPassiveState(
          {
            proposedState: "error",
            reason: "refresh-rpc-missing",
            responseEpoch: null,
            responseTier: null,
            responseIntentId: null,
            chainHasPosition: false,
          },
          {
            intent: intentRef.current,
            currentEpoch: selectionEpochRef.current,
            currentTier: selectedTierRef.current,
            hasChainPosition: hasPositionRef.current,
          },
        ).state,
      );
      setDetail(
        "Network configuration is missing (dedicated Devnet RPC). Public api.devnet.solana.com must not be the primary QA RPC — set NEXT_PUBLIC_RPC_URL.",
      );
      return;
    }
    if (typeof document !== "undefined" && document.hidden) return;
    // Local-intent snapshot: stale refresh must not clear newer selection.
    const epoch0 = selectionEpochRef.current;
    const sel0 = selRef.current;
    const intent0 = intentRef.current;
    const tier0 = selectedTierRef.current;
    const meAddr = addressRef.current;
    // Wallet account change (A -> B) intentionally resets selection state.
    // Null gaps (silent restore) do not: reconnecting the same wallet keeps
    // any pending explicit intent.
    if (
      meAddr !== null &&
      lastAddressRef.current !== null &&
      meAddr !== lastAddressRef.current
    ) {
      traceTransition({
        reason: "wallet-account-changed",
        from: stateRef.current,
        proposed: "ready",
        committed: "ready",
        intentSide: intentRef.current?.side ?? null,
        intentId: intentRef.current?.intentId ?? null,
        startEpoch: epoch0,
        currentEpoch: selectionEpochRef.current,
        tier: selectedTierRef.current,
        responseTier: tier0,
        chainHasPosition: false,
      });
      bumpEpoch();
      intentRef.current = null;
      resetFlipReveal();
      setSelectedSide(null);
      setRevealedRound(null);
      setLastCompleted(null);
      dismissedResultRef.current=null;
      setMatchResult(null);
      setDetail(undefined);
    }
    lastAddressRef.current = meAddr;
    // Public queue state loads WITHOUT a wallet (no mock counts), per room.
    await refreshQueueSnapshot(tier0);
    if (!meAddr) {
      // Keep an unsubmitted pick (and its Back control) during connection;
      // a disconnected poll must not replace the owner's explicit intent.
      setLiveState(intentRef.current ? (intentRef.current.side==="HEADS" ? "heads-selected" : "tails-selected") : "disconnected");
      setHasPosition(false);
      setQueuePos(null);
      setTokenBalanceLabel(null);
      setTokenBalanceBaseUnits(null);
      setSettlePending(false);
      setSettleLine(null);
      matchedAtRef.current = null;
      resetFlipReveal();
      return;
    }
    const address = meAddr;
    const expectedChain = IS_DEVNET ? "solana:devnet" : "solana:mainnet";
    const walletChains = account?.chains ?? [];
    if (walletChains.length > 0 && !walletChains.includes(expectedChain)) {
      setLiveState("error");
      setDetail(
        `Wallet is on ${walletChains[0] ?? "an unknown network"} — switch to ${
          IS_DEVNET ? "Solana Devnet" : "Solana Mainnet"
        } in your wallet to play.`,
      );
      return;
    }
    try {
      const cfg = await sdk.fetchConfig();
      if (cfg.paused) {
        setLiveState("paused");
        setDetail(
          "New joins are disabled by game config. Existing matches still settle.",
        );
        return;
      }
      if (!PROJECT_TOKEN_MINT) {
        setLiveState(
          commitPassiveState(
            {
              proposedState: "error",
              reason: "refresh-mint-missing",
              responseEpoch: null,
              responseTier: null,
              responseIntentId: null,
              chainHasPosition: false,
            },
            {
              intent: intentRef.current,
              currentEpoch: selectionEpochRef.current,
              currentTier: selectedTierRef.current,
              hasChainPosition: hasPositionRef.current,
            },
          ).state,
        );
        setDetail(
          "Project token mint is not configured yet (devnet setup in progress).",
        );
        return;
      }
      // Room liveness probe (30s cache): a tier opens only with a confirmed
      // live on-chain RoomState. A failed probe keeps last-known values so a
      // flaky response can never flip live rooms (or a pending selection);
      // Join paths re-validate the room live before signing anything.
      await updateRoomLiveness();
      // Room gate: joins only with a live on-chain room; a tier must never
      // pretend to be OPEN beforehand. This gate previously reset an explicit
      // user selection to Ready on every background refresh while rooms were
      // unconfirmed (the video bug). It now preserves pending intent, and it
      // never strands a queued user on stale room data.
      const liveNow: number[] = [1, 10].filter((t) => roomLiveRef.current[t]);
      if (!isRoomJoinable(tier0, liveNow)) {
        if (hasPositionRef.current) return; // keep current view; Leave still works
        const gated = commitPassiveState(
          {
            proposedState: "ready",
            reason: "room-gate",
            responseEpoch: epoch0,
            responseTier: tier0,
            responseIntentId: intent0?.intentId ?? null,
            chainHasPosition: false,
          },
          {
            intent: intentRef.current,
            currentEpoch: selectionEpochRef.current,
            currentTier: selectedTierRef.current,
            hasChainPosition: false,
          },
        );
        traceTransition({
          reason: "room-gate",
          from: stateRef.current,
          proposed: "ready",
          committed: gated.state,
          intentSide: intentRef.current?.side ?? null,
          intentId: intentRef.current?.intentId ?? null,
          startEpoch: epoch0,
          currentEpoch: selectionEpochRef.current,
          tier: selectedTierRef.current,
          responseTier: tier0,
          chainHasPosition: false,
        });
        setLiveState(gated.state);
        setDetail(
          tier0 === 10
            ? `${ROOM_ACTIVATION_COPY} — 10 HTS opens automatically once its on-chain room is live.`
            : "This room is Opening Soon.",
        );
        return;
      }
      const me = new PublicKey(address);
      await refreshBalances(me);
      const [playerStatePk] = playerPda(program.programId, me);
      const pinfo = await connection.getAccountInfo(playerStatePk);
      if (!pinfo) {
        if(await reconcileIdleResult(address))return;
        // RACE HOLD (match #50 flash): settlement landed mid-presentation
        // and the account is already gone while this round's 5s result
        // reveal is still pending. The round is not over presentationally —
        // hold Flipping until the timer fires; never flash Pick a side.
        if (pendingFlipRef.current !== null) {
          traceTransition({
            reason: "no-account-pending-reveal-hold",
            from: stateRef.current,
            proposed: "flipping",
            committed: "flipping",
            intentSide: intentRef.current?.side ?? null,
            intentId: intentRef.current?.intentId ?? null,
            startEpoch: epoch0,
            currentEpoch: selectionEpochRef.current,
            tier: selectedTierRef.current,
            responseTier: tier0,
            chainHasPosition: false,
          });
          setLiveState("flipping");
          setDetail("Flipping...");
          return;
        }
        setHasPosition(false);
        setQueuePos(null);
        setActiveMatchId(null);
        setSettlePending(false);
        setSettleLine(null);
        matchedAtRef.current = null;
        try {
          const quote = await priceAdapter.getQuote(PROJECT_TOKEN_MINT);
          const stake = stakeForUsd(quote, usdCents);
          const roomLabel = roomForTier(tier0)?.label ?? `$${tier0}`;
          setEntryLabel(
            `Entry ≈ ${stake.toLocaleString("en-US")} base units ≈ ${roomLabel}`,
          );
          // Stale-refresh guards: epoch + explicit intent lock + room pin.
          if (
            !shouldCommitSelectionRefresh({
              startEpoch: epoch0,
              currentEpoch: selectionEpochRef.current,
              selAtStart: sel0,
              selNow: selRef.current,
              chainHasPosition: false,
            })
          ) {
            return;
          }
          const curIntent = intentRef.current;
          if (
            !mayClearIntentForRefresh({
              intent: curIntent,
              responseTierUsd: tier0,
              responseIntentId: intent0?.intentId ?? null,
              chainHasPosition: false,
            }) &&
            curIntent !== null &&
            (curIntent.intentId !== intent0?.intentId ||
              selectedTierRef.current !== tier0)
          ) {
            return;
          }
          if (selectedTierRef.current !== tier0) return;
          const sel = selRef.current;
          const solBal = await connection.getBalance(me).catch(() => null);
          const mint = new PublicKey(PROJECT_TOKEN_MINT);
          const ata = await getAssociatedTokenAddress(mint, me);
          const bal = await connection
            .getTokenAccountBalance(ata)
            .catch(() => null);
          const balLabel = bal
            ? `Balance ${BigInt(bal.value.amount).toLocaleString("en-US")}`
            : "Balance unknown";
          if (
            solBal !== null &&
            solBal < 2_000_000 &&
            !DEVNET_SPONSOR_UI_ENABLED
          ) {
            // Intent-preserving: a passive balance read must not clear an
            // explicit selection (Confirm re-validates funds anyway).
            const solGate = commitPassiveState(
              {
                proposedState: "insufficient-balance",
                reason: "refresh-low-sol",
                responseEpoch: epoch0,
                responseTier: tier0,
                responseIntentId: intent0?.intentId ?? null,
                chainHasPosition: false,
              },
              {
                intent: intentRef.current,
                currentEpoch: selectionEpochRef.current,
                currentTier: selectedTierRef.current,
                hasChainPosition: false,
              },
            );
            traceTransition({
              reason: "refresh-low-sol",
              from: stateRef.current,
              proposed: "insufficient-balance",
              committed: solGate.state,
              intentSide: intentRef.current?.side ?? null,
              intentId: intentRef.current?.intentId ?? null,
              startEpoch: epoch0,
              currentEpoch: selectionEpochRef.current,
              tier: selectedTierRef.current,
              responseTier: tier0,
              chainHasPosition: false,
            });
            setLiveState(solGate.state);
            setDetail(
              "Insufficient SOL for transaction fees. Top up a little Devnet SOL — your project-token balance is unaffected.",
            );
            return;
          }
          if (sel) {
            if (bal && BigInt(bal.value.amount) < stake) {
              const tokGate = commitPassiveState(
                {
                  proposedState: "insufficient-balance",
                  reason: "refresh-low-tokens",
                  responseEpoch: epoch0,
                  responseTier: tier0,
                  responseIntentId: intent0?.intentId ?? null,
                  chainHasPosition: false,
                },
                {
                  intent: intentRef.current,
                  currentEpoch: selectionEpochRef.current,
                  currentTier: selectedTierRef.current,
                  hasChainPosition: false,
                },
              );
              traceTransition({
                reason: "refresh-low-tokens",
                from: stateRef.current,
                proposed: "insufficient-balance",
                committed: tokGate.state,
                intentSide: intentRef.current?.side ?? null,
                intentId: intentRef.current?.intentId ?? null,
                startEpoch: epoch0,
                currentEpoch: selectionEpochRef.current,
                tier: selectedTierRef.current,
                responseTier: tier0,
                chainHasPosition: false,
              });
              setLiveState(tokGate.state);
              setDetail(
                `Insufficient HTS: you need ${stake.toLocaleString("en-US")} base units for a ${roomLabel} flip (${balLabel}).`,
              );
              return;
            }
            setLiveState(sel === "HEADS" ? "heads-selected" : "tails-selected");
            // Simplified Pick-Side copy: no base-unit quote details in main status.
            setDetail(`${balLabel} • ${roomLabel} room`);
            return;
          }
          // No selection to show: route through the central passive commit so
          // a stale response can never clear a newer explicit intent.
          const noSel = commitPassiveState(
            {
              proposedState: "ready",
              reason: "refresh-no-selection",
              responseEpoch: epoch0,
              responseTier: tier0,
              responseIntentId: intent0?.intentId ?? null,
              chainHasPosition: false,
            },
            {
              intent: intentRef.current,
              currentEpoch: selectionEpochRef.current,
              currentTier: selectedTierRef.current,
              hasChainPosition: false,
            },
          );
          traceTransition({
            reason: "refresh-no-selection",
            from: stateRef.current,
            proposed: "ready",
            committed: noSel.state,
            intentSide: intentRef.current?.side ?? null,
            intentId: intentRef.current?.intentId ?? null,
            startEpoch: epoch0,
            currentEpoch: selectionEpochRef.current,
            tier: selectedTierRef.current,
            responseTier: tier0,
            chainHasPosition: false,
          });
          setLiveState(noSel.state);
          // Simplified ready copy: default GameStatePanel body shows
          // Pick Side / Pick HEADS or TAILS. No Loading, no base-unit quote.
          void balLabel;
          void roomLabel;
          setDetail(undefined);
        } catch (e) {
          if (e instanceof StaleQuoteError) {
            // A stale/slow price response must not clear explicit intent.
            const staleQ = commitPassiveState(
              {
                proposedState: "price-unavailable",
                reason: "refresh-stale-quote",
                responseEpoch: epoch0,
                responseTier: tier0,
                responseIntentId: intent0?.intentId ?? null,
                chainHasPosition: false,
              },
              {
                intent: intentRef.current,
                currentEpoch: selectionEpochRef.current,
                currentTier: selectedTierRef.current,
                hasChainPosition: false,
              },
            );
            traceTransition({
              reason: "refresh-stale-quote",
              from: stateRef.current,
              proposed: "price-unavailable",
              committed: staleQ.state,
              intentSide: intentRef.current?.side ?? null,
              intentId: intentRef.current?.intentId ?? null,
              startEpoch: epoch0,
              currentEpoch: selectionEpochRef.current,
              tier: selectedTierRef.current,
              responseTier: tier0,
              chainHasPosition: false,
            });
            setLiveState(staleQ.state);
            setDetail(
              "Token price feed is unavailable. Entry amount hidden until it recovers.",
            );
          } else {
            throw e;
          }
        }
        return;
      }
      // Compat read: legacy V1 accounts (60 bytes) throw under the V2 IDL
      // coder. Normalize either layout before branching.
      const st = await fetchPlayerStateCompat(connection, playerStatePk);
      if((!st || (!st.queued && !st.inMatch)) && await reconcileIdleResult(address))return;
      if (!st) {
        // RACE HOLD (match #50 flash): same as the missing-account branch —
        // an undecodable/absent state with a pending reveal means settlement
        // landed mid-presentation. Hold Flipping until the timer fires.
        if (pendingFlipRef.current !== null) {
          traceTransition({
            reason: "no-state-pending-reveal-hold",
            from: stateRef.current,
            proposed: "flipping",
            committed: "flipping",
            intentSide: intentRef.current?.side ?? null,
            intentId: intentRef.current?.intentId ?? null,
            startEpoch: epoch0,
            currentEpoch: selectionEpochRef.current,
            tier: selectedTierRef.current,
            responseTier: tier0,
            chainHasPosition: false,
          });
          setLiveState("flipping");
          setDetail("Flipping...");
          return;
        }
        setHasPosition(false);
        matchedAtRef.current = null;
        setQueuePos(null);
        setActiveMatchId(null);
        setSettlePending(false);
        setSettleLine(null);
        // Missing account with a pending explicit intent keeps the intent
        // visible (stale null read must not clear a newer selection).
        const noAcct = commitPassiveState(
          {
            proposedState: "ready",
            reason: "refresh-no-account",
            responseEpoch: epoch0,
            responseTier: tier0,
            responseIntentId: intent0?.intentId ?? null,
            chainHasPosition: false,
          },
          {
            intent: intentRef.current,
            currentEpoch: selectionEpochRef.current,
            currentTier: selectedTierRef.current,
            hasChainPosition: false,
          },
        );
        traceTransition({
          reason: "refresh-no-account",
          from: stateRef.current,
          proposed: "ready",
          committed: noAcct.state,
          intentSide: intentRef.current?.side ?? null,
          intentId: intentRef.current?.intentId ?? null,
          startEpoch: epoch0,
          currentEpoch: selectionEpochRef.current,
          tier: selectedTierRef.current,
          responseTier: tier0,
          chainHasPosition: false,
        });
        setLiveState(noAcct.state);
        setDetail(undefined);
        return;
      }
      if (st.queued) {
        setHasPosition(true);
        const side = (st.queuedSide as number) === 0 ? "HEADS" : "TAILS";
        // Chain proves queue entry: intent fulfilled, never stale.
        intentRef.current = null;
        resetFlipReveal();
        setSelectedSide(side);
        setActiveMatchId(null);
        setSettlePending(false);
        setSettleLine(null);
        matchedAtRef.current = null;
        setLiveState(side === "HEADS" ? "queued-heads" : "queued-tails");
        try {
          // Legacy global (V1-layout) positions have no V2 room position:
          // never query the room reader for them — plain "In Queue".
          // Correct cancellation matters more than a position number.
          if (st.schema === "v1") {
            setQueuePos(null);
          } else {
            const seq = st.queuedSequence;
            const queuedTier = st.queuedTierUsd || tier0 || 1;
            // All rooms resolve queue position from their tier-scoped RoomState.
            const roomState = await sdk.fetchRoom(queuedTier).catch(() => null);
            if (!roomState) {
              setQueuePos(null);
            } else {
              const head =
                side === "HEADS" ? roomState.headsHead : roomState.tailsHead;
              const pos = await fetchUserRoomQueuePosition(
                connection,
                program.programId,
                queuedTier,
                side === "HEADS" ? 0 : 1,
                seq,
                head,
              );
              setQueuePos("position" in pos ? pos.position : null);
              // A confirmed join can outlive the original browser request.
              // Give an already-queued player a bounded retry without a new join.
              if (sessionWallet === address && !document.hidden && !busyRef.current &&
                  (queuedTier === 1 || queuedTier === 10) && roomState.active &&
                  roomState.headsHead < roomState.headsNext &&
                  roomState.tailsHead < roomState.tailsNext &&
                  Date.now() - lastMatchRequestAt.current >= 60_000) {
                lastMatchRequestAt.current = Date.now();
                void fetch("/api/devnet/match-crank-room", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ tierUsd: queuedTier }),
                }).catch(() => null);
              }
            }
          }
        } catch {
          setQueuePos(null);
        }
        void lockedStakeRef.current;
        setDetail("Waiting for a player...");
        return;
      }
      if (st.inMatch) {
        const matchId = st.matchId;
        const dismissed=()=>dismissedResultRef.current?.wallet===address && dismissedResultRef.current.matchId===matchId.toString();
        if(dismissed())return; // A stale read cannot reopen a manually dismissed settled round.
        setHasPosition(true);
        setActiveMatchId(matchId.toString());
        // LIVE-ROUND OWNERSHIP (0ms-flip race): authoritative
        // PlayerState.inMatch for THIS Match ID proves it is the current
        // round — not history. Register it synchronously, before the
        // Match/ORAO reads below can observe an already-fulfilled/settled
        // result, so no fast read can bypass the presentation hold. Repeat
        // polls for the same ID must never re-register. The 5000ms timer
        // itself is anchored separately, post-render, when Flipping
        // actually commits (see the visible-start effect below) — never
        // from pre-network observation time.
        if (
          classifyMatchObservation({
            trackedMatchId: flipMatchIdRef.current,
            observedMatchId: matchId.toString(),
          }) === "init-new-round"
        ) {
          flipMatchIdRef.current = matchId.toString();
          // A new round supersedes any stale pending reveal state.
          if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
          flipTimerRef.current = null;
          pendingFlipRef.current = null;
        }
        const [mpda] = matchPda(program.programId, matchId);
        const m = await program.account.match.fetch(mpda);
        const mState = Object.keys(m.state as object)[0];
        if(dismissed())return;
        const mySide = (m.headsPlayer as PublicKey).equals(me)
          ? "HEADS"
          : "TAILS";
        // Chain proves match entry.
        intentRef.current = null;
        setSelectedSide(mySide);
        // Minimum 5s Flipping presentation (presentation-only). Settlement,
        // ORAO reads and payouts are never delayed — the result is stored
        // internally while Flipping stays visible.
        //
        // VISIBLE-ANCHORED hold: this only stores the result (with its
        // arrival time) and commits the Flipping visuals. The reveal timer
        // is armed by the post-commit visible-start effect below — never
        // here — so pre-paint network latency cannot consume presentation
        // time. If Flipping is ALREADY visibly anchored for this match
        // (result arrived later, e.g. fulfilled→settled upgrade), reschedule
        // from the anchor so the reveal honors max(visible+5000, arrival).
        const holdAndReveal = (
          resultSide: Side,
          iWon: boolean,
          settled: boolean,
        ) => {
          const now = Date.now();
          pendingFlipRef.current = {
            matchId: matchId.toString(),
            resultSide,
            iWon,
            settled,
            arrivedAt: now,
          };
          setMatchResult(null);
          setLiveState("flipping");
          setSettlePending(true);
          setSettleLine("Flipping...");
          setDetail("Flipping...");
          // Force a render so the coin reads the fresh pending result face
          // and reveal timestamp (liveState may already be flipping).
          setFlipTick((t) => t + 1);
          const anchored = visibleFlipStartedAtRef.current;
          if (anchored && anchored.matchId === matchId.toString()) {
            scheduleFlipReveal(
              matchId.toString(),
              planVisibleReveal({
                visibleStartedAtMs: anchored.startedAt,
                resultArrivedAtMs: now,
                nowMs: now,
              }).delayMs,
            );
          }
        };
        if (mState === "settled") {
          const res = Object.keys(m.result as object)[0];
          const resultSide = res === "heads" ? "HEADS" : "TAILS";
          const iWon = resultSide === mySide;
          // VISIBLE-ANCHORED hold: reveal no earlier than 5000ms after
          // Flipping actually renders. When this settled read IS the first
          // observation (no visible anchor yet), store + commit flipping —
          // the post-commit effect anchors and schedules. Never reveal
          // immediately for a live round.
          const now = Date.now();
          const anchored = visibleFlipStartedAtRef.current;
          const anchoredForMatch =
            anchored && anchored.matchId === matchId.toString()
              ? anchored
              : null;
          const delay = anchoredForMatch
            ? planVisibleReveal({
                visibleStartedAtMs: anchoredForMatch.startedAt,
                resultArrivedAtMs: now,
                nowMs: now,
              }).delayMs
            : 1;
          if (delay > 0) {
            holdAndReveal(resultSide, iWon, true);
            if (!settledSeenRef.current.has(matchId.toString())) {
              settledSeenRef.current.add(matchId.toString());
              reloadProfile();
              void loadHistory();
            }
            return;
          }
          // 5s visibly elapsed: reveal immediately.
          if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
          flipTimerRef.current = null;
          pendingFlipRef.current = null;
          setMatchResult(resultSide);
          setRevealedRound({matchId:matchId.toString(),result:resultSide,iWon,wallet:address});
          setLiveState(iWon ? "win" : "loss");
          setSettlePending(false);
          setSettleLine(iWon ? "Payout sent ✓" : null);
          setLastCompleted({
            matchId: matchId.toString(),
            result: resultSide,
            iWon,
          });
          setDetail(resultSide);
          if (!settledSeenRef.current.has(matchId.toString())) {
            settledSeenRef.current.add(matchId.toString());
            reloadProfile();
            void loadHistory();
          }
          return;
        }
        const seed = Buffer.from(m.seed as unknown as number[]);
        const r = await fetchRandomnessStatus(connection, seed);
        if (r.kind === "fulfilled") {
          const resultSide = r.resultBit === 0 ? "HEADS" : "TAILS";
          const iWon = resultSide === mySide;
          // Fire-and-forget server settlement FIRST (idempotent, no wallet
          // sig): chain work is never delayed by the 5s presentation.
          void ensureAutoSettlement(matchId.toString());
          // Automatic payout in flight: no Claim/Settle buttons, ever.
          holdAndReveal(resultSide, iWon, false);
          return;
        }
        // Still flipping (result not yet known): the visible-start effect
        // anchors the timer when this Flipping commit renders.
        pendingFlipRef.current = null;
        setMatchResult(null);
        setSettlePending(false);
        setSettleLine(null);
        if (matchedAtRef.current === null) matchedAtRef.current = Date.now();
        void MIN_FLIP_REVEAL_MS;
        const fresh = Date.now() - matchedAtRef.current < 8000;
        setLiveState(fresh ? "match-found" : "flipping");
        setDetail("Flipping...");
        return;
      }
      // RACE FIX (match #50 flash): settlement can land mid-presentation,
      // so this poll may observe idle PlayerState BEFORE the delayed 5s
      // result reveal fires. A pending reveal always wins: hold the
      // Flipping presentation (and the label) until the timer fires, and
      // never flash Pick a side with the previous MATCH # label. The timer
      // is guaranteed live while pending is set, so this hold is bounded.
      {
        const completedRound = lastCompletedRef.current;
        const decision = decideIdleRefresh({
          pendingRevealInFlight: pendingFlipRef.current !== null,
          resultAnchored:
            completedRound !== null &&
            activeMatchIdRef.current !== null &&
            completedRound.matchId === activeMatchIdRef.current,
          newRoundStarted: intentRef.current !== null,
        });
        if (decision.presentation === "hold-flipping") {
          traceTransition({
            reason: "idle-pending-reveal-hold",
            from: stateRef.current,
            proposed: "flipping",
            committed: "flipping",
            intentSide: intentRef.current?.side ?? null,
            intentId: intentRef.current?.intentId ?? null,
            startEpoch: epoch0,
            currentEpoch: selectionEpochRef.current,
            tier: selectedTierRef.current,
            responseTier: tier0,
            chainHasPosition: false,
          });
          setLiveState("flipping");
          setDetail("Flipping...");
          return;
        }
        // Chain shows no queue/match position and no reveal is pending, so
        // no round is active. Clear a stale MATCH # label when the previous
        // round is no longer the active UI round (result screens keep theirs
        // until Play Again). Clearing is one-way: only live inMatch chain
        // state re-sets the ID.
        if (decision.clearMatchId) setActiveMatchId(null);
      }
      setHasPosition(false);
      matchedAtRef.current = null;
      setQueuePos(null);
      // Leaving match scope clears any pending 5s reveal (fresh timer next match).
      if (!pendingFlipRef.current) {
        // Keep an in-flight pending reveal until its timer fires; otherwise reset.
        resetFlipReveal();
      }
      // Idle PlayerState with a pending explicit intent keeps the intent
      // visible (the post-game stale-refresh race: an older refresh must not
      // clear a newer selection).
      const idle = commitPassiveState(
        {
          proposedState: "ready",
          reason: "refresh-idle-state",
          responseEpoch: epoch0,
          responseTier: tier0,
          responseIntentId: intent0?.intentId ?? null,
          chainHasPosition: false,
        },
        {
          intent: intentRef.current,
          currentEpoch: selectionEpochRef.current,
          currentTier: selectedTierRef.current,
          hasChainPosition: false,
        },
      );
      traceTransition({
        reason: "refresh-idle-state",
        from: stateRef.current,
        proposed: "ready",
        committed: idle.state,
        intentSide: intentRef.current?.side ?? null,
        intentId: intentRef.current?.intentId ?? null,
        startEpoch: epoch0,
        currentEpoch: selectionEpochRef.current,
        tier: selectedTierRef.current,
        responseTier: tier0,
        chainHasPosition: false,
      });
      setLiveState(idle.state);
      setDetail(undefined);
    } catch (e) {
      const c = classifyError(e);
      if (c.code === "RPC_RATE_LIMIT") {
        setDetail("Solana network is temporarily busy. Retrying…");
        return;
      }
      // Transient RPC failure with a pending explicit selection: keep the
      // selection + Confirm visible instead of flipping to error/neutral.
      // Response context is unknown here (the throw can come from any await),
      // so staleness is decided on intent/chain truth alone.
      const failed = commitPassiveState(
        {
          proposedState: "error",
          reason: "refresh-error",
          responseEpoch: null,
          responseTier: null,
          responseIntentId: null,
          chainHasPosition: false,
        },
        {
          intent: intentRef.current,
          currentEpoch: selectionEpochRef.current,
          currentTier: selectedTierRef.current,
          hasChainPosition: hasPositionRef.current,
        },
      );
      traceTransition({
        reason: "refresh-error",
        from: stateRef.current,
        proposed: "error",
        committed: failed.state,
        intentSide: intentRef.current?.side ?? null,
        intentId: intentRef.current?.intentId ?? null,
        startEpoch: null,
        currentEpoch: selectionEpochRef.current,
        tier: selectedTierRef.current,
        responseTier: null,
        chainHasPosition: hasPositionRef.current,
      });
      if (failed.state !== "error") {
        setLiveState(failed.state);
        setDetail("Connection hiccup — your selection is kept. Retrying…");
        return;
      }
      setLiveState("error");
      setDetail(c.message.slice(0, 220));
    }
  }, [
    account,
    bumpEpoch,
    connection,
    priceAdapter,
    program,
    refreshBalances,
    refreshQueueSnapshot,
    updateRoomLiveness,
    reconcileIdleResult,
    sessionWallet,
    sdk,
    usdCents,
    ensureAutoSettlement,
    loadHistory,
    reloadProfile,
    resetFlipReveal,
    scheduleFlipReveal,
  ]);

  // Visibility pause: background tabs burn no RPC quota.
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    setVisible(typeof document === "undefined" ? true : !document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    return () => {
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    };
  }, []);

  // VISIBLE-START ANCHOR (post-render): stamp the 5000ms reveal timer when
  // the Flipping presentation for the current live Match actually commits
  // (see useVisibleFlipAnchor — extracted for deterministic testing).
  useVisibleFlipAnchor({
    liveState,
    activeMatchIdRef,
    pendingFlipRef,
    visibleFlipStartedAtRef,
    scheduleFlipReveal,
  });

  // Results remain visible until the player explicitly chooses Play Again.

  // State-aware polling + account subscriptions (fallback to bounded polling).
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const cur = stateRef.current;
    const interval = !addressRef.current
      ? REFRESH_DISCONNECTED_MS
      : isActiveState(cur)
        ? REFRESH_ACTIVE_MS
        : isFinalState(cur)
          ? REFRESH_FINAL_MS
          : REFRESH_IDLE_MS;
    const t = setInterval(() => void refresh(), interval);
    return () => clearInterval(t);
  }, [refresh, visible, liveState, address]);

  // Subscription-first for config: replaces most config polls when WS works.
  useEffect(() => {
    if (!visible) return;
    let subId: number | null = null;
    let cancelled = false;
    const sub = async () => {
      try {
        subId = await connection.onAccountChange(
          sdk.config,
          () => {
            if (!cancelled) {
              snapshotCacheRef.current = {
                at: 0,
                tier: selectedTierRef.current,
                data: null,
              };
              void refresh();
            }
          },
          "confirmed",
        );
      } catch {
        subId = null;
      }
    };
    void sub();
    return () => {
      cancelled = true;
      if (subId !== null) {
        void connection
          .removeAccountChangeListener(subId)
          .catch(() => undefined);
      }
    };
  }, [connection, sdk, visible, refresh]);

  // Room-scoped history (never another tier's rows, never fake).
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const h = await fetchRecentFlips(10, selectedTier);
      if (!stop) setHistory(h);
    };
    void load();
    const t = setInterval(() => void load(), HISTORY_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [selectedTier]);

  // Recover a pending signature across refresh (confirmation-unknown path).
  useEffect(() => {
    const pending = getPendingSignature();
    if (!pending || !address) return;
    const run = async () => {
      try {
        const me = new PublicKey(address);
        const [playerStatePk] = playerPda(program.programId, me);
        const outcome = await probeJoinRecovery(
          connection,
          pending.signature,
          async () => {
            const st = await fetchPlayerStateCompat(
              connection,
              playerStatePk,
            ).catch(() => null);
            if (!st) return { exists: false, queued: false, inMatch: false };
            return {
              exists: true,
              queued: Boolean(st.queued),
              inMatch: Boolean(st.inMatch),
            };
          },
        );
        if (outcome === "queued" || outcome === "matched") {
          clearPendingSignature();
          await refresh();
        } else if (outcome === "absent" || outcome === "failed") {
          clearPendingSignature();
          await refresh();
        }
      } catch {
        // Keep pending for the next cycle; bounded by storage expiry.
      }
    };
    void run();
  }, [address, connection, program, refresh]);

  const handleLogout = useCallback(async () => {
    traceGameEvent("disconnect");
    // Explicit disconnect intentionally resets selection state.
    bumpEpoch();
    intentRef.current = null;
    resetFlipReveal();
    setSelectedSide(null);
    setRevealedRound(null);
    setLastCompleted(null);
    dismissedResultRef.current=null;
    setMatchResult(null);
    setDetail(undefined);
    setProfileOpen(false);
    try {
      await logoutSession();
    } catch {
      // ignore
    }
    await disconnect();
  }, [disconnect, bumpEpoch, resetFlipReveal]);

  const handlePick = useCallback(
    (s: Side) => {
      if (hasPosition) return;
      traceGameEvent(`user-pick:${s}`);
      bumpEpoch();
      intentRef.current = createIntent(
        s,
        selectedTierRef.current,
        selectionEpochRef.current,
      );
      setSelectedSide(s);
      setLiveState(s === "HEADS" ? "heads-selected" : "tails-selected");
    },
    [hasPosition, bumpEpoch],
  );

  const handleSelectTier = useCallback(
    (tier: number) => {
      if (tier === selectedTierRef.current) return;
      // Room switch intentionally resets selection (the one allowed reset).
      traceGameEvent(`room-switch:${tier}`);
      bumpEpoch();
      intentRef.current = null;
      shouldClearIntentOn("room-switch");
      resetFlipReveal();
      selectedTierRef.current = tier;
      setSelectedTier(tier);
      setSelectedSide(null);
      setMatchResult(null);
      setDetail(undefined);
      setSettlePending(false);
      setSettleLine(null);
      setQueuePos(null);
      setQueue(null);
      setLastCompleted(null);
      setRevealedRound(null);
      lockedStakeRef.current = null;
      matchedAtRef.current = null;
      setActiveMatchId(null);
      snapshotCacheRef.current = { at: 0, tier, data: null };
      void refresh();
      void loadHistory(tier);
    },
    [bumpEpoch, refresh, loadHistory, resetFlipReveal],
  );

  const runSponsored = useCallback(
    async (kind: ReimbursableAction, sig: string) => {
      if (!address || !DEVNET_SPONSOR_UI_ENABLED) return;
      try {
        await requestReimbursement(address, sig, kind);
        // Silent on success: no sponsor banner in normal gameplay UX.
        // Reimbursement is best-effort; gameplay already succeeded.
      } catch {
        // Reimbursement is best-effort; gameplay already succeeded.
      }
    },
    [address],
  );

  const handleConfirm = useCallback(async () => {
    const sel = selRef.current;
    const intent = intentRef.current;
    if (!address || !anchorWallet || !sel || busyRef.current) return;
    if (sessionWallet !== address) {
      setDetail("Verify your connected wallet before playing.");
      return;
    }

    // Confirm honors the intent lock: stale room/intent cannot join.
    if (intent && intent.tierUsd !== selectedTierRef.current) return;
    busyRef.current = true;
    bumpEpoch();
    setBusyKind("join");
    let joinStage = "FEE_PREPARATION";
    try {
      if (DEVNET_SPONSOR_UI_ENABLED) {
        setDetail("Preparing network fee…");
        const prep = await ensureSponsoredBalance(address);
        if (!prep.ok) {
          setDetail(networkFeePreparationMessage(prep.reason));
          return;
        }
      }
      joinStage = "QUOTE";
      const quote = await priceAdapter.getQuote(PROJECT_TOKEN_MINT);
      const stake = stakeForUsd(quote, usdCents);
      joinStage = "BALANCE";
      const me = new PublicKey(address);
      const mint = new PublicKey(PROJECT_TOKEN_MINT);
      const ata = await getAssociatedTokenAddress(mint, me);
      const solBal = await connection.getBalance(me).catch(() => null);
      if (solBal !== null && solBal < 2_000_000 && !DEVNET_SPONSOR_UI_ENABLED) {
        setLiveState("insufficient-balance");
        setDetail(
          "Insufficient SOL for transaction fees. Top up a little Devnet SOL — your project-token balance is unaffected.",
        );
        return;
      }
      const bal = await connection
        .getTokenAccountBalance(ata)
        .catch(() => null);
      if (!bal || BigInt(bal.value.amount) < stake) {
        const roomLabel = roomForTier(selectedTierRef.current)?.label ?? "$1";
        setLiveState("insufficient-balance");
        setDetail(
          `Insufficient project tokens: you need ${stake.toLocaleString("en-US")} base units for a ${roomLabel} flip.`,
        );
        return;
      }
      joinStage = "CONFIG";
      const cfg = await sdk.fetchConfig();
      if (cfg.paused) {
        setLiveState("paused");
        return;
      }
      const side = sel === "HEADS" ? 0 : 1;
      const tier = selectedTierRef.current;
      setLiveState("joining");
      setDetail("Submitting stake transaction…");
      // Every room joins through its tier-scoped V2 queue. Fail closed
      // unless the on-chain room was confirmed live.
      const roomLabel =
        roomForTier(tier)?.label ?? `${tier.toLocaleString("en-US")}`;
      if (!roomLiveRef.current[tier]) {
        setDetail(
          tier === 10
            ? `${ROOM_ACTIVATION_COPY} — 10 HTS opens automatically once its on-chain room is live.`
            : `${roomLabel} room is not live on-chain yet.`,
        );
        setLiveState(sel === "HEADS" ? "heads-selected" : "tails-selected");
        return;
      }
      let roomState;
      try {
        roomState = await sdk.fetchRoom(tier);
      } catch {
        setDetail(
          `${roomLabel} room is not readable on-chain right now. Try again in a moment.`,
        );
        setLiveState(sel === "HEADS" ? "heads-selected" : "tails-selected");
        return;
      }
      if (!roomState.active) {
        setDetail("This room is Opening Soon.");
        return;
      }
      const seq = side === 0 ? roomState.headsNext : roomState.tailsNext;
      joinStage = "BUILD";
      const { tx } = await sdk.joinQueueRoomTx(
        me,
        ata,
        mint,
        side,
        tier,
        stake,
        seq,
      );
      let joinSig = "";
      try {
        joinStage = "SIGN_AND_SEND";
        joinSig = await signAndSend(connection, anchorWallet, tx, {
          action: "join",
        });
      } catch (e) {
        const recSig = recoverySigFromError(e);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("TRANSACTION_CONFIRMATION_UNKNOWN") && recSig) {
          setDetail("Transaction submitted. Checking its on-chain status…");
          const outcome = await probeJoinRecovery(
            connection,
            recSig,
            async () => {
              const [ps] = playerPda(program.programId, me);
              const st = await fetchPlayerStateCompat(connection, ps).catch(
                () => null,
              );
              if (!st) return { exists: false, queued: false, inMatch: false };
              return {
                exists: true,
                queued: Boolean(st.queued),
                inMatch: Boolean(st.inMatch),
              };
            },
          );
          if (outcome === "queued" || outcome === "matched") {
            clearPendingSignature();
            await runSponsored("join", recSig);
            await refresh();
            return;
          }
          if (outcome === "absent") {
            clearPendingSignature();
            setDetail("Transaction did not land. Safe to retry.");
            setLiveState(sel === "HEADS" ? "heads-selected" : "tails-selected");
            return;
          }
          setDetail("Transaction submitted. Checking its on-chain status…");
          return;
        }
        throw e;
      }
      lockedStakeRef.current = stake;
      // Join succeeds: clear the intent (terminal success).
      traceGameEvent("join-success");
      intentRef.current = null;
      shouldClearIntentOn("join-success");
      await runSponsored("join", joinSig);
      lastMatchRequestAt.current = Date.now();
      try {
        await fetch("/api/devnet/match-crank-room", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tierUsd: tier }),
        }).catch(() => null);
      } catch {
        // Still queued; the opposite side or keeper will match next.
      }
      await refresh();
    } catch (e) {
      // Terminal errors clear the intent so the user can cleanly re-pick.
      traceGameEvent("join-terminal-error");
      intentRef.current = null;
      shouldClearIntentOn("join-terminal-error");
      showError(e);
      const failure = classifyError(e);
      setDetail(`${failure.message} Support code: JOIN_${joinStage}/${failure.code}.`);
    } finally {
      busyRef.current = false;
      setBusyKind(null);
    }
  }, [
    address,
    anchorWallet,
    bumpEpoch,
    connection,
    priceAdapter,
    program,
    refresh,
    sdk,
    showError,
    runSponsored,
    usdCents,
    sessionWallet,
  ]);

  const handleLeave = useCallback(async () => {
    if (!address || !anchorWallet || busyRef.current) return;
    busyRef.current = true;
    traceGameEvent("leave");
    bumpEpoch();
    setBusyKind("leave");
    try {
      if (DEVNET_SPONSOR_UI_ENABLED) {
        await ensureSponsoredBalance(address).catch(() => null);
      }
      const me = new PublicKey(address);
      const mint = new PublicKey(PROJECT_TOKEN_MINT);
      const ata = await getAssociatedTokenAddress(mint, me);
      const [ps] = playerPda(program.programId, me);
      const st = await fetchPlayerStateCompat(connection, ps);
      if (!st || !st.queued) throw new Error("No active queue entry to cancel");
      const side = st.queuedSide;
      const seq = st.queuedSequence;
      // Active gameplay is HTS-only. Historical refunds are handled by the
      // separate owner-clicked LegacyPositionNotice and never share this mint.
      if (st.schema !== "v2" || ![1, 10].includes(st.queuedTierUsd)) {
        throw new Error("Invalid HTS room position");
      }
      const { tx } = await sdk.cancelQueueEntryRoomTx(me, ata, mint);
      const sig = await signAndSend(connection, anchorWallet, tx, {
        action: "cancel",
      });
      await runSponsored("cancel", sig);
      intentRef.current = null;
      shouldClearIntentOn("user-cancel");
      setSelectedSide(null);
      lockedStakeRef.current = null;
      matchedAtRef.current = null;
      setActiveMatchId(null);
      setQueuePos(null);
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      busyRef.current = false;
      setBusyKind(null);
    }
  }, [
    address,
    anchorWallet,
    bumpEpoch,
    connection,
    refresh,
    sdk,
    showError,
    runSponsored,
    program,
  ]);

  const handleRetryPayout = useCallback(async () => {
    // Server-only retry: ensures the settlement job exists. No wallet tx.
    if (!activeMatchId || retryPayoutBusy) return;
    setRetryPayoutBusy(true);
    try {
      ensureSentRef.current.delete(activeMatchId);
      await ensureAutoSettlement(activeMatchId);
      await refresh();
    } finally {
      setRetryPayoutBusy(false);
    }
  }, [activeMatchId, retryPayoutBusy, ensureAutoSettlement, refresh]);

  const handleRetry = useCallback(() => {
    bumpEpoch();
    intentRef.current = null;
    shouldClearIntentOn("user-cancel");
    resetFlipReveal();
    setSelectedSide(null);
    setMatchResult(null);
    setSettlePending(false);
    setSettleLine(null);
    setDetail(undefined);
    lockedStakeRef.current = null;
    matchedAtRef.current = null;
    setActiveMatchId(null);
    setQueuePos(null);
    void refresh();
  }, [bumpEpoch, refresh, resetFlipReveal]);

  const handlePlayAgain = useCallback(() => {
    if(settlePendingRef.current || !lastCompletedRef.current)return;
    traceGameEvent("play-again");
    // Play Again resets the 5s timer; next match gets a fresh timer.
    resetRoundState();
    void refresh();
  }, [resetRoundState, refresh]);

  const handleBackToSides=useCallback(()=>{
    if(!canReturnToSidePicker(stateRef.current,busyRef.current,hasPositionRef.current,settlePendingRef.current,getPendingSignature()!==null))return;
    resetRoundState();
    void refresh();
  },[resetRoundState,refresh]);

  const baseVisual: GameStateId =
    override ?? (busyKind === "join" ? "joining" : liveState);
  // Preserve a completed result until explicit Play Again; polling never dismisses it.
  const visualState: GameStateId = override ?? anchoredResultState({state:baseVisual,result:revealedRound,
    wallet:address,activeMatchId,hasNewIntent:intentRef.current!==null});
  const displayResult =
    matchResult ??
    (visualState === "win" || visualState === "loss"
      ? (revealedRound?.result ?? lastCompleted?.result ?? null)
      : null);
  // Coin flip target (presentation-only): the authoritative pending result
  // face while Flipping, plus its absolute reveal timestamp, so the coin
  // decelerates onto the correct face exactly at reveal time. Fresh on
  // every hold commit via the flip-tick bump in holdAndReveal.
  const pendingFlipNow = pendingFlipRef.current;
  const flipTarget: Side | null =
    liveState === "flipping" &&
    pendingFlipNow !== null &&
    pendingFlipNow.matchId === activeMatchId
      ? pendingFlipNow.resultSide
      : null;
  const flipRevealAtMs: number | null =
    flipTarget !== null &&
    visibleFlipStartedAtRef.current !== null &&
    visibleFlipStartedAtRef.current.matchId === activeMatchId &&
    pendingFlipNow !== null
      ? Math.max(
          visibleFlipStartedAtRef.current.startedAt + MIN_FLIP_REVEAL_MS,
          pendingFlipNow.arrivedAt,
        )
      : null;
  const headerState: GameStateId = address ? visualState : "disconnected";
  const flips: RecentFlip[] | undefined =
    history.status === "ok" ? history.flips : undefined;
  const historyUnavailable = history.status === "unavailable";
  const isDev = process.env.NODE_ENV !== "production";
  const queuedSide: Side | null =
    visualState === "queued-heads"
      ? "HEADS"
      : visualState === "queued-tails"
        ? "TAILS"
        : null;
  const queuePositionLine = queuedSide
    ? queuePositionText(queuedSide, queuePos ?? undefined)
    : undefined;
  const matchLabel =
    activeMatchId !== null ? `MATCH #${activeMatchId}` : undefined;
  const showPlayAgain = playAgainReady({
    isWinOrLoss: visualState === "win" || visualState === "loss",
    claimPending: settlePending,
    settledObserved: lastCompleted !== null && !settlePending,
  });
  const roomLocked = isFinalState(visualState) || !canChangeMobileRoom(liveState,busyKind!==null,hasPosition,settlePending);
  const mobileFeedback=mobileGameFeedback(visualState,settlePending);
  const mobileProgress = mobilePlayShowsProgress(visualState);
  const canGoBack=canReturnToSidePicker(visualState,busyKind!==null,hasPosition,settlePending,getPendingSignature()!==null);
  const mobileFooterClick = (event:MouseEvent<HTMLElement>) => {
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const href=(event.target as Element).closest("a")?.getAttribute("href");
    const match=href?.match(/^\/(tokenomics|roadmap|terms|privacy|how-to)$/);
    if(match){event.preventDefault();mobileNav.navigate("profile",match[1] as InformationPage);}
  };
  const mobileFooter = <div className="mobile-profile-footer" onClickCapture={mobileFooterClick}><AppFooter/></div>;

  // Desktop side rails share one width token so Leaderboard and Chat stay
  // symmetrical around the center game (--desktop-side-panel-width).
  const gridCols =
    site.leaderboardEnabled && site.chatEnabled
      ? "xl:grid-cols-[var(--desktop-side-panel-width)_minmax(0,1fr)_var(--desktop-side-panel-width)]"
      : site.leaderboardEnabled
        ? "xl:grid-cols-[var(--desktop-side-panel-width)_minmax(0,1fr)]"
        : site.chatEnabled
          ? "xl:grid-cols-[minmax(0,1fr)_var(--desktop-side-panel-width)]"
          : "";

  return (
    <div ref={mobileNav.rootRef} data-mobile-tab={mobileNav.tab} data-mobile-info={mobileNav.info ?? undefined}
      data-mobile-social={socialView} data-game-state={visualState} data-mobile-progress={String(mobileProgress)} data-mobile-queued={String(queuedSide!==null)}
      className="heads-app relative flex min-h-[100svh] w-full max-w-full flex-col overflow-x-clip">
      <AppHeader
        state={headerState}
        onConnect={() => setWalletOpen(true)}
        onDisconnect={() => void handleLogout()}
        addressLabel={address ? shortAddr(address) : undefined}
        live={Boolean(address)}
        balanceLabel={address ? tokenBalanceLabel : undefined}
        profileName={profile?.username ?? null}
        profileAvatarUrl={profile?.avatarUrl ?? null}
        notificationCount={settlePending ? 1 : 0}
        onProfileClick={() => mobileNav.mobile ? mobileNav.navigate("profile") : setProfileOpen(true)}
        faucet={undefined}
      />
      {!mobileNav.mobile&&mobileNav.info==="how-to"&&<HowToOverlay onClose={()=>mobileNav.navigate(mobileNav.tab,null)}/>}
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      {(profileOpen || mobileNav.mobile) && address && (
        <ProfileModal
          wallet={wallet}
          account={account}
          address={address}
          profile={profile}
          pendingPayout={
            settlePending && activeMatchId ? { matchId: activeMatchId } : null
          }
          onRetryPayout={() => void handleRetryPayout()}
          retryPayoutBusy={retryPayoutBusy}
          onClose={() => mobileNav.mobile ? mobileNav.navigate("play") : setProfileOpen(false)}
          onChanged={() => {
            reloadProfile();
            reloadSession();
          }}
          onLogout={() => void handleLogout()}
          presentation={mobileNav.mobile ? "page" : "modal"}
          footer={mobileFooter}
          balanceLabel={tokenBalanceLabel ?? undefined}
          hidden={mobileNav.mobile && (mobileNav.tab!=="profile" || mobileNav.info!==null)}
        />
      )}
      {inspectedWallet && (
        <PublicProfileModal
          wallet={inspectedWallet}
          onClose={() => setInspectedWallet(null)}
        />
      )}
      {chatOpen && !mobileNav.mobile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Global chat"
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 xl:hidden"
        >
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setChatOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="relative flex max-h-[85svh] w-full max-w-sm min-w-0 flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl">
            <ChatPanel
              authed={sessionWallet !== null}
              hasWallet={address !== null}
              onEnsureAuth={ensureChatAuth}
              onNeedWallet={() => setWalletOpen(true)}
              onSelectUser={(w) => {
                setChatOpen(false);
                setInspectedWallet(w);
              }}
            />
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="glass inline-flex min-h-[44px] w-full items-center justify-center border-white/15 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {boardOpen && !mobileNav.mobile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Leaderboard"
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
        >
          <button
            type="button"
            aria-label="Close leaderboard"
            onClick={() => setBoardOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="glass relative max-h-[85svh] w-full max-w-sm min-w-0 overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl">
            <LeaderboardPanel
              onSelectUser={(w) => {
                setBoardOpen(false);
                setInspectedWallet(w);
              }}
            />
            <button
              type="button"
              onClick={() => setBoardOpen(false)}
              className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-white/15 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      )}
      <main
        hidden={mobileNav.mobile && (mobileNav.tab==="profile" || mobileNav.info!==null)}
        className={`app-main relative z-10 mx-auto grid w-full max-w-[1440px] min-w-0 flex-1 gap-6 overflow-x-clip px-4 pb-10 pt-6 sm:px-6 ${gridCols}`}
      >
        <MobileSocialSwitch value={socialView} onChange={setSocialView} enabled={mobileNav.mobile && mobileNav.tab==="social"}/>
        {site.leaderboardEnabled && (
          <aside
            id="mobile-social-leaderboard" data-mobile-panel="social" data-social-view="leaderboard"
            hidden={mobileNav.mobile && (mobileNav.tab!=="social" || socialView!=="leaderboard")}
            className="mobile-social-panel hidden w-full min-w-0 self-stretch xl:block xl:w-[var(--desktop-side-panel-width)] xl:shrink-0"
            aria-label="Leaderboard sidebar"
          >
            <div className="sticky top-6 flex h-full min-h-[560px] flex-col xl:min-h-[680px]">
              <LeaderboardPanel onSelectUser={setInspectedWallet} />
            </div>
          </aside>
        )}
        <div id="mobile-play" hidden={mobileNav.mobile && mobileNav.tab!=="play"} data-mobile-panel="play" className="mobile-play-panel mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col items-center gap-6">
          <LegacyPositionNotice
            program={program}
            address={address}
            onChanged={() => {
              void refresh();
            }}
            onSubmit={async (tx) => {
              if (!anchorWallet) throw new Error("Wallet unavailable");
              return signAndSend(connection, anchorWallet, tx, {
                action: "cancel",
              });
            }}
          />
          {RPC_MISSING && (
            <p
              role="alert"
              className="w-full max-w-[560px] rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-center text-[13px] font-semibold text-red-200"
            >
              Network configuration missing: set a dedicated Devnet RPC
              (NEXT_PUBLIC_RPC_URL). Public api.devnet.solana.com is not the QA
              RPC.
            </p>
          )}
          {RPC_IS_PUBLIC_FALLBACK && !RPC_MISSING && (
            <p
              role="status"
              className="w-full max-w-[560px] rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-2 text-center text-[12px] font-medium text-amber-200"
            >
              Local diagnostic RPC (public Devnet). QA deploys must use a
              dedicated provider.
            </p>
          )}
          {/* Product cleanup: no visible Devnet sponsor banner in normal
            gameplay UX. Sponsorship (APIs, caps, ledger, gates,
            reimbursement) continues internally; transient action detail
            uses neutral copy ("Preparing network fee…"). */}
          <GameHero
            state={visualState}
            selectedSide={selectedSide}
            result={displayResult}
            onPick={handlePick}
            subtitle={site.heroSubtitle}
            images={{
              heads: site.coinHeadsUrl,
              tails: site.coinTailsUrl,
              def: site.coinDefaultUrl,
            }}
            roomLabel={`${roomForTier(selectedTier)?.label ?? "$1"} FLIP`}
            flipTarget={flipTarget}
            flipRoundId={activeMatchId}
            flipRevealAtMs={flipRevealAtMs}
            allowDisconnectedPick={mobileNav.mobile}
            roomSelector={<MobileRoomSelector tier={selectedTier} locked={roomLocked} liveTiers={liveTiers} onSelect={tier=>{
              if(!revealedRoundRef.current && canChangeMobileRoom(stateRef.current,busyRef.current,hasPositionRef.current,settlePendingRef.current))handleSelectTier(tier);
            }}/>}
          />
          {site.announcementText && (
            <p
              role="status"
              className="w-full max-w-[560px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center text-[13px] font-medium text-white"
            >
              {site.announcementText}
            </p>
          )}
          <div className="legacy-social-buttons flex w-full max-w-[560px] gap-2 xl:hidden">
            {site.leaderboardEnabled && (
              <button
                type="button"
                onClick={() => setBoardOpen(true)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-2xl border border-white/15 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Leaderboard
              </button>
            )}
            {site.chatEnabled && (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-2xl border border-white/15 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Global Chat
              </button>
            )}
          </div>
          <div className="mobile-game-progress">
          {mobileNav.mobile && canGoBack && <button type="button" onClick={handleBackToSides} aria-label="Back to sides" title="Back"
            className="inline-flex h-11 w-11 items-center justify-center self-start rounded-xl border border-white/15 text-white transition hover:bg-white/10">
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 5-7 7 7 7M5 12h14"/></svg>
          </button>}
          <TransactionStatus
            state={visualState}
            needsVerification={Boolean(address && sessionWallet !== address)}
          />
          <GameStatePanel
            state={visualState}
            selectedSide={selectedSide}
            result={displayResult}
            walletAddress={address}
            completedMatchId={revealedRound?.matchId ?? lastCompleted?.matchId ?? null}
            needsConnection={mobileNav.mobile && !address}
            needsVerification={Boolean(address && sessionWallet !== address)}
            onVerify={() => {
              void ensureChatAuth();
            }}
            onConnect={() => setWalletOpen(true)}
            onConfirm={() => void handleConfirm()}
            onLeave={() => void handleLeave()}
            onRetry={handleRetry}
            detail={detail}
            live
            matchLabel={matchLabel}
            queuePositionText={queuePositionLine}
            playAgainReady={showPlayAgain}
            onPlayAgain={handlePlayAgain}
            settleLine={settleLine}
            onRetryPayout={
              settlePending ? () => void handleRetryPayout() : undefined
            }
            retryPayoutBusy={retryPayoutBusy}
          />
          </div>
          <div className="desktop-room-cards">
          <StakeTierSelector
            selectedTier={selectedTier}
            onSelect={handleSelectTier}
            liveTiers={liveTiers}
            connected={address !== null}
          />
          </div>
          <div className="desktop-recent-flips">
          <RecentFlips
            flips={flips}
            live
            unavailable={historyUnavailable}
            tierUsd={selectedTier}
          />
          </div>
          <div className="mobile-game-queue">
          <QueueStatusBar
            headsWaiting={queue?.heads ?? null}
            tailsWaiting={queue?.tails ?? null}
          />
          </div>
        </div>
        {site.chatEnabled && (
          <aside
            id="mobile-social-chat" data-mobile-panel="social" data-social-view="chat"
            hidden={mobileNav.mobile && (mobileNav.tab!=="social" || socialView!=="chat")}
            className="mobile-social-panel hidden w-full min-w-0 self-stretch xl:block xl:w-[var(--desktop-side-panel-width)] xl:shrink-0"
            aria-label="Global chat sidebar"
          >
            <div className="sticky top-6 flex h-full min-h-[560px] flex-col xl:min-h-[680px]">
              <ChatPanel
                authed={sessionWallet !== null}
                hasWallet={address !== null}
                onEnsureAuth={ensureChatAuth}
                onNeedWallet={() => setWalletOpen(true)}
                onSelectUser={setInspectedWallet}
              />
            </div>
          </aside>
        )}
        <MobileFlips enabled={mobileNav.mobile} active={mobileNav.mobile && mobileNav.tab==="flips" && !mobileNav.info}/>
      </main>
      {!address && <section hidden={!mobileNav.mobile || mobileNav.tab!=="profile" || mobileNav.info!==null} id="mobile-profile" className="mobile-profile-guest" aria-label="Profile">
        <div className="glass mx-auto w-full max-w-[560px] rounded-3xl p-5 text-center">
          <h2 className="font-display text-[19px] font-bold text-white">Profile</h2>
          <p className="my-3 text-sm text-[var(--text-secondary)]">Connect a Solana wallet to view your profile.</p>
          <WalletButton state="disconnected" onConnect={()=>setWalletOpen(true)} onDisconnect={()=>undefined}/>
        </div>{mobileFooter}
      </section>}
      {mobileNav.mobile && mobileNav.info && <MobileInformation page={mobileNav.info} onBack={()=>mobileNav.navigate("profile")} onNavigate={page=>mobileNav.navigate("profile",page)}/>}
      {mobileNav.tab!=="play"&&mobileFeedback&&<button type="button" className="mobile-game-notification glass min-h-[44px] rounded-2xl border border-white/15 px-4 text-sm font-bold text-white" onClick={()=>mobileNav.navigate("play")}>
        {mobileFeedback} · View game
      </button>}
      {address && sessionWallet === address && (
        <TeamWelcome key={address} wallet={address} onSaved={reloadProfile} />
      )}
      <div className="desktop-site-footer" onClickCapture={event=>{if((event.target as Element).closest("a")?.getAttribute("href")==="/how-to")mobileFooterClick(event);}}><AppFooter /></div>
      <MobileNavigation enabled={mobileNav.mobile} tab={mobileNav.tab} onSelect={tab=>mobileNav.navigate(tab)}/>
      <DevStateSwitcher
        enabled={isDev}
        state={override ?? liveState}
        onChange={(s) => {
          setOverride(s);
          if (s === "heads-selected") setSelectedSide("HEADS");
          if (s === "tails-selected") setSelectedSide("TAILS");
          if (s === "ready" || s === "disconnected") {
            setSelectedSide(null);
            setOverride(null);
            void refresh();
          }
        }}
      />
      {override && (
        <button
          type="button"
          onClick={() => {
            setOverride(null);
            void refresh();
          }}
          className="fixed bottom-3 right-3 z-50 min-h-[44px] rounded-2xl border border-amber-300/40 bg-black/90 px-4 text-[12px] font-bold text-amber-300"
        >
          Exit dev preview
        </button>
      )}
    </div>
  );
}
