import { createHash } from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * PlayerState schema compatibility (pre/post V2 upgrade transition).
 *
 * The deployed Devnet program is still V1, whose PlayerState is 60 bytes:
 *   player(32) queued(1) queued_side(1) queued_sequence(8)
 *   in_match(1) match_id(8) bump(1)
 * V2 appends queued_tier_usd(1) + match_tier_usd(1) = 62 bytes.
 *
 * Decoding a 60-byte V1 account with the V2 IDL coder throws (out-of-range
 * read), which surfaced as a generic "Action failed". Every read path that
 * can encounter a legacy account MUST use this decoder until the on-chain
 * migration is proven complete. Pure client-side change: the .so is untouched.
 */

export const PLAYER_STATE_DISCRIMINATOR_HEX = "38033c56ae10f4c3"; // sha256("account:PlayerState")[0..8]
export const PLAYER_STATE_V1_LEN = 60;
export const PLAYER_STATE_V2_LEN = 62;
const LEGACY_TIER_USD = 1; // pre-V2 gameplay only had $1; never guess $10.

export type PlayerStateSchema = "v1" | "v2";

export interface CompatPlayerState {
  player: PublicKey;
  queued: boolean;
  queuedSide: number;
  queuedSequence: bigint;
  inMatch: boolean;
  matchId: bigint;
  /** Room context. V1 accounts normalize to $1 when a position is held. */
  queuedTierUsd: number;
  matchTierUsd: number;
  schema: PlayerStateSchema;
}

function discriminatorOf(data: Buffer | Uint8Array): string {
  return Buffer.from(data.subarray(0, 8)).toString("hex");
}

/**
 * Decode raw PlayerState bytes of EITHER layout into one normalized model.
 * Throws on discriminator mismatch or unknown length (fail closed).
 */
export function decodePlayerStateCompat(data: Buffer | Uint8Array): CompatPlayerState {
  const bytes = Buffer.from(data);
  if (bytes.length !== PLAYER_STATE_V1_LEN && bytes.length !== PLAYER_STATE_V2_LEN) {
    throw new Error(`unknown PlayerState length ${bytes.length}`);
  }
  if (discriminatorOf(bytes) !== PLAYER_STATE_DISCRIMINATOR_HEX) {
    throw new Error("not a PlayerState account");
  }
  const player = new PublicKey(bytes.subarray(8, 40));
  const queued = bytes[40] === 1;
  const queuedSide = bytes[41];
  const queuedSequence = bytes.readBigUInt64LE(42);
  const inMatch = bytes[50] === 1;
  const matchId = bytes.readBigUInt64LE(51);
  if (bytes.length === PLAYER_STATE_V1_LEN) {
    // Legacy layout: the only room that existed was $1.
    return {
      player,
      queued,
      queuedSide,
      queuedSequence,
      inMatch,
      matchId,
      queuedTierUsd: queued ? LEGACY_TIER_USD : 0,
      matchTierUsd: inMatch ? LEGACY_TIER_USD : 0,
      schema: "v1",
    };
  }
  return {
    player,
    queued,
    queuedSide,
    queuedSequence,
    inMatch,
    matchId,
    queuedTierUsd: bytes[60],
    matchTierUsd: bytes[61],
    schema: "v2",
  };
}

export interface CompatConnection {
  getAccountInfo(pk: PublicKey): Promise<{ data: Buffer | Uint8Array } | null>;
}

/**
 * Read a PlayerState through the compatibility decoder.
 * Returns null when the account does not exist (new wallet).
 * Throws on corrupt/unknown data (callers surface read errors as before).
 */
export async function fetchPlayerStateCompat(
  connection: CompatConnection | Connection,
  playerStatePk: PublicKey
): Promise<CompatPlayerState | null> {
  const info = await (connection as Connection).getAccountInfo(playerStatePk);
  if (!info) return null;
  return decodePlayerStateCompat(Buffer.from(info.data));
}
