import type { Connection } from "@solana/web3.js";
import { oraoRandomnessPda } from "./pdas.js";

export type RandomnessStatus =
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "fulfilled"; resultBit: 0 | 1; randomness: Uint8Array };

/**
 * Read an ORAO RandomnessV2 account without trusting it.
 * Layout (orao-solana-vrf 0.7.0): 8 discriminator + 1 enum tag +
 * 32 client + 32 seed + 64 randomness. Fulfilled tag = 1.
 */
export async function fetchRandomnessStatus(
  connection: Connection,
  seed: Uint8Array
): Promise<RandomnessStatus & { address: string }> {
  const [address] = oraoRandomnessPda(seed);
  const info = await connection.getAccountInfo(address);
  if (!info) return { kind: "missing", address: address.toBase58() };
  const data = info.data;
  if (data.length < 8 + 1 + 32 + 32) return { kind: "pending", address: address.toBase58() };
  if (data[8] !== 1) return { kind: "pending", address: address.toBase58() };
  const randomness = data.subarray(8 + 1 + 32 + 32, 8 + 1 + 32 + 32 + 64);
  return {
    kind: "fulfilled",
    resultBit: ((randomness[0] & 1) === 0 ? 0 : 1) as 0 | 1,
    randomness,
    address: address.toBase58(),
  };
}
