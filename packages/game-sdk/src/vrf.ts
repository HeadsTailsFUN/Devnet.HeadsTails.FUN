import { PublicKey } from "@solana/web3.js";

export const VRF_SEED_DOMAIN = "heads-or-tails-vrf-v2";

/** Generate once per new match attempt; journal retries reuse signed bytes. */
export function createMatchNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  do { globalThis.crypto.getRandomValues(nonce); } while (!nonce.some(b => b !== 0));
  return nonce;
}

export function validateMatchNonce(nonce: Uint8Array): void {
  if (nonce.length !== 32 || !nonce.some(b => b !== 0)) {
    throw new Error("Match nonce must be 32 bytes and nonzero");
  }
}

/** Domain/program/counter/nonce binding shared by every new-match builder. */
export async function deriveMatchSeed(programId: PublicKey, matchId: bigint, nonce: Uint8Array): Promise<Buffer> {
  validateMatchNonce(nonce);
  if (matchId < 0n || matchId > 0xffffffffffffffffn) throw new Error("Invalid u64 match id");
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(matchId);
  return Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", Buffer.concat([
    Buffer.from(VRF_SEED_DOMAIN), programId.toBuffer(), id, Buffer.from(nonce),
  ])));
}
