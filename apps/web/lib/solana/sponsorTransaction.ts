import type { VersionedTransactionResponse } from "@solana/web3.js";
import { decodeInstructionData, type TopLevelIx } from "./sponsorVerify";

/** RPC-owned metadata, including address lookup tables; no request identity. */
export function normalizeSponsorTransaction(tx: VersionedTransactionResponse): {
  accountKeys: string[]; topLevel: TopLevelIx[];
} {
  const message = tx.transaction.message;
  // web3 Message and MessageV0 both expose these normalized accessors.
  const keys = [...message.staticAccountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const accountKeys = keys.map((key) => key.toBase58());
  const compiled = message.compiledInstructions;
  const topLevel = compiled.map((ix): TopLevelIx => {
    const programId = accountKeys[ix.programIdIndex];
    const indexes = ix.accountKeyIndexes;
    const accounts = Array.from(indexes, (index) => accountKeys[index]);
    if (!programId || accounts.some((key) => !key)) throw new Error("Invalid transaction account mapping");
    const data = typeof ix.data === "string" ? decodeInstructionData(ix.data) : new Uint8Array(ix.data);
    return { programId, accounts, data };
  });
  return { accountKeys, topLevel };
}
