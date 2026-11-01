import { readFileSync } from "node:fs";
import {
  AnchorProvider,
  BN,
  Wallet,
  setProvider,
} from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  GameClient,
  deriveMatchSeed,
  oraoRandomnessPda,
  playerPda,
  resolveGameMatch,
} from "@heads-or-tails/game-sdk";

export interface KeeperConfig {
  rpcUrl: string;
  programId: PublicKey;
  keeperKeypairPath: string;
  cluster: string;
  pollMs: number;
  lookback: number;
}

export function resolveServerRpcUrlFromEnv(): string {
  // Dedicated Devnet RPC first; public endpoint only as local diagnostic.
  // Deployed QA must set SOLANA_SERVER_RPC_URL or INDEXER_RPC_URL.
  const server =
    process.env.SOLANA_SERVER_RPC_URL ?? process.env.INDEXER_RPC_URL;
  if (server && server.trim().length > 0) return server.trim();
  const browser = process.env.NEXT_PUBLIC_RPC_URL;
  if (browser && browser.trim().length > 0) return browser.trim();
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error(
      "Server Devnet RPC is not configured (SOLANA_SERVER_RPC_URL). Public api.devnet.solana.com must not be the primary QA RPC."
    );
  }
  return "https://api.devnet.solana.com";
}

export function loadConfigFromEnv(): KeeperConfig {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ||
      ![process.env.MAINNET_REAL_VALUE_ENABLED, process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED]
        .every(flag => flag === undefined || flag === "false")) {
    throw new Error("This keeper candidate is Devnet-only");
  }
  const keypairPath = process.env.KEEPER_KEYPAIR_PATH;
  if (!keypairPath) throw new Error("KEEPER_KEYPAIR_PATH is required");
  return {
    rpcUrl: resolveServerRpcUrlFromEnv(),
    programId: new PublicKey(
      process.env.HEADS_TAILS_PROGRAM_ID ??
        "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
    ),
    keeperKeypairPath: keypairPath,
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    pollMs: Number(process.env.KEEPER_POLL_MS ?? 15000),
    lookback: Number(process.env.KEEPER_LOOKBACK ?? 500),
  };
}

/** New match derivation only. Existing settlement must use Match.seed. */
export async function matchSeed(
  programId: PublicKey,
  matchId: bigint,
  nonce: Uint8Array
): Promise<Buffer> {
  return deriveMatchSeed(programId, matchId, nonce);
}

export async function settleMatchIfReady(
  client: GameClient,
  keeper: Keypair,
  matchId: bigint
): Promise<"settled" | "pending" | "already"> {
  if (["FwP4JekrFhJ2PksQXdi4DhiPTfVvYTkgpnjJTwaW2nY8",
      "5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW",
      "H9zwyo5FsrkrnVwUvDVksqfjmTevJQpA7oG9opLkpriL",
      ...(process.env.HEADSTAILS_RESERVED_SIGNER_PUBKEYS ?? "").split(",").map(value=>value.trim()),
      process.env.NEXT_PUBLIC_DEVNET_SERVICE_SIGNER].includes(keeper.publicKey.toBase58())) {
    throw new Error("Shared sponsor funds must use the journaled web settlement path");
  }
  if (client.program.programId.toBase58() !== "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k" ||
      await client.program.provider.connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error("Devnet identity mismatch");
  }
  const resolved = await resolveGameMatch(client.program, matchId);
  if (!resolved) return "already";
  const m = resolved.match;
  const scoped = new GameClient(client.program, resolved.configAddress, resolved.generation);
  const state = Object.keys(m.state as object)[0];
  if (state !== "waitingForRandomness") return "already";
  const seed = Buffer.from(m.seed as unknown as number[]);
  const [randomness] = oraoRandomnessPda(seed);
  const info = await client.program.provider.connection.getAccountInfo(randomness);
  if (!info) return "pending";
  const [headsState] = playerPda(
    client.program.programId,
    m.headsPlayer as PublicKey, resolved.generation
  );
  const [tailsState] = playerPda(
    client.program.programId,
    m.tailsPlayer as PublicKey, resolved.generation
  );
  const cfg = resolved.config;
  const {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
  } = await import("@solana/spl-token");
  const [winnerPreview] = await previewWinner(client, matchId);
  const winnerAta = PublicKey.findProgramAddressSync(
    [
      winnerPreview.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      (cfg.projectMint as PublicKey).toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
  // Ensure the winner ATA exists (keeper funds creation; payout still goes
  // to the winner). Idempotent: skips if already created.
  const { createAssociatedTokenAccountIdempotentInstruction } = await import(
    "@solana/spl-token"
  );
  const preIxs = [];
  const ataInfo = await client.program.provider.connection.getAccountInfo(winnerAta);
  if (!ataInfo) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        keeper.publicKey,
        winnerAta,
        winnerPreview,
        cfg.projectMint as PublicKey
      )
    );
  }
  try {
    await scoped.settleMatch(
      keeper,
      matchId,
      randomness,
      headsState,
      tailsState,
      cfg.projectMint as PublicKey,
      winnerAta,
      preIxs
    );
    return "settled";
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AlreadySettled")) return "already";
    // VRF not yet fulfilled (or clamped pending bytes): keep waiting.
    if (msg.includes("VrfNotFulfilled") || msg.includes("SeedMismatch")) {
      return "pending";
    }
    throw e;
  }
}

async function previewWinner(
  client: GameClient,
  matchId: bigint
): Promise<[PublicKey]> {
  const resolved = await resolveGameMatch(client.program, matchId);
  if (!resolved) throw new Error("Match is missing");
  const m = resolved.match;
  const seed = Buffer.from(m.seed as unknown as number[]);
  const [randomness] = oraoRandomnessPda(seed);
  const info = await client.program.provider.connection.getAccountInfo(randomness);
  if (!info) throw new Error("randomness account missing");
  // RandomnessV2 layout: 8 discriminator + 1 enum tag + 32 client + 32 seed + 64 randomness.
  // Fulfilled tag = 1.
  if (info.data.length < 8 + 1 + 32 + 32 + 64) throw new Error("not fulfilled");
  if (info.data[8] !== 1) throw new Error("not fulfilled");
  const bit = info.data[8 + 1 + 32 + 32] & 1;
  const winner =
    bit === 0 ? (m.headsPlayer as PublicKey) : (m.tailsPlayer as PublicKey);
  return [winner];
}

export async function runOnce(
  client: GameClient,
  keeper: Keypair,
  cluster: string,
  lookback: number
): Promise<{ settled: bigint[]; pending: bigint[] }> {
  void cluster;
  const cfg = await client.fetchConfig();
  const total = cfg.totalMatches;
  const start = total > BigInt(lookback) ? total - BigInt(lookback) : 0n;
  const settled: bigint[] = [];
  const pending: bigint[] = [];
  for (let id = start; id < total; id++) {
    const outcome = await settleMatchIfReady(client, keeper, id);
    if (outcome === "settled") settled.push(id);
    else if (outcome === "pending") pending.push(id);
  }
  return { settled, pending };
}

export function makeProvider(rpcUrl: string, keeper: Keypair): AnchorProvider {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), {
    commitment: "confirmed",
  });
  setProvider(provider);
  return provider;
}

export function loadKeeperKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]);
  return Keypair.fromSecretKey(secret);
}

export { BN };
