import {
  AnchorProvider,
  BN,
  Program,
} from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Transaction, VersionedTransaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assertHtsRoomStake } from "./usdReference.js";
import { createMatchNonce, deriveMatchSeed } from "./vrf.js";
import idlJson from "./idl.json" with { type: "json" };
import type { HeadsOrTails } from "./idl-types.js";
import {
  type GameGeneration,
  HEADS,
  ORAO_VRF_PROGRAM_ID,
  configPda,
  matchPda,
  oraoNetworkStatePda,
  oraoRandomnessPda,
  playerPda,
  queuePda,
  roomPda,
  roomQueuePda,
  vaultAuthorityPda,
  vaultPda,
} from "./pdas.js";
import { fetchPlayerStateCompat } from "./playerStateCompat.js";

export const PROGRAM_ID = new PublicKey(
  "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
);

export type HeadsOrTailsIdl = HeadsOrTails;

export function loadProgram(provider: AnchorProvider): Program<HeadsOrTails> {
  return new Program<HeadsOrTails>(idlJson as HeadsOrTails, provider);
}

export interface QueueAccounts {
  playerState: PublicKey;
  entry: PublicKey;
  sequence: bigint;
}

export class GameClient {
  constructor(
    readonly program: Program<HeadsOrTails>,
    readonly config: PublicKey,
    readonly generation: GameGeneration = "legacy"
  ) {
    if (!config.equals(configPda(program.programId, generation)[0])) throw new Error("Config does not match game generation");
  }

  private requireLegacy(): void {
    if (this.generation !== "legacy") throw new Error("Historical instruction requires an explicit legacy client");
  }

  static async load(
    provider: AnchorProvider,
    config?: PublicKey,
    generation: GameGeneration = "legacy"
  ): Promise<GameClient> {
    const program = loadProgram(provider);
    const [configPk] = configPda(program.programId, generation);
    return new GameClient(program, config ?? configPk, generation);
  }

  async fetchConfig(): Promise<{
    headsHead: bigint;
    headsNext: bigint;
    tailsHead: bigint;
    tailsNext: bigint;
    totalMatches: bigint;
    paused: boolean;
    tier1Active: boolean;
    projectMint: PublicKey;
  }> {
    const c = await this.program.account.gameConfig.fetch(this.config);
    return {
      headsHead: BigInt(c.headsHead.toString()),
      headsNext: BigInt(c.headsNext.toString()),
      tailsHead: BigInt(c.tailsHead.toString()),
      tailsNext: BigInt(c.tailsNext.toString()),
      totalMatches: this.generation === "hts"
        ? BigInt((await this.program.account.gameConfig.fetch(configPda(this.program.programId)[0])).totalMatches.toString())
        : BigInt(c.totalMatches.toString()),
      paused: c.paused as boolean,
      tier1Active: c.tier1Active as boolean,
      projectMint: c.projectMint as PublicKey,
    };
  }

  /** V2: fetch a tier-scoped room (throws when the room is uninitialized). */
  async fetchRoom(tierUsd: number): Promise<{
    tierUsd: number;
    active: boolean;
    headsHead: bigint;
    headsNext: bigint;
    tailsHead: bigint;
    tailsNext: bigint;
  }> {
    const { roomPda } = await import("./pdas.js");
    const [room] = roomPda(this.program.programId, tierUsd, this.generation);
    const r = await (this.program.account as unknown as Record<string, { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> }>).roomState.fetch(room);
    const big = (v: unknown): bigint => BigInt((v as { toString(): string }).toString());
    return {
      tierUsd: r.tierUsd as number,
      active: r.active as boolean,
      headsHead: big(r.headsHead),
      headsNext: big(r.headsNext),
      tailsHead: big(r.tailsHead),
      tailsNext: big(r.tailsNext),
    };
  }

  joinQueueIx(
    player: PublicKey,
    side: number,
    tierUsd: number,
    stakeAmount: bigint,
    sequence: bigint
  ): {
    accounts: Record<string, PublicKey>;
    entry: PublicKey;
    playerState: PublicKey;
  } {
    this.requireLegacy();
    const [playerState] = playerPda(this.program.programId, player, this.generation);
    const [entry] = queuePda(this.program.programId, side, sequence);
    const [vault] = vaultPda(this.program.programId, this.generation);
    const [vaultAuthority] = vaultAuthorityPda(this.program.programId, this.generation);
    return {
      accounts: {
        player,
        config: this.config,
        playerState,
        entry,
        vault,
        vaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      entry,
      playerState,
    };
  }

  async joinQueueTx(
    player: PublicKey,
    playerTokens: PublicKey,
    projectMint: PublicKey,
    side: number,
    tierUsd: number,
    stakeAmount: bigint,
    sequence: bigint
  ): Promise<{ tx: Transaction | VersionedTransaction; entry: PublicKey }> {
    const { accounts, entry } = this.joinQueueIx(
      player,
      side,
      tierUsd,
      stakeAmount,
      sequence
    );
    const tx = await this.program.methods
      .joinQueue(side, tierUsd, new BN(stakeAmount.toString()), new BN(sequence.toString()))
      .accounts({
        player,
        playerState: accounts.playerState,
        entry: accounts.entry,
        projectMint,
        playerTokens,
      })
      .transaction();
    return { tx, entry };
  }

  async joinQueue(
    player: Keypair,
    playerTokens: PublicKey,
    projectMint: PublicKey,
    side: number,
    tierUsd: number,
    stakeAmount: bigint,
    sequence: bigint
  ): Promise<{ signature: string; entry: PublicKey }> {
    const { accounts, entry } = this.joinQueueIx(
      player.publicKey,
      side,
      tierUsd,
      stakeAmount,
      sequence
    );
    const sig = await this.program.methods
      .joinQueue(side, tierUsd, new BN(stakeAmount.toString()), new BN(sequence.toString()))
      .accounts({
        player: player.publicKey,
        playerState: accounts.playerState,
        entry: accounts.entry,
        projectMint,
        playerTokens,
      })
      .signers([player])
      .rpc();
    return { signature: sig as string, entry };
  }

  async matchNextTx(
    caller: PublicKey,
    matchId: bigint,
    headsEntry: PublicKey,
    tailsEntry: PublicKey,
    headsState: PublicKey,
    tailsState: PublicKey,
    vrfTreasury: PublicKey,
    nonce: Uint8Array = createMatchNonce()
  ): Promise<{ tx: Transaction | VersionedTransaction; gameMatch: PublicKey }> {
    this.requireLegacy();
    const [gameMatch] = matchPda(this.program.programId, matchId, this.generation);
    const [networkState] = oraoNetworkStatePda();
    const [randomness] = oraoRandomnessPda(await deriveMatchSeed(this.program.programId, matchId, nonce));
    const tx = await this.program.methods
      .matchNext(new BN(matchId.toString()), Array.from(nonce))
      .accounts({
        caller,
        headHeads: headsEntry,
        headTails: tailsEntry,
        headsState,
        tailsState,
        gameMatch,
        vrfProgram: ORAO_VRF_PROGRAM_ID,
        vrfNetworkState: networkState,
        vrfTreasury,
        randomness,
      })
      .transaction();
    return { tx, gameMatch };
  }

  async matchNext(
    caller: Keypair,
    matchId: bigint,
    headsEntry: PublicKey,
    tailsEntry: PublicKey,
    headsState: PublicKey,
    tailsState: PublicKey,
    vrfTreasury: PublicKey,
    nonce: Uint8Array = createMatchNonce()
  ): Promise<string> {
    this.requireLegacy();
    const [gameMatch] = matchPda(this.program.programId, matchId, this.generation);
    const [networkState] = oraoNetworkStatePda();
    const [randomness] = oraoRandomnessPda(await deriveMatchSeed(this.program.programId, matchId, nonce));
    const sig = await this.program.methods
      .matchNext(new BN(matchId.toString()), Array.from(nonce))
      .accounts({
        caller: caller.publicKey,
        headHeads: headsEntry,
        headTails: tailsEntry,
        headsState,
        tailsState,
        gameMatch,
        vrfProgram: ORAO_VRF_PROGRAM_ID,
        vrfNetworkState: networkState,
        vrfTreasury,
        randomness,
      })
      .signers([caller])
      .rpc();
    return sig as string;
  }

  /** V2: tier-scoped join (independent $1/$10 queues, global one-active rule). */
  async joinQueueRoomTx(
    player: PublicKey,
    playerTokens: PublicKey,
    projectMint: PublicKey,
    side: number,
    tierUsd: number,
    stakeAmount: bigint,
    sequence: bigint
  ): Promise<{ tx: Transaction | VersionedTransaction; entry: PublicKey; room: PublicKey }> {
    const [playerState] = playerPda(this.program.programId, player, this.generation);
    if (this.generation === "hts") assertHtsRoomStake(tierUsd, stakeAmount);
    const [room] = roomPda(this.program.programId, tierUsd, this.generation);
    const [entry] = roomQueuePda(this.program.programId, tierUsd, side, sequence, this.generation);
    const tx = await (this.program.methods as unknown as Record<string, (...a: unknown[]) => { accounts: (o: unknown) => { transaction: () => Promise<Transaction> } }>)[this.generation === "hts" ? "joinHtsQueueRoom" : "joinQueueRoom"](
      side,
      tierUsd,
      new BN(stakeAmount.toString()),
      new BN(sequence.toString())
    )
      .accounts({ player, config: this.config, room, playerState, entry, projectMint, playerTokens,
        ...(this.generation === "hts" ? { legacyConfig: configPda(this.program.programId)[0], legacyPlayerState: playerPda(this.program.programId, player)[0] } : {}) })
      .transaction();
    return { tx, entry, room };
  }

  /** V2: tier-scoped permissionless match. */
  async matchNextRoomTx(
    caller: PublicKey,
    matchId: bigint,
    tierUsd: number,
    headsEntry: PublicKey,
    tailsEntry: PublicKey,
    headsState: PublicKey,
    tailsState: PublicKey,
    vrfTreasury: PublicKey,
    nonce: Uint8Array = createMatchNonce()
  ): Promise<{ tx: Transaction | VersionedTransaction; gameMatch: PublicKey }> {
    const [gameMatch] = matchPda(this.program.programId, matchId, this.generation);
    const [networkState] = oraoNetworkStatePda();
    const [randomness] = oraoRandomnessPda(await deriveMatchSeed(this.program.programId, matchId, nonce));
    const [room] = roomPda(this.program.programId, tierUsd, this.generation);
    const tx = await (this.program.methods as unknown as Record<string, (...a: unknown[]) => { accounts: (o: unknown) => { transaction: () => Promise<Transaction> } }>)[this.generation === "hts" ? "matchNextHtsRoom" : "matchNextRoom"](
      new BN(matchId.toString()),
      tierUsd,
      Array.from(nonce)
    )
      .accounts({
        caller,
        config: this.config,
        ...(this.generation === "hts" ? { legacyConfig: configPda(this.program.programId)[0] } : {}),
        room,
        headHeads: headsEntry,
        headTails: tailsEntry,
        headsState,
        tailsState,
        gameMatch,
        vrfProgram: ORAO_VRF_PROGRAM_ID,
        vrfNetworkState: networkState,
        vrfTreasury,
        randomness,
      })
      .transaction();
    return { tx, gameMatch };
  }

  async cancelQueueEntryRoomTx(player: PublicKey, playerTokens: PublicKey, projectMint: PublicKey): Promise<{tx: Transaction; entry: PublicKey}> {
    const [playerState] = playerPda(this.program.programId, player, this.generation);
    const state = await fetchPlayerStateCompat(this.program.provider.connection, playerState);
    if (!state?.queued) throw new Error("No active room entry to cancel");
    const [entry] = roomQueuePda(this.program.programId, state.queuedTierUsd, state.queuedSide, state.queuedSequence, this.generation);
    const tx = await this.program.methods[this.generation === "hts" ? "cancelHtsQueueEntryRoom" : "cancelQueueEntryRoom"]()
      .accountsPartial({player, config: this.config, playerState, entry, projectMint, playerTokens}).transaction();
    return {tx, entry};
  }

  async advanceHeadRoomTx(side: number, tierUsd: number, headEntry: PublicKey): Promise<Transaction> {
    return this.program.methods[this.generation === "hts" ? "advanceHtsHeadRoom" : "advanceHeadRoom"](side, tierUsd)
      .accountsPartial({room: roomPda(this.program.programId, tierUsd, this.generation)[0], headEntry}).transaction();
  }

  async cancelQueueEntryTx(
    player: PublicKey,
    playerTokens: PublicKey,
    projectMint: PublicKey
  ): Promise<{ tx: Transaction | VersionedTransaction; entry: PublicKey }> {
    this.requireLegacy();
    const [playerState] = playerPda(this.program.programId, player, this.generation);
    // Compat read: cancel targets the V1 global pool and must also resolve
    // legacy (pre-V2) accounts that the V2 IDL coder cannot decode.
    const state = await fetchPlayerStateCompat(
      this.program.provider.connection,
      playerState
    );
    if (!state || !state.queued) throw new Error("No active queue entry to cancel");
    const side = state.queuedSide;
    const sequence = state.queuedSequence;
    const [entry] = queuePda(this.program.programId, side, sequence);
    const tx = await this.program.methods
      .cancelQueueEntry()
      .accounts({ player, entry, projectMint, playerTokens })
      .transaction();
    return { tx, entry };
  }

  async cancelQueueEntry(
    player: Keypair,
    playerTokens: PublicKey,
    projectMint: PublicKey
  ): Promise<string> {
    this.requireLegacy();
    const [playerState] = playerPda(this.program.programId, player.publicKey, this.generation);
    const state = await fetchPlayerStateCompat(
      this.program.provider.connection,
      playerState
    );
    if (!state || !state.queued) throw new Error("No active queue entry to cancel");
    const side = state.queuedSide;
    const sequence = state.queuedSequence;
    const [entry] = queuePda(this.program.programId, side, sequence);
    const sig = await this.program.methods
      .cancelQueueEntry()
      .accounts({
        player: player.publicKey,
        entry,
        projectMint,
        playerTokens,
      })
      .signers([player])
      .rpc();
    return sig as string;
  }

  async advanceHead(side: number, headEntry: PublicKey): Promise<string> {
    this.requireLegacy();
    const sig = await this.program.methods
      .advanceHead(side)
      .accounts({ headEntry })
      .rpc();
    return sig as string;
  }

  async settleMatchTx(
    caller: PublicKey,
    matchId: bigint,
    randomness: PublicKey,
    headsState: PublicKey,
    tailsState: PublicKey,
    projectMint: PublicKey,
    winnerTokens: PublicKey,
    preInstructions: TransactionInstruction[] = []
  ): Promise<Transaction | VersionedTransaction> {
    return this.program.methods
      [this.generation === "hts" ? "settleHtsMatch" : "settleMatch"](new BN(matchId.toString()))
      .accountsPartial({
        caller,
        randomness,
        headsState,
        tailsState,
        projectMint,
        winnerTokens,
        config: this.config,
      })
      .preInstructions(preInstructions)
      .transaction();
  }

  async settleMatch(
    caller: Keypair,
    matchId: bigint,
    randomness: PublicKey,
    headsState: PublicKey,
    tailsState: PublicKey,
    projectMint: PublicKey,
    winnerTokens: PublicKey,
    preInstructions: TransactionInstruction[] = []
  ): Promise<string> {
    const sig = await this.program.methods
      [this.generation === "hts" ? "settleHtsMatch" : "settleMatch"](new BN(matchId.toString()))
      .accountsPartial({
        caller: caller.publicKey,
        randomness,
        headsState,
        tailsState,
        projectMint,
        winnerTokens,
        config: this.config,
      })
      .preInstructions(preInstructions)
      .signers([caller])
      .rpc();
    return sig as string;
  }
}

export { HEADS, ORAO_VRF_PROGRAM_ID };
export type { HeadsOrTails };
export { BN };
