import { test } from "node:test";
import assert from "node:assert/strict";
import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { GameClient, PROGRAM_ID, configPda, playerPda, roomPda, roomQueuePda, matchPda, vaultPda, vaultAuthorityPda, loadProgram } from "../src/index.js";

const player = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const provider = new AnchorProvider(new Connection("http://127.0.0.1:8899"), {publicKey: player} as never, {});
const program = loadProgram(provider);
const client = new GameClient(program, configPda(PROGRAM_ID,"hts")[0], "hts");
test("every HTS PDA namespace is disjoint from legacy and other tiers/sides", () => {
  const pairs = [configPda(PROGRAM_ID),playerPda(PROGRAM_ID,player),roomPda(PROGRAM_ID,1),roomQueuePda(PROGRAM_ID,1,0,0n),matchPda(PROGRAM_ID,60n),vaultPda(PROGRAM_ID),vaultAuthorityPda(PROGRAM_ID)];
  const hts = [configPda(PROGRAM_ID,"hts"),playerPda(PROGRAM_ID,player,"hts"),roomPda(PROGRAM_ID,1,"hts"),roomQueuePda(PROGRAM_ID,1,0,0n,"hts"),matchPda(PROGRAM_ID,60n,"hts"),vaultPda(PROGRAM_ID,"hts"),vaultAuthorityPda(PROGRAM_ID,"hts")];
  const all=[...pairs,...hts].map(p=>p[0].toBase58());
  assert.equal(new Set(all).size,all.length);
  assert.notEqual(roomQueuePda(PROGRAM_ID,1,0,0n,"hts")[0].toBase58(),roomQueuePda(PROGRAM_ID,10,0,0n,"hts")[0].toBase58());
});
test("HTS join contains exact generation, legacy guard and isolated vault", async () => {
  const {tx} = await client.joinQueueRoomTx(player, Keypair.generate().publicKey,mint,0,1,100_000_000n,0n);
  assert.ok("instructions" in tx);
  const ix=tx.instructions[0];
  const decoded=program.coder.instruction.decode(ix.data);
  assert.equal(decoded?.name,"joinHtsQueueRoom");
  const keys=ix.keys.map(k=>k.pubkey.toBase58());
  for(const key of [configPda(PROGRAM_ID,"hts")[0], configPda(PROGRAM_ID)[0], playerPda(PROGRAM_ID,player)[0],vaultPda(PROGRAM_ID,"hts")[0],TOKEN_PROGRAM_ID]) assert.ok(keys.includes(key.toBase58()));
  const legacyPlayer = ix.keys.find(k=>k.pubkey.equals(playerPda(PROGRAM_ID,player)[0]));
  assert.equal(legacyPlayer?.isWritable,false);
});
test("HTS matcher retains full nonce and writes canonical global counter", async () => {
  const random = () => Keypair.generate().publicKey;
  const {tx,gameMatch}=await client.matchNextRoomTx(player,60n,10,random(),random(),random(),random(),random(),new Uint8Array(32).fill(9));
  assert.ok("instructions" in tx);
  const ix=tx.instructions[0];
  assert.equal(program.coder.instruction.decode(ix.data)?.name,"matchNextHtsRoom");
  assert.equal(ix.data.length,49);
  assert.ok(gameMatch.equals(matchPda(PROGRAM_ID,60n,"hts")[0]));
  assert.equal(ix.keys.find(k=>k.pubkey.equals(configPda(PROGRAM_ID)[0]))?.isWritable,true);
});
test("HTS client rejects legacy-only entry points and mismatched config", async () => {
  assert.throws(()=>new GameClient(program,configPda(PROGRAM_ID)[0],"hts"), /generation/);
  assert.throws(()=>client.joinQueueIx(player,0,1,1_000_000n,0n),/legacy/);
  await assert.rejects(()=>client.matchNextTx(player,0n,player,player,player,player,player),/legacy/);
});
