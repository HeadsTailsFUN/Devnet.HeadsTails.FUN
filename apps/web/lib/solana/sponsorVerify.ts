import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { validateMatchNonce, VRF_SEED_DOMAIN } from "@heads-or-tails/game-sdk";
import {
  SPONSOR_MAX_REIMBURSE_PER_ACTION_LAMPORTS,
  type SponsorAction,
} from "./sponsorGate";

/**
 * Hardened Devnet sponsor verification (pure; unit-tested).
 * - Exact top-level instruction-shape verification per action.
 * - App-attributable cost only (fee + verified PDA rent).
 * - Never trusts client amounts or bare wallet delta.
 */

export const GAME_PROGRAM_ID = "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
export const ORAO_VRF_PROGRAM_ID = "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

// Anchor discriminators sha256("global:<name>")[0..8], verified against
// packages/game-sdk/src/idl.json discriminant arrays (V1 legacy + V2 room).
export const DISCRIMINATORS: Record<string, string> = {
  join_hts_queue_room: "410c814f9957999b",
  cancel_hts_queue_entry_room: "83dc3b8f31f93e0d",
  match_next_hts_room: "25eb7656f9395ba8",
  settle_hts_match: "b18f7b3cc435448d",
  join_queue: "9d73306d4156cbee",
  join_queue_room: "f3fc80117c0b29d5",
  cancel_queue_entry: "a4b78f7576dd580a",
  cancel_queue_entry_room: "7bb690945585af9d",
  match_next: "3602d100a30a1fe1",
  match_next_room: "5e1d75c44290f55e",
  settle_match: "477c7560bfd97418",
};

export function isHtsInstruction(data: Uint8Array | null): boolean {
  if (!data || data.length < 8) return false;
  const prefix = Buffer.from(data.subarray(0,8)).toString("hex");
  return [DISCRIMINATORS.join_hts_queue_room,DISCRIMINATORS.cancel_hts_queue_entry_room,DISCRIMINATORS.match_next_hts_room,DISCRIMINATORS.settle_hts_match].includes(prefix);
}
function generationFor(data: Uint8Array | null): "legacy" | "hts" { return isHtsInstruction(data) ? "hts" : "legacy"; }

export function discriminatorFor(action: SponsorAction): string {
  if (action === "join") return DISCRIMINATORS.join_queue;
  if (action === "cancel") return DISCRIMINATORS.cancel_queue_entry;
  if (action === "match") return DISCRIMINATORS.match_next;
  return DISCRIMINATORS.settle_match; // claim + settle both settle_match
}

/**
 * Accepted discriminators per action. The live UI sends V2 room-based
 * instructions (`join_queue_room` / `cancel_queue_entry_room`); legacy V1
 * discriminators stay recognized as narrow historical compat (same program,
 * same wallet-participation + PDA checks). Anything else is rejected.
 */
export function discriminatorsFor(action: SponsorAction): string[] {
  if (action === "join") return [DISCRIMINATORS.join_hts_queue_room, DISCRIMINATORS.join_queue_room, DISCRIMINATORS.join_queue];
  if (action === "cancel") {
    return [DISCRIMINATORS.cancel_hts_queue_entry_room, DISCRIMINATORS.cancel_queue_entry_room, DISCRIMINATORS.cancel_queue_entry];
  }
  if (action === "match") return [DISCRIMINATORS.match_next_hts_room, DISCRIMINATORS.match_next_room, DISCRIMINATORS.match_next];
  return [DISCRIMINATORS.settle_hts_match, DISCRIMINATORS.settle_match]; // claim + settle both settle_match
}

/** True when the game ix data carries the CURRENT room-based discriminator. */
export function isRoomInstruction(action: SponsorAction, gameData: Uint8Array | null): boolean {
  if (!gameData || gameData.length < 8) return false;
  const got = bytesToHex(gameData.slice(0, 8));
  if (action === "join") return [DISCRIMINATORS.join_hts_queue_room,DISCRIMINATORS.join_queue_room].includes(got);
  if (action === "cancel") return [DISCRIMINATORS.cancel_hts_queue_entry_room,DISCRIMINATORS.cancel_queue_entry_room].includes(got);
  if (action === "match") return [DISCRIMINATORS.match_next_hts_room,DISCRIMINATORS.match_next_room].includes(got);
  return false;
}

export interface TopLevelIx {
  programId: string;
  /** Raw instruction data bytes (for game ix discriminator check), if known. */
  data: Uint8Array | null;
  /** Resolved account addresses in IDL order (for game ix account mapping). */
  accounts?: string[];
}

/** IDL account positions for match_next (see game IDL). */
export const MATCH_IX_TREASURY_POS = 9;
export const MATCH_IX_RANDOMNESS_POS = 10;
export const MATCH_IX_MIN_ACCOUNTS = 12;
/** Upper bound for a verified in-tx ORAO treasury fee (protocol fee is ~300k). */
export const MAX_ORAO_TREASURY_FEE_LAMPORTS = 1_000_000;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  eligibleLamports?: number;
}

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function decodeDataB58OrB64(raw: string | null): Uint8Array | null {
  if (!raw) return null;
  // Try bs58 first (web3.js compiled ix data), then base64.
  try {
    const d = bs58.decode(raw.trim());
    if (d.length >= 8) return d;
  } catch {
    // fall through
  }
  try {
    const d = Buffer.from(raw.trim(), "base64");
    if (d.length >= 8) return new Uint8Array(d);
  } catch {
    return null;
  }
  return null;
}

export function decodeBase58Data(raw: string | null): Uint8Array | null {
  return decodeDataB58OrB64(raw);
}

/**
 * Decode join args: side u8, tier u8, stake u64 LE, sequence u64 LE.
 * V1 `join_queue` and V2 `join_queue_room` share this exact arg layout
 * (verified against the IDL + programs/heads-or-tails/src/lib.rs), so one
 * decoder serves both; only the discriminator + queue PDA seeds differ.
 */
export function decodeJoinArgs(data: Uint8Array): { side: number; tier: number; sequence: bigint } | null {
  if (data.length < 8 + 1 + 1 + 8 + 8) return null;
  try {
    const side = data[8];
    const tier = data[9];
    const seq = Buffer.from(data.slice(8 + 1 + 1 + 8, 8 + 1 + 1 + 8 + 8)).readBigUInt64LE(0);
    if (side !== 0 && side !== 1) return null;
    return { side, tier, sequence: seq };
  } catch {
    return null;
  }
}

/** Decode match_next / settle_match args: match_id u64 LE. */
export function decodeMatchId(data: Uint8Array): bigint | null {
  if (data.length < 8 + 8) return null;
  try {
    return Buffer.from(data.slice(8, 16)).readBigUInt64LE(0);
  } catch {
    return null;
  }
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function derivePlayerStatePda(programId: string, wallet: string, generation: "legacy" | "hts" = "legacy"): string {
  const prog = new PublicKey(programId);
  const owner = new PublicKey(wallet);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(generation === "hts" ? "hts-player" : "player"), owner.toBuffer()],
    prog
  );
  return pda.toBase58();
}

export function deriveQueueEntryPda(programId: string, side: number, sequence: bigint): string {
  const prog = new PublicKey(programId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("queue"), Buffer.from([side]), u64le(sequence)],
    prog
  );
  return pda.toBase58();
}

/**
 * V2 room queue entry PDA: ["queue", tier_byte, side_byte, sequence_le]
 * (programs/heads-or-tails/src/rooms.rs `room_queue_pda`). This is the
 * entry the live UI creates; the legacy seeds above are V1-history only.
 */
export function deriveRoomQueueEntryPda(
  programId: string,
  tierUsd: number,
  side: number,
  sequence: bigint,
  generation: "legacy" | "hts" = "legacy"
): string {
  const prog = new PublicKey(programId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(generation === "hts" ? "hts-queue" : "queue"), Buffer.from([tierUsd]), Buffer.from([side]), u64le(sequence)],
    prog
  );
  return pda.toBase58();
}

export function deriveMatchPda(programId: string, matchId: bigint, generation: "legacy" | "hts" = "legacy"): string {
  const prog = new PublicKey(programId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(generation === "hts" ? "hts-match" : "match"), u64le(matchId)],
    prog
  );
  return pda.toBase58();
}

/** ORAO seed = sha256("heads-or-tails-vrf-v1" || program || matchId LE). */
export function deriveVrfSeed(programId: string, matchId: bigint): Buffer {
  const prog = new PublicKey(programId);
  return createHash("sha256")
    .update(Buffer.from("heads-or-tails-vrf-v1"))
    .update(prog.toBuffer())
    .update(u64le(matchId))
    .digest();
}

/** Decode historical v1 or nonce v2 match bytes. Never reinterpret a
 * truncated nonce as an old request. This does not enable public match refunds. */
export function deriveVrfSeedForInstruction(programId: string, data: Uint8Array): Buffer {
  const discriminator = bytesToHex(data.slice(0, 8));
  if (![DISCRIMINATORS.match_next, DISCRIMINATORS.match_next_room, DISCRIMINATORS.match_next_hts_room].includes(discriminator)) {
    throw new Error("Not a match instruction");
  }
  const offset = isRoomInstruction("match", data) ? 17 : 16;
  const id = decodeMatchId(data);
  if (id === null) throw new Error("Invalid match id");
  if (data.length === offset && !isHtsInstruction(data)) return deriveVrfSeed(programId, id);
  if (data.length !== offset + 32) throw new Error("Invalid match nonce encoding");
  const nonce = data.slice(offset);
  validateMatchNonce(nonce);
  return createHash("sha256").update(Buffer.concat([
    Buffer.from(VRF_SEED_DOMAIN), new PublicKey(programId).toBuffer(), u64le(id), Buffer.from(nonce),
  ])).digest();
}

export function deriveRandomnessPda(seed: Uint8Array): string {
  const orao = new PublicKey(ORAO_VRF_PROGRAM_ID);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("orao-vrf-randomness-request"), Buffer.from(seed)],
    orao
  );
  return pda.toBase58();
}

/**
 * Exact top-level shape verification.
 * Allowed per action:
 * - join/cancel/match: ComputeBudget* + exactly 1 game ix (correct discriminator). No System/Token/AToken/unknown.
 * - claim/settle: ComputeBudget* + 0..1 AToken (winner ATA creation) + exactly 1 game settle_match. No System/Token/unknown.
 */
export function verifyTopLevelShape(args: {
  action: SponsorAction;
  topLevel: TopLevelIx[];
}): VerifyResult {
  const { action, topLevel } = args;
  if (topLevel.length === 0) return { ok: false, reason: "empty instructions" };
  if (topLevel.length > 5) return { ok: false, reason: "too many top-level instructions" };

  let gameCount = 0;
  let computeCount = 0;
  let atokenCount = 0;
  let gameData: Uint8Array | null = null;

  for (const ix of topLevel) {
    const pid = ix.programId;
    if (pid === COMPUTE_BUDGET_PROGRAM_ID) {
      computeCount += 1;
      continue;
    }
    if (pid === GAME_PROGRAM_ID) {
      gameCount += 1;
      if (gameData === null) gameData = ix.data;
      continue;
    }
    if (pid === ATOKEN_PROGRAM_ID) {
      atokenCount += 1;
      continue;
    }
    // Explicit rejections with clear reasons (never allowlisted silently).
    if (pid === SYSTEM_PROGRAM_ID) {
      return { ok: false, reason: "unexpected top-level SystemProgram instruction" };
    }
    if (pid === TOKEN_PROGRAM_ID) {
      return { ok: false, reason: "unexpected top-level SPL token instruction" };
    }
    return { ok: false, reason: `unexpected top-level program ${pid}` };
  }

  if (gameCount !== 1) {
    return { ok: false, reason: `expected exactly 1 game instruction, got ${gameCount}` };
  }

  const claimLike = action === "claim" || action === "settle";
  if (!claimLike && atokenCount !== 0) {
    return { ok: false, reason: "unexpected AssociatedToken instruction for this action" };
  }
  if (claimLike && atokenCount > 1) {
    return { ok: false, reason: "too many AssociatedToken instructions" };
  }

  if (!gameData || gameData.length < 8) {
    return { ok: false, reason: "cannot decode game instruction" };
  }
  const got = bytesToHex(gameData.slice(0, 8));
  // Room-first accept set: the CURRENT room instruction the live UI sends,
  // plus the narrow legacy V1 discriminator for historical compat.
  if (!discriminatorsFor(action).includes(got)) {
    return { ok: false, reason: `wrong game instruction for ${action}` };
  }
  return { ok: true };
}

/**
 * App-attributable cost only: fee + rent to verified expected PDAs.
 * Rent is counted only when the expected PDA shows a positive balance delta
 * (creation/funding in this tx). Arbitrary transfers to other accounts are
 * never counted.
 */
export function calculateEligibleCost(args: {
  feeLamports: number;
  accountKeys: string[];
  preBalances: (number | null)[];
  postBalances: (number | null)[];
  expectedPdaAddresses: string[];
}): { eligible: number; rent: number } {
  const fee = Math.max(0, Math.floor(args.feeLamports));
  let rent = 0;
  for (const pda of args.expectedPdaAddresses) {
    const idx = args.accountKeys.indexOf(pda);
    if (idx < 0) continue;
    const pre = args.preBalances[idx];
    const post = args.postBalances[idx];
    if (pre === null || post === null) continue;
    if (!Number.isFinite(pre) || !Number.isFinite(post)) continue;
    const delta = post - pre;
    // Creation/funding only; never negative (drain) and never huge.
    if (delta > 0 && delta <= 10_000_000) {
      rent += delta;
    }
  }
  // Bound total rent per tx to a safe PDA-creation envelope (2 PDAs + ATA/VRF).
  rent = Math.min(rent, 10_000_000);
  return { eligible: fee + rent, rent };
}

/** Legacy compat: derive expected PDAs for an action (best-effort). */
export function expectedPdasForAction(args: {
  action: SponsorAction;
  wallet: string;
  gameData: Uint8Array | null;
}): string[] {
  const out: string[] = [];
  try {
    if (args.action === "join") {
      out.push(derivePlayerStatePda(GAME_PROGRAM_ID, args.wallet, generationFor(args.gameData)));
      if (args.gameData) {
        const j = decodeJoinArgs(args.gameData);
        if (j) {
          // Room joins fund the tier-scoped entry; legacy joins the V1 slot.
          // The variant is read from the ix discriminator itself (never the
          // client-provided action string).
          out.push(
            isRoomInstruction("join", args.gameData)
              ? deriveRoomQueueEntryPda(GAME_PROGRAM_ID, j.tier, j.side, j.sequence, generationFor(args.gameData))
              : deriveQueueEntryPda(GAME_PROGRAM_ID, j.side, j.sequence)
          );
        }
      }
    } else if (args.action === "cancel") {
      out.push(derivePlayerStatePda(GAME_PROGRAM_ID, args.wallet, generationFor(args.gameData)));
    } else if (args.action === "match") {
      if (args.gameData) {
        const id = decodeMatchId(args.gameData);
        if (id !== null) {
          out.push(deriveMatchPda(GAME_PROGRAM_ID, id, generationFor(args.gameData)));
          try {
            out.push(deriveRandomnessPda(deriveVrfSeedForInstruction(GAME_PROGRAM_ID, args.gameData)));
          } catch {
            // ORAO PDA optional; match PDA is required.
          }
        }
      }
    } else {
      // claim/settle: no new game PDA; winner ATA rent handled via ATA ix allowance.
      // Fee-only unless caller supplies ATA address explicitly (route does).
    }
  } catch {
    // Derivation failure -> fee-only (fail-closed on rent, not on fee).
  }
  return out;
}

/**
 * Full hardened verification: exact shape + attributable cost.
 * Pure logic over already-fetched metadata. Never trusts client amounts.
 */
export function verifySponsorTransaction(args: {
  action: SponsorAction;
  expectedWallet: string;
  txWallet: string;
  topLevel: TopLevelIx[];
  accountKeys: string[];
  preBalances: (number | null)[];
  postBalances: (number | null)[];
  feeLamports: number;
  /** Optional explicit ATA address for claim/settle rent (verified via ATA ix). */
  ataAddress?: string | null;
}): VerifyResult {
  if (args.txWallet !== args.expectedWallet) {
    return { ok: false, reason: "wallet mismatch" };
  }
  if (!Number.isFinite(args.feeLamports) || args.feeLamports < 0) {
    return { ok: false, reason: "invalid fee" };
  }

  const shape = verifyTopLevelShape({ action: args.action, topLevel: args.topLevel });
  if (!shape.ok) return shape;

  const gameIx = args.topLevel.find((ix) => ix.programId === GAME_PROGRAM_ID);
  const gameData = gameIx?.data ?? null;
  if ((args.action === "join" || args.action === "cancel") &&
      (args.accountKeys[0] !== args.expectedWallet || gameIx?.accounts?.[0] !== args.expectedWallet)) {
    return { ok: false, reason: "wallet is not the game player and fee payer" };
  }

  // Verify deterministic PDA presence for rent-bearing actions.
  const expected = expectedPdasForAction({
    action: args.action,
    wallet: args.expectedWallet,
    gameData,
  });
  if (args.action === "join") {
    // PlayerState must always be present; QueueEntry requires decodable args.
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, args.expectedWallet, generationFor(gameData));
    if (!args.accountKeys.includes(ps)) {
      return { ok: false, reason: "PlayerState PDA missing" };
    }
    if (gameData) {
      const j = decodeJoinArgs(gameData);
      if (!j) return { ok: false, reason: "cannot decode join args" };
      // Room joins reference the tier-scoped entry; legacy joins the V1
      // slot. The variant comes from the on-chain ix discriminator itself —
      // never from client input — so a room join can only match its exact
      // (tier, side, sequence) entry.
      const entry = isRoomInstruction("join", gameData)
        ? deriveRoomQueueEntryPda(GAME_PROGRAM_ID, j.tier, j.side, j.sequence, generationFor(gameData))
        : deriveQueueEntryPda(GAME_PROGRAM_ID, j.side, j.sequence);
      if (!args.accountKeys.includes(entry)) {
        return { ok: false, reason: "QueueEntry PDA missing" };
      }
    }
  }
  if (args.action === "match" && gameData) {
    const id = decodeMatchId(gameData);
    if (id === null) return { ok: false, reason: "cannot decode match id" };
    const mpda = deriveMatchPda(GAME_PROGRAM_ID, id, generationFor(gameData));
    if (!args.accountKeys.includes(mpda)) {
      return { ok: false, reason: "Match PDA missing" };
    }
  }

  // Verified ORAO treasury fee (match only): the caller funds the VRF request
  // fee to the ORAO treasury in the same tx. Include it ONLY when the game ix
  // account mapping proves the treasury/randomness positions and the
  // randomness account equals the derived PDA for this match.
  let oraoFee = 0;
  if (args.action === "match" && gameData) {
    const gacc = gameIx?.accounts ?? [];
    const roomOffset = (isRoomInstruction("match", gameData) ? 1 : 0) + (isHtsInstruction(gameData) ? 1 : 0);
    if (gacc.length < MATCH_IX_MIN_ACCOUNTS + roomOffset) {
      return { ok: false, reason: "malformed match instruction" };
    }
    const id = decodeMatchId(gameData);
    if (id === null) return { ok: false, reason: "cannot decode match id" };
    let expectedRand: string;
    try { expectedRand = deriveRandomnessPda(deriveVrfSeedForInstruction(GAME_PROGRAM_ID, gameData)); }
    catch { return { ok: false, reason: "invalid match seed encoding" }; }
    if (gacc[MATCH_IX_RANDOMNESS_POS + roomOffset] !== expectedRand) {
      return { ok: false, reason: "wrong randomness account" };
    }
    const treasAddr = gacc[MATCH_IX_TREASURY_POS + roomOffset];
    if (!treasAddr || treasAddr === args.expectedWallet) {
      return { ok: false, reason: "unexpected treasury account" };
    }
    const tIdx = args.accountKeys.indexOf(treasAddr);
    if (tIdx < 0) return { ok: false, reason: "treasury account missing" };
    const tPre = args.preBalances[tIdx];
    const tPost = args.postBalances[tIdx];
    if (tPre === null || tPost === null || !Number.isFinite(tPre) || !Number.isFinite(tPost)) {
      return { ok: false, reason: "cannot read treasury delta" };
    }
    const tDelta = tPost - tPre;
    if (tDelta < 0) return { ok: false, reason: "unexpected treasury delta" };
    if (tDelta > MAX_ORAO_TREASURY_FEE_LAMPORTS) {
      return { ok: false, reason: "treasury fee exceeds bound" };
    }
    oraoFee = Math.floor(tDelta);
  }

  // Claim/settle ATA rent: only if ATA ix present and ATA address supplied.
  const atas: string[] = [];
  if ((args.action === "claim" || args.action === "settle") && args.ataAddress) {
    const hasAtaIx = args.topLevel.some((ix) => ix.programId === ATOKEN_PROGRAM_ID);
    if (hasAtaIx && args.accountKeys.includes(args.ataAddress)) {
      atas.push(args.ataAddress);
    }
  }

  const { eligible } = calculateEligibleCost({
    feeLamports: args.feeLamports,
    accountKeys: args.accountKeys,
    preBalances: args.preBalances,
    postBalances: args.postBalances,
    expectedPdaAddresses: [...expected, ...atas],
  });
  const total = eligible + oraoFee;

  if (total <= 0) return { ok: false, reason: "no eligible cost" };
  if (total > SPONSOR_MAX_REIMBURSE_PER_ACTION_LAMPORTS) {
    return { ok: false, reason: "exceeds per-action cap" };
  }
  return { ok: true, eligibleLamports: Math.floor(total) };
}

/**
 * Back-compat overload for older unit tests: programIds-only shape.
 * Interprets programIds as top-level program set without data (data=null).
 * Strict: System/Token/unknown top-level still rejected.
 */
export function verifySponsorTransactionLegacyCompat(args: {
  action: SponsorAction;
  expectedWallet: string;
  txWallet: string;
  programIds: string[];
  feeLamports: number;
}): VerifyResult {
  const topLevel: TopLevelIx[] = args.programIds.map((programId) => ({
    programId,
    data: programId === GAME_PROGRAM_ID ? null : null,
  }));
  // Without data we cannot verify discriminator; fail-closed unless caller
  // uses the full verifier. This compat path only checks allowlist strictly.
  for (const pid of args.programIds) {
    if (
      pid !== GAME_PROGRAM_ID &&
      pid !== COMPUTE_BUDGET_PROGRAM_ID &&
      pid !== ATOKEN_PROGRAM_ID
    ) {
      if (pid === SYSTEM_PROGRAM_ID) {
        return { ok: false, reason: "unexpected top-level SystemProgram instruction" };
      }
      if (pid === TOKEN_PROGRAM_ID) {
        return { ok: false, reason: "unexpected top-level SPL token instruction" };
      }
      if (pid === ORAO_VRF_PROGRAM_ID) {
        // ORAO appears as inner CPI, never top-level in our flow.
        return { ok: false, reason: `unexpected top-level program ${pid}` };
      }
      return { ok: false, reason: `unexpected top-level program ${pid}` };
    }
  }
  if (!args.programIds.includes(GAME_PROGRAM_ID)) {
    return { ok: false, reason: "game program not involved" };
  }
  void topLevel;
  if (args.txWallet !== args.expectedWallet) {
    return { ok: false, reason: "wallet mismatch" };
  }
  return { ok: true, eligibleLamports: Math.floor(args.feeLamports) };
}

export function isValidGameActionForSponsor(action: string): boolean {
  return ["join", "cancel", "match", "claim", "settle"].includes(action);
}

export function pubkeyOrNull(s: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

export { decodeDataB58OrB64 as decodeInstructionData };
