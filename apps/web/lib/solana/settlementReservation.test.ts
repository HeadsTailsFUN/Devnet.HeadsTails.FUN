import {test} from "node:test";
import assert from "node:assert/strict";
import {Keypair,PublicKey,Transaction,TransactionInstruction,type Connection} from "@solana/web3.js";
import type {SupabaseClient} from "@supabase/supabase-js";
import {gameIdlJson} from "@heads-or-tails/game-sdk";
import {sendJournaledTransaction,ExpenseBudgetError} from "./expenseJournal";
import {DEVNET_GENESIS,DEVNET_PROGRAM_ID} from "./devnetSafety";
import {settlementScanHighWater} from "../settlement/jobPolicy";
const mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4';
Object.assign(process.env,{NEXT_PUBLIC_SOLANA_CLUSTER:'devnet',NEXT_PUBLIC_HTS_TOKEN_MINT:mint,NEXT_PUBLIC_PROJECT_TOKEN_MINT:mint,NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED:'false',DEVNET_SOL_SPONSOR_ENABLED:'true',DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS:'500000000'});
function harness(extraDebit=5000){const signer=Keypair.fromSeed(new Uint8Array(32).fill(3)),calls:{method:string;args:any}[]=[],config=Buffer.alloc(117);Buffer.from(gameIdlJson.accounts.find(a=>a.name==='GameConfig')!.discriminator).copy(config);new PublicKey(mint).toBuffer().copy(config,40);let sent=false,signature:string|null=null;
 const connection={async getGenesisHash(){return DEVNET_GENESIS;},async getAccountInfo(){return {owner:new PublicKey(DEVNET_PROGRAM_ID),data:config};},async getLatestBlockhash(){return {blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:100};},async getFeeForMessage(){return {value:5000};},async getBalance(){return 9000000000;},async simulateTransaction(){return {value:{err:null,accounts:[{lamports:9000000000-extraDebit}]}};},async getTransaction(){return sent?{meta:{err:null,fee:5000,preBalances:[9000000000],postBalances:[9000000000-extraDebit]},blockTime:1793748000}:null;},async getBlockHeight(){return 50;},async sendRawTransaction(){sent=true;return signature;},async confirmTransaction(){return {value:{err:null}};}} as unknown as Connection;
 const db={async rpc(method:string,args:any){calls.push({method,args});if(method==='reserve_devnet_expense')return {data:66000000+args.p_lamports>100000000?{status:'wallet-cap'}:{status:'reserved',expense:{id:'test-only',operation_key:args.p_operation_key,wallet:signer.publicKey.toBase58(),kind:args.p_kind,status:'reserved',claim_token:'test-fence',signature:null}},error:null};if(method==='submit_devnet_expense')signature=args.p_signature;return {data:true,error:null};}} as unknown as SupabaseClient;
 const transaction=()=>new Transaction().add(new TransactionInstruction({programId:new PublicKey(DEVNET_PROGRAM_ID),keys:[],data:Buffer.from([0])}));return {connection,db,signer,calls,transaction,sent:()=>sent};}
test('5000-lamport settlement fits remaining 34m budget instead of a false 50m hold',async()=>{const h=harness();const r=await sendJournaledTransaction({...h,transaction:h.transaction(),operationKey:'settle:75',wallet:h.signer.publicKey.toBase58(),kind:'settle',settlementRentLamports:0});assert(r.signature);assert.equal(h.calls.find(c=>c.method==='reserve_devnet_expense')!.args.p_lamports,5000);assert(h.sent());assert.equal(h.calls.filter(c=>c.method==='submit_devnet_expense').length,1);});
test('missing winner ATA reserves measured rent plus the fee',async()=>{const rent=2039280,h=harness(rent+5000);await sendJournaledTransaction({...h,transaction:h.transaction(),operationKey:'settle:76',wallet:h.signer.publicKey.toBase58(),kind:'settle',settlementRentLamports:rent});assert.equal(h.calls.find(c=>c.method==='reserve_devnet_expense')!.args.p_lamports,rent+5000);});
test('unexpected simulation debit is rejected before submission and releases only unsigned hold',async()=>{const h=harness(1000000);await assert.rejects(sendJournaledTransaction({...h,transaction:h.transaction(),operationKey:'settle:77',wallet:h.signer.publicKey.toBase58(),kind:'settle',settlementRentLamports:0}),/preflight or cost/);assert(!h.sent());assert(h.calls.some(c=>c.method==='cancel_unsubmitted_devnet_expense'));assert(!h.calls.some(c=>c.method==='submit_devnet_expense'));});
test('a match can use its simulated cost when the larger hold is rejected', async () => {
  const actualDebit = 6_380_680;
  const h = harness(actualDebit);
  await sendJournaledTransaction({...h, transaction: h.transaction(), operationKey: 'match:85', wallet: h.signer.publicKey.toBase58(), kind: 'match'});
  const reservations = h.calls.filter(call => call.method === 'reserve_devnet_expense');
  assert.deepEqual(reservations.map(call => call.args.p_lamports), [50_000_000, actualDebit]);
  assert(reservations.every(call => call.args.p_operation_key === 'match:85'));
  assert.equal(h.calls.filter(call => call.method === 'submit_devnet_expense').length, 1);
  assert(h.sent());
});
test('match remains queued when even the measured debit exceeds the remaining budget', async () => {
  const h = harness(40_000_000);
  await assert.rejects(sendJournaledTransaction({...h, transaction: h.transaction(), operationKey: 'match:85', wallet: h.signer.publicKey.toBase58(), kind: 'match'}), ExpenseBudgetError);
  assert(!h.sent());
  assert(!h.calls.some(call => call.method === 'submit_devnet_expense'));
});
test('HTS counter is not hidden by the frozen legacy namespace',()=>{assert.equal(settlementScanHighWater([{totalMatches:44},{totalMatches:76}]),BigInt(76));assert.equal(settlementScanHighWater([null,{totalMatches:76}]),BigInt(76));assert.equal(settlementScanHighWater([null,null]),BigInt(0));});

test('inactive-head advancement reserves only its fee and still rejects extra debit', async () => {
  const h = harness();
  await sendJournaledTransaction({...h, transaction:h.transaction(), operationKey:'advance:test', wallet:h.signer.publicKey.toBase58(), kind:'advance'});
  assert.equal(h.calls.find(call=>call.method==='reserve_devnet_expense')!.args.p_lamports,5000);
  const expensive = harness(1000000);
  await assert.rejects(sendJournaledTransaction({...expensive, transaction:expensive.transaction(), operationKey:'advance:bad', wallet:expensive.signer.publicKey.toBase58(), kind:'advance'}), /preflight or cost/);
  assert(!expensive.sent());
});


test('daily quotas are absent while per-operation reservations remain bounded', async () => {
  const h = harness();
  await sendJournaledTransaction({ ...h, transaction: h.transaction(), operationKey: 'advance:uncapped',
    wallet: h.signer.publicKey.toBase58(), kind: 'advance' });
  const reservation = h.calls.find(call => call.method === 'reserve_devnet_expense')!.args;
  assert.equal(reservation.p_wallet_cap, null);
  assert.equal(reservation.p_global_cap, null);
  assert.equal(reservation.p_drain_reserve, 0);
  assert.equal(reservation.p_lamports, 5000);
});
