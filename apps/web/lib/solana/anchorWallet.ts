import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/** Minimal anchor-compatible wallet backed by Wallet Standard signing. */
export interface AnchorWalletLike {
  readonly publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>;
}

function ensureBytes(b: unknown): Uint8Array {
  if (b instanceof Uint8Array && b.length > 0) return b;
  throw new Error(
    "WALLET_SIGNING_INVALID_OUTPUT: Your wallet could not sign this transaction correctly. Please reconnect and try again."
  );
}

export function createAnchorWallet(
  address: string,
  signBytes: (txBytes: Uint8Array) => Promise<Uint8Array>
): AnchorWalletLike {
  const publicKey = new PublicKey(address);

  async function signTransaction<
    T extends Transaction | VersionedTransaction,
  >(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      let unsigned: Uint8Array;
      try {
        unsigned = tx.serialize();
      } catch {
        throw new Error("TRANSACTION_SERIALIZATION_ERROR: Could not prepare the transaction. Please try again.");
      }
      const signedRaw = ensureBytes(await signBytes(unsigned));
      // 6. deserialization: validate before accessing.
      let parsed: VersionedTransaction;
      try {
        parsed = VersionedTransaction.deserialize(signedRaw);
      } catch {
        throw new Error(
          "WALLET_SIGNING_INVALID_OUTPUT: Your wallet could not sign this transaction correctly. Please reconnect and try again."
        );
      }
      return parsed as T;
    }
    let unsigned: Uint8Array;
    try {
      unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    } catch {
      throw new Error("TRANSACTION_SERIALIZATION_ERROR: Could not prepare the transaction. Please try again.");
    }
    const signedRaw = ensureBytes(await signBytes(unsigned));
    let parsed: Transaction;
    try {
      parsed = Transaction.from(signedRaw);
    } catch {
      throw new Error(
        "WALLET_SIGNING_INVALID_OUTPUT: Your wallet could not sign this transaction correctly. Please reconnect and try again."
      );
    }
    // Preserve the original fee payer / blockhash context without dropping
    // the wallet's signatures.
    if (!parsed.feePayer) parsed.feePayer = tx.feePayer ?? publicKey;
    if (!parsed.recentBlockhash) parsed.recentBlockhash = tx.recentBlockhash;
    return parsed as T;
  }

  async function signAllTransactions<
    T extends Transaction | VersionedTransaction,
  >(txs: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const tx of txs) out.push(await signTransaction(tx));
    return out;
  }

  return { publicKey, signTransaction, signAllTransactions };
}
