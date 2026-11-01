import { PublicKey } from "@solana/web3.js";

export type GameGeneration = "legacy" | "hts";
function gameSeed(seed: string, generation: GameGeneration): Buffer {
  if (generation !== "legacy" && generation !== "hts") throw new Error("Invalid game generation");
  return Buffer.from(generation === "hts" ? "hts-" + seed : seed);
}

export const HEADS = 0;
export const TAILS = 1;

export const ORAO_VRF_PROGRAM_ID = new PublicKey(
  "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
);

const CONFIG_SEED = Buffer.from("config");
const PLAYER_SEED = Buffer.from("player");
const QUEUE_SEED = Buffer.from("queue");
const MATCH_SEED = Buffer.from("match");
const VAULT_SEED = Buffer.from("vault");
const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");
const ORAO_CONFIG_SEED = Buffer.from("orao-vrf-network-configuration");
const ORAO_RANDOMNESS_SEED = Buffer.from("orao-vrf-randomness-request");

function u64le(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export function configPda(programId: PublicKey, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([gameSeed("config", generation)], programId);
}

export function playerPda(
  programId: PublicKey,
  player: PublicKey, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [gameSeed("player", generation), player.toBuffer()],
    programId
  );
}

export function queuePda(
  programId: PublicKey,
  side: number,
  sequence: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [QUEUE_SEED, Buffer.from([side]), u64le(sequence)],
    programId
  );
}

const ROOM_SEED = Buffer.from("room");

/** Tier-scoped room PDA: ["room", tier_byte]. */
export function roomPda(programId: PublicKey, tierUsd: number, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [gameSeed("room", generation), Buffer.from([tierUsd])],
    programId
  );
}

/**
 * Tier-scoped queue PDA: ["queue", tier_byte, side_byte, sequence_le].
 * A $1 entry can never share an address with a $10 entry.
 */
export function roomQueuePda(
  programId: PublicKey,
  tierUsd: number,
  side: number,
  sequence: number | bigint, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [gameSeed("queue", generation), Buffer.from([tierUsd]), Buffer.from([side]), u64le(sequence)],
    programId
  );
}

export function matchPda(
  programId: PublicKey,
  matchId: number | bigint, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [gameSeed("match", generation), u64le(matchId)],
    programId
  );
}

export function vaultPda(programId: PublicKey, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([gameSeed("vault", generation)], programId);
}

export function vaultAuthorityPda(programId: PublicKey, generation: GameGeneration = "legacy"
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([gameSeed("vault-authority", generation)], programId);
}

export function oraoNetworkStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORAO_CONFIG_SEED],
    ORAO_VRF_PROGRAM_ID
  );
}

export function oraoRandomnessPda(seed: Buffer | Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORAO_RANDOMNESS_SEED, Buffer.from(seed)],
    ORAO_VRF_PROGRAM_ID
  );
}
