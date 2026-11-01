import { test } from 'node:test';import assert from 'node:assert/strict';
import {DISCRIMINATORS,GAME_PROGRAM_ID,verifySponsorTransaction,derivePlayerStatePda,deriveRoomQueueEntryPda} from './sponsorVerify';
const wallet='DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy';
function data(tier:number,side:number){const b=Buffer.alloc(26);Buffer.from(DISCRIMINATORS.join_hts_queue_room,'hex').copy(b);b[8]=side;b[9]=tier;b.writeBigUInt64LE(BigInt(tier)*BigInt(1000000),10);b.writeBigUInt64LE(BigInt(19),18);return b;}
for(const tier of [1,10])test('HTS '+tier+' reimbursement uses only HTS rent PDAs and rejects legacy substitution',()=>{
 const ps=derivePlayerStatePda(GAME_PROGRAM_ID,wallet,'hts'),entry=deriveRoomQueueEntryPda(GAME_PROGRAM_ID,tier,1,BigInt(19),'hts');
 const input={action:'join' as const,expectedWallet:wallet,txWallet:wallet,topLevel:[{programId:GAME_PROGRAM_ID,data:data(tier,1),accounts:[wallet]}],accountKeys:[wallet,ps,entry,GAME_PROGRAM_ID],preBalances:[100_000_000,0,0,0],postBalances:[97_995_000,1_000_000,1_000_000,0],feeLamports:5000};
 const accepted=verifySponsorTransaction(input);assert.equal(accepted.ok,true);assert.equal(accepted.eligibleLamports,2_005_000);
 for(const replaced of [1,2]){const keys=[...input.accountKeys];keys[replaced]=replaced===1?derivePlayerStatePda(GAME_PROGRAM_ID,wallet):deriveRoomQueueEntryPda(GAME_PROGRAM_ID,tier,1,BigInt(19));assert.equal(verifySponsorTransaction({...input,accountKeys:keys}).ok,false);}
});
test('HTS leave is fee-only and never reimburses escrow token amounts',()=>{const ps=derivePlayerStatePda(GAME_PROGRAM_ID,wallet,'hts');const result=verifySponsorTransaction({action:'cancel',expectedWallet:wallet,txWallet:wallet,topLevel:[{programId:GAME_PROGRAM_ID,data:Buffer.from(DISCRIMINATORS.cancel_hts_queue_entry_room,'hex'),accounts:[wallet]}],accountKeys:[wallet,ps,GAME_PROGRAM_ID],preBalances:[10000000,1,0],postBalances:[9995000,1,0],feeLamports:5000});assert.equal(result.ok,true);assert.equal(result.eligibleLamports,5000);});
