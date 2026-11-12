import { configPda, matchPda, playerPda, roomQueuePda } from "@/lib/solana/activeGame";
import { reconcileServiceReceipts, sendJournaledTransaction } from "@/lib/solana/expenseJournal";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import {
  GameClient,
  createMatchNonce,
  fetchPlayerStateCompat,
  gameIdlJson,
  type HeadsOrTails,
} from "@heads-or-tails/game-sdk";
import {
  decideHeadAction,
  isLegitimateQueuedPlayer,
  normalizeHeadStatus,
  withTransientRetry,
  MAX_ADVANCE_PER_SIDE,
  MAX_MATCHES_PER_RUN,
} from "./roomMaintain";
import {
  isBenignRaceError,
  isTransientCrankError,
  releaseCrankLock,
  tryAcquireCrankLock,
} from "@/lib/solana/matchCrank";
import { maintenanceDeferral, type MaintenanceDeferral } from "./maintenanceOutcome";
import { EXPECTED_SPONSOR_PUBKEY } from "@/lib/solana/sponsorGate";
import { getServerConnection, getSupabaseAdmin, loadSponsorKeypair, sponsorGateCheck } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";

const VRF_TREASURY = new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR");

async function sendSponsorTx(connection: Connection, sponsorKp: Keypair,
  tx: Transaction | VersionedTransaction, operationKey: string, kind: "advance" | "match"): Promise<string> {
  const result = await sendJournaledTransaction({ connection, signer: sponsorKp, transaction: tx,
    operationKey, kind, wallet: sponsorKp.publicKey.toBase58() });
  if (!result.signature) throw new Error("Operation receipt unavailable");
  return result.signature;
}

export interface MaintainResult {
  tierUsd: number;
  advanced: Array<{ side: string; sequence: string; signature: string }>;
  matched: Array<{ matchId: string; signature: string }>;
  pending: boolean;
  deferred?: MaintenanceDeferral;
  invariants: string[];
  notes: string[];
}

function log(tier: number, msg: string, extra?: Record<string, unknown>): void {
  try {
    console.log(`[maintain-room tier=${tier}] ${msg}`, extra ?? "");
  } catch {
    // ignore
  }
}

/**
 * Authoritative self-healing reconciler for ONE tier room.
 * Idempotent, race-tolerant, bounded, browser-independent.
 */
export async function maintainRoom(tierUsd: number): Promise<MaintainResult> {
  const out: MaintainResult = { tierUsd, advanced: [], matched: [], pending: false, invariants: [], notes: [] };
  if (tierUsd !== 1 && tierUsd !== 10) throw new Error("unsupported room");

  if (!sponsorGateCheck().ok) { out.notes.push("new sponsorship disabled"); return out; }
  const sponsor = loadSponsorKeypair();
  if (!sponsor || sponsor.publicKey.toBase58() !== EXPECTED_SPONSOR_PUBKEY) {
    throw new Error("matcher unavailable");
  }
  const { connection, reason } = getServerConnection();
  if (!connection) throw new Error(reason ?? "matcher unavailable");

  const lockKey = `maintain-room:${tierUsd}`;
  if (!tryAcquireCrankLock(lockKey)) {
    out.notes.push("in-progress");
    return out;
  }
  try {
    const provider = new AnchorProvider(connection, { publicKey: sponsor.publicKey } as Wallet, {
      commitment: "confirmed",
    });
    const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
    const [configPk] = configPda(program.programId);
    const sdk = new GameClient(program, configPk, "hts");
    const sponsorKp = Keypair.fromSecretKey(sponsor.secretKey);

    const cfg = await withTransientRetry(() => sdk.fetchConfig(), { attempts: 4, baseMs: 500 });
    if (cfg.paused) {
      out.notes.push("paused");
      return out;
    }
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Operation journal unavailable");
    await reconcileServiceReceipts(connection, db, sponsor.publicKey.toBase58());
    let room;
    try {
      room = await withTransientRetry(() => sdk.fetchRoom(tierUsd), { attempts: 4, baseMs: 500 });
    } catch {
      out.notes.push("room uninitialized");
      return out;
    }
    if (!room.active) {
      out.notes.push("room not active");
      return out;
    }

    // 1. Advance inactive holes on both sides (bounded). Valid Active
    // offline players are NEVER skipped.
    for (const side of [0, 1] as const) {
      const sideName = side === 0 ? "heads" : "tails";
      for (let n = 0; n < MAX_ADVANCE_PER_SIDE; n++) {
        const fresh = await withTransientRetry(() => sdk.fetchRoom(tierUsd), { attempts: 3, baseMs: 400 });
        const head = side === 0 ? fresh.headsHead : fresh.tailsHead;
        const next = side === 0 ? fresh.headsNext : fresh.tailsNext;
        if (head >= next) break;
        const [headPda] = roomQueuePda(program.programId, tierUsd, side, head);
        let entry: Record<string, unknown> | null = null;
        let fetchFailed = false;
        try {
          entry = await withTransientRetry(
            () =>
              (
                program.account as unknown as Record<string, { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> }>
              ).roomQueueEntry.fetch(headPda),
            {
              attempts: 3,
              baseMs: 400,
              isTransient: (e) => isTransientCrankError(e instanceof Error ? e.message : String(e)),
            }
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isTransientCrankError(msg)) {
            fetchFailed = true;
          } else {
            // Unreadable but non-transient (e.g. legacy-decode failure):
            // retry once more via compat path, else treat as transient —
            // DO NOT mutate.
            fetchFailed = true;
            log(tierUsd, `head fetch non-transient (${sideName} seq=${head})`, { msg: msg.slice(0, 120) });
          }
        }
        if (fetchFailed || !entry) {
          if (!entry && !fetchFailed) {
            out.invariants.push(`${sideName} head seq=${head} missing while head < next`);
            log(tierUsd, `invariant: missing head entry`, { side: sideName, seq: head.toString() });
          } else {
            out.notes.push(`${sideName} head unreadable; retry later, no mutation`);
          }
          break; // DO NOT advance past an unreadable head.
        }
        const statusRaw = String(Object.keys((entry.status ?? {}) as object)[0] ?? "");
        const action = decideHeadAction(normalizeHeadStatus(statusRaw));
        if (action.kind === "advance") {
          try {
            const [roomPdaAddr] = PublicKey.findProgramAddressSync(
              [Buffer.from("hts-room"), Buffer.from([tierUsd])],
              program.programId
            );
            const tx = await (
              program.methods as unknown as Record<string, (...a: unknown[]) => { accounts: (o: unknown) => { transaction: () => Promise<Transaction> } }>
            )
              .advanceHtsHeadRoom(side, tierUsd)
              .accounts({ room: roomPdaAddr, headEntry: headPda })
              .transaction();
            const sig = await sendSponsorTx(connection, sponsorKp, tx, `advance-hts-room:${headPda.toBase58()}`, "advance");
            out.advanced.push({ side: sideName, sequence: head.toString(), signature: sig });
            log(tierUsd, `advanced ${action.reason}`, { side: sideName, seq: head.toString(), sig });
            continue;
          } catch (e) {
            const deferred = maintenanceDeferral(e);
            if (deferred) {
              out.pending = true;
              out.deferred = deferred;
              return out;
            }
            const msg = e instanceof Error ? e.message : String(e);
            if (isBenignRaceError(msg)) {
              out.notes.push(`${sideName} advance raced; refetching`);
              continue;
            }
            if (isTransientCrankError(msg)) {
              out.notes.push(`${sideName} advance transient; retry later`);
              break;
            }
            out.invariants.push(`${sideName} advance failed: ${msg.slice(0, 120)}`);
            break;
          }
        }
        if (action.kind === "keep-valid") {
          // Verify Active entry consistency before declaring it legitimate.
          const entrySide = entry.side as number;
          const entryTier = entry.tierUsd as number;
          const entrySeq = BigInt((entry.sequence as { toString(): string }).toString());
          const entryPlayer = entry.player as PublicKey;
          if (entrySide !== side || entryTier !== tierUsd || entrySeq !== head) {
            out.invariants.push(
              `${sideName} active head mismatch (side=${entrySide} tier=${entryTier} seq=${entrySeq} head=${head})`
            );
            log(tierUsd, "invariant: active head field mismatch", { side: sideName });
            break;
          }
          const [psAddr] = playerPda(program.programId, entryPlayer);
          const ps = await fetchPlayerStateCompat(connection, psAddr).catch(() => null);
          if (!ps) {
            out.notes.push(`${sideName} playerstate unreadable; retry later, keeping player`);
            out.pending = true;
            break;
          }
          const consistent = isLegitimateQueuedPlayer({
            playerMatches: ps.player.toBase58() === entryPlayer.toBase58(),
            queued: Boolean(ps.queued),
            sideMatches: ps.queuedSide === side,
            sequenceMatches: ps.queuedSequence === head,
            tierMatches: (ps.queuedTierUsd || tierUsd) === tierUsd,
            notInMatch: !ps.inMatch,
          });
          if (consistent) {
            out.notes.push(`${sideName} head seq=${head} is a legitimate queued player; kept`);
            break; // stop advancing this side — real player.
          }
          out.invariants.push(
            `${sideName} active entry/playerstate disagree (player=${entryPlayer.toBase58()} seq=${head})`
          );
          log(tierUsd, "invariant: active entry/playerstate disagree", {
            side: sideName,
            seq: head.toString(),
          });
          break; // do NOT silently skip; operator must inspect.
        }
        // retry-transient / invariant kinds stop this side without mutation.
        out.notes.push(`${sideName}: ${action.reason}`);
        if (action.kind === "invariant") out.invariants.push(`${sideName}: ${action.reason}`);
        break;
      }
    }

    // 2. Attempt matches for immediately-matchable pairs (bounded).
    for (let m = 0; m < MAX_MATCHES_PER_RUN; m++) {
      const freshCfg = await withTransientRetry(() => sdk.fetchConfig(), { attempts: 3, baseMs: 400 });
      if (freshCfg.paused) break;
      const freshRoom = await withTransientRetry(() => sdk.fetchRoom(tierUsd), { attempts: 3, baseMs: 400 });
      if (freshRoom.headsHead >= freshRoom.headsNext || freshRoom.tailsHead >= freshRoom.tailsNext) {
        out.notes.push("one side empty; valid solo player remains queued");
        break;
      }
      const [hh] = roomQueuePda(program.programId, tierUsd, 0, freshRoom.headsHead);
      const [th] = roomQueuePda(program.programId, tierUsd, 1, freshRoom.tailsHead);
      const [he, te] = await Promise.all([
        (
          program.account as unknown as Record<string, { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> }>
        ).roomQueueEntry.fetch(hh).catch(() => null),
        (
          program.account as unknown as Record<string, { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> }>
        ).roomQueueEntry.fetch(th).catch(() => null),
      ]);
      if (!he || !te) {
        out.notes.push("heads/tails head unreadable; retry later");
        out.pending = true;
        break;
      }
      const sOf = (e: Record<string, unknown>): string =>
        String(Object.keys((e.status ?? {}) as object)[0] ?? "").toLowerCase();
      if (sOf(he) !== "active" || sOf(te) !== "active") break; // holes remain; next run advances.
      if ((he.side as number) !== 0 || (te.side as number) !== 1) {
        out.invariants.push("wrong side at heads");
        break;
      }
      if ((he.tierUsd as number) !== tierUsd || (te.tierUsd as number) !== tierUsd) {
        out.invariants.push("tier mismatch at heads");
        break;
      }
      const hePlayer = he.player as PublicKey;
      const tePlayer = te.player as PublicKey;
      if (hePlayer.equals(tePlayer)) {
        out.notes.push("self match rejected");
        break;
      }
      const [hsAddr] = playerPda(program.programId, hePlayer);
      const [tsAddr] = playerPda(program.programId, tePlayer);
      const [hs, ts] = await Promise.all([
        fetchPlayerStateCompat(connection, hsAddr).catch(() => null),
        fetchPlayerStateCompat(connection, tsAddr).catch(() => null),
      ]);
      if (!hs || !ts) {
        out.notes.push("player state unreadable; retry later");
        out.pending = true;
        break;
      }
      const matchLock = `match-room:${tierUsd}:${freshCfg.totalMatches.toString()}`;
      if (!tryAcquireCrankLock(matchLock)) {
        out.notes.push("match in-progress elsewhere");
        break;
      }
      try {
        const nonce = createMatchNonce();
        const { tx } = await sdk.matchNextRoomTx(
          sponsorKp.publicKey,
          freshCfg.totalMatches,
          tierUsd,
          hh,
          th,
          hsAddr,
          tsAddr,
          VRF_TREASURY,
          nonce
        );
        let sig = "";
        try {
          sig = await sendSponsorTx(connection, sponsorKp, tx, `match:${freshCfg.totalMatches}`, "match");
        } catch (e) {
          const deferred = maintenanceDeferral(e);
          if (deferred) {
            out.pending = true;
            out.deferred = deferred;
            return out;
          }
          const msg = e instanceof Error ? e.message : String(e);
          if (isBenignRaceError(msg)) {
            out.notes.push("match raced; queue changed, refetching");
            continue; // benign race → refetch → reconcile again.
          }
          throw e;
        }
        const [mpda] = matchPda(program.programId, freshCfg.totalMatches);
        const created = await program.account.match.fetch(mpda).catch(() => null);
        if (!created) {
          out.notes.push("match not readable after send; refetching");
          continue;
        }
        const createdTier = (created as unknown as { tierUsd?: number }).tierUsd;
        if (typeof createdTier === "number" && createdTier !== tierUsd) {
          out.invariants.push(`match tier ${createdTier} != room tier ${tierUsd}`);
          break;
        }
        try {
          const { queueSettlementJob } = await import("@/lib/settlement/settle");
          await queueSettlementJob(freshCfg.totalMatches, tierUsd);
        } catch {
          // polling still drives settlement
        }
        out.matched.push({ matchId: freshCfg.totalMatches.toString(), signature: sig });
        log(tierUsd, "matched", { matchId: freshCfg.totalMatches.toString(), sig });
      } finally {
        releaseCrankLock(matchLock);
      }
    }
    return out;
  } catch (error) {
    const deferred = maintenanceDeferral(error);
    if (!deferred) throw error;
    out.pending = true;
    out.deferred = deferred;
    return out;
  } finally {
    releaseCrankLock(lockKey);
  }
}
