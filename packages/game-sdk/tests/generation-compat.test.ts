import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PROGRAM_ID, loadProgram, configPda, playerPda, matchPda, queuePda, roomQueuePda, resolveGameMatch, inspectLegacyPosition, buildLegacyRefund } from '../src/index.js';

const oldMint = new PublicKey('BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh');
function fixture(){
 const player=Keypair.generate().publicKey, connection=new Connection('http://127.0.0.1:1');
 const accounts=new Map<string, Buffer>();
 const info=(key:PublicKey)=>accounts.has(key.toBase58())?{owner:PROGRAM_ID,data:accounts.get(key.toBase58())!,lamports:1,executable:false,rentEpoch:0}:null;
 connection.getAccountInfo=async key=>info(key);
 connection.getAccountInfoAndContext=async key=>({context:{slot:1},value:info(key)});
 connection.getMultipleAccountsInfo=async keys=>keys.map(info);
 const program=loadProgram(new AnchorProvider(connection,{publicKey:player} as never,{}));
 return {player,connection,accounts,program};
}
async function config(f:ReturnType<typeof fixture>,generation:'legacy'|'hts',mint=oldMint){
 const bytes=await f.program.coder.accounts.encode('gameConfig',{authority:f.player,projectMint:mint,paused:true,tier1Active:false,headsHead:new BN(0),headsNext:new BN(0),tailsHead:new BN(0),tailsNext:new BN(0),totalMatches:new BN(61),vaultBump:1,authorityBump:1,configBump:1});
 f.accounts.set(configPda(PROGRAM_ID,generation)[0].toBase58(),bytes);
}
async function match(f:ReturnType<typeof fixture>,generation:'legacy'|'hts',id=60n){
 const bytes=await f.program.coder.accounts.encode('match',{id:new BN(id.toString()),headsPlayer:f.player,tailsPlayer:Keypair.generate().publicKey,headsAmount:new BN(1_000_000),tailsAmount:new BN(1_000_000),totalPot:new BN(2_000_000),tierUsd:1,createdSlot:new BN(4),state:{waitingForRandomness:{}},seed:Array(32).fill(5),result:null,winner:null,settledSlot:null,bump:1});
 f.accounts.set(matchPda(PROGRAM_ID,60n,generation)[0].toBase58(),bytes);
}
test('history resolves original and HTS mints independently of active environment',async()=>{
 for(const generation of ['legacy','hts'] as const){const f=fixture(),mint=generation==='legacy'?oldMint:Keypair.generate().publicKey;await config(f,generation,mint);await match(f,generation);const resolved=await resolveGameMatch(f.program,60n);assert.equal(resolved?.generation,generation);assert.ok(resolved?.config.projectMint.equals(mint));}
});
test('history refuses ambiguous IDs, foreign owners and mismatched stored IDs',async()=>{
 const f=fixture();assert.equal(await resolveGameMatch(f.program,60n),null);await match(f,'legacy');await match(f,'hts');await assert.rejects(resolveGameMatch(f.program,60n),/Ambiguous/);
 f.accounts.delete(matchPda(PROGRAM_ID,60n,'hts')[0].toBase58());f.connection.getMultipleAccountsInfo=async()=>[{owner:SystemProgram.programId} as never,null];assert.equal(await resolveGameMatch(f.program,60n),null);
 const g=fixture();await match(g,'legacy',61n);await assert.rejects(resolveGameMatch(g.program,60n),/ID mismatch/);
});

test('generation selection accepts only decoded program-owned match records',async()=>{
 for(const generation of ['legacy','hts'] as const){
  const f=fixture();await config(f,generation);await match(f,generation);
  const read=f.connection.getMultipleAccountsInfo;
  f.connection.getMultipleAccountsInfo=async keys=>(await read(keys)).map(info=>info??{owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:1,executable:false,rentEpoch:0});
  assert.equal((await resolveGameMatch(f.program,60n))?.generation,generation);
  f.connection.getMultipleAccountsInfo=async()=>[{owner:PROGRAM_ID,data:Buffer.alloc(8)} as never,null];
  await assert.rejects(resolveGameMatch(f.program,60n));
 }
});
function state(f:ReturnType<typeof fixture>,length:number){const data=Buffer.alloc(length);Buffer.from('38033c56ae10f4c3','hex').copy(data);f.player.toBuffer().copy(data,8);data[40]=1;data[41]=1;data.writeBigUInt64LE(19n,42);if(length===62)data[60]=1;f.accounts.set(playerPda(PROGRAM_ID,f.player)[0].toBase58(),data);return data;}
async function entry(f:ReturnType<typeof fixture>,room:boolean,amount=1_234_567n){const data=await f.program.coder.accounts.encode(room?'roomQueueEntry':'queueEntry',{player:f.player,side:1,sequence:new BN(19),amount:new BN(amount.toString()),joinedSlot:new BN(4),status:{active:{}},bump:1,...(room?{tierUsd:1}:{})});const key=room?roomQueuePda(PROGRAM_ID,1,1,19n)[0]:queuePda(PROGRAM_ID,1,19n)[0];f.accounts.set(key.toBase58(),data);return key;}
test('both historical layouts produce exact original-token owner refund, inspection never writes',async()=>{
 for(const length of [60,62]){const f=fixture();await config(f,'legacy');const bytes=state(f,length),before=Buffer.from(bytes);const target=await entry(f,false);f.accounts.set(getAssociatedTokenAddressSync(oldMint,f.player).toBase58(),Buffer.alloc(165));assert.ok(await inspectLegacyPosition(f.program,f.player));const built=await buildLegacyRefund(f.program,f.player);assert.deepEqual(bytes,before);assert.equal(built.amount,1_234_567n);assert.ok(built.mint.equals(oldMint));assert.ok(built.entry.equals(target));const names=built.tx.instructions.map(ix=>f.program.coder.instruction.decode(ix.data)?.name);assert.deepEqual(names,length===60?['migratePlayerState','cancelQueueEntry']:['cancelQueueEntry']);assert.equal(built.tx.signature,null);}
});
test('historical room refunds select exact room entry and refuse ambiguous entries or changed mint',async()=>{
 const f=fixture();await config(f,'legacy');state(f,62);await entry(f,true);let built=await buildLegacyRefund(f.program,f.player);assert.equal(f.program.coder.instruction.decode(built.tx.instructions.at(-1)!.data)?.name,'cancelQueueEntryRoom');await entry(f,false);await assert.rejects(buildLegacyRefund(f.program,f.player),/ambiguous/);await config(f,'legacy',Keypair.generate().publicKey);await assert.rejects(buildLegacyRefund(f.program,f.player),/mint mismatch/);
});
test('matched historical position is never offered a queue refund',async()=>{const f=fixture();const data=state(f,62);data[40]=0;data[50]=1;await assert.rejects(buildLegacyRefund(f.program,f.player),/not refundable/);});

test('historical refund selects a valid entry independently of unrelated account owners',async()=>{
 for(const room of [false,true]){
  const f=fixture();await config(f,'legacy');state(f,62);const expected=await entry(f,room);
  const read=f.connection.getMultipleAccountsInfo;
  f.connection.getMultipleAccountsInfo=async keys=>(await read(keys)).map(info=>info??{owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:1,executable:false,rentEpoch:0});
  const refund=await buildLegacyRefund(f.program,f.player);
  assert.ok(refund.entry.equals(expected));assert.equal(refund.amount,1_234_567n);assert.ok(refund.mint.equals(oldMint));assert.equal(refund.tx.signature,null);
 }
});
