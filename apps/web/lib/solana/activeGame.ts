import { PublicKey } from "@solana/web3.js";
import * as sdk from "@heads-or-tails/game-sdk";

// This release's gameplay is HTS-only. Historical reads/refunds must opt in
// explicitly to the SDK's legacy generation rather than share active PDAs.
export const ACTIVE_GAME_GENERATION = "hts" as const;
export const configPda = (program: PublicKey) => sdk.configPda(program, "hts");
export const playerPda = (program: PublicKey, player: PublicKey) => sdk.playerPda(program, player, "hts");
export const roomPda = (program: PublicKey, tier: number) => sdk.roomPda(program, tier, "hts");
export const roomQueuePda = (program: PublicKey, tier: number, side: number, sequence: number | bigint) => sdk.roomQueuePda(program, tier, side, sequence, "hts");
export const matchPda = (program: PublicKey, id: number | bigint) => sdk.matchPda(program, id, "hts");
