import type { Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import type { HeadsOrTails } from "./idl-types.js";
import { configPda, playerPda, queuePda, roomQueuePda } from "./pdas.js";
import { decodePlayerStateCompat } from "./playerStateCompat.js";

export async function inspectLegacyPosition(program: Program<HeadsOrTails>, player: PublicKey) {
  const stateAddress = playerPda(program.programId, player)[0];
  const info = await program.provider.connection.getAccountInfo(stateAddress, "confirmed");
  if (!info) return null;
  if (!info.owner.equals(program.programId)) throw new Error("Invalid historical state owner");
  const state = decodePlayerStateCompat(info.data);
  if (!state.player.equals(player)) throw new Error("Historical state wallet mismatch");
  return state.queued || state.inMatch ? {state, stateAddress} : null;
}

/** A wallet-signed exit only. No historical position is changed by inspection.
 * The caller displays and signs this transaction after an explicit user click. */
export async function buildLegacyRefund(program: Program<HeadsOrTails>, player: PublicKey) {
  const position = await inspectLegacyPosition(program, player);
  if (!position?.state.queued || position.state.inMatch) throw new Error("Historical position is not refundable");
  const {state, stateAddress} = position;
  const config = configPda(program.programId)[0];
  const cfg = await program.account.gameConfig.fetch(config);
  const mint = cfg.projectMint;
  if (mint.toBase58() !== "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh") throw new Error("Historical mint mismatch");
  const global = queuePda(program.programId,state.queuedSide,state.queuedSequence)[0];
  const room = roomQueuePda(program.programId,state.queuedTierUsd,state.queuedSide,state.queuedSequence)[0];
  const infos = await program.provider.connection.getMultipleAccountsInfo([global, room], "confirmed");
  const candidates: Array<{address: PublicKey; room: boolean; amount: bigint}> = [];
  for (const [index, info] of infos.entries()) {
    // Only program-owned entries participate in historical selection.
    if (!info || !info.owner.equals(program.programId)) continue;
    const e = program.coder.accounts.decode(index === 0 ? "queueEntry" : "roomQueueEntry",info.data);
    if (e.player.equals(player) && e.side === state.queuedSide && e.sequence.toString() === state.queuedSequence.toString()
      && Object.keys(e.status)[0] === "active" && (index === 0 || e.tierUsd === state.queuedTierUsd)) {
      candidates.push({address: index===0?global:room, room:index===1, amount:BigInt(e.amount.toString())});
    }
  }
  if (candidates.length !== 1) throw new Error("Historical entry is missing or ambiguous");
  const target = candidates[0];
  const ata = getAssociatedTokenAddressSync(mint,player);
  const tx = new Transaction();
  if (!await program.provider.connection.getAccountInfo(ata,"confirmed")) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(player,ata,player,mint));
  }
  if (state.schema === "v1") {
    tx.add(await program.methods.migratePlayerState().accountsPartial({payer:player,playerOwner:player,playerState:stateAddress}).instruction());
  }
  tx.add(await program.methods[target.room?"cancelQueueEntryRoom":"cancelQueueEntry"]()
    .accountsPartial({player,config,playerState:stateAddress,entry:target.address,projectMint:mint,playerTokens:ata}).instruction());
  return {tx, mint, amount:target.amount, entry:target.address};
}
