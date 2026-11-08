import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isActiveRoomEntryData, isActiveEntryData, fetchRoomQueueSnapshot, fetchUserRoomQueuePosition } from './queueSnapshot';
import { PublicKey } from '@solana/web3.js';
const program = new PublicKey('AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k');
function roomEntry(status:number) { const data=Buffer.alloc(68); data[66]=status; return data; }
test('room entries use status after tier and joined slot, cancelled entries never count',()=>{
 for(const status of [0,1,2]) assert.equal(isActiveRoomEntryData(roomEntry(status)),status===0);
 assert.equal(isActiveRoomEntryData(Buffer.alloc(67)),false);
 const legacy=Buffer.alloc(67);legacy[65]=1;assert.equal(isActiveEntryData(legacy),false);
});
test('cancelled room entries disappear from counts and positions',async()=>{
 const connection={getMultipleAccountsInfo:async()=>[1,2,0].map(status=>({data:roomEntry(status)}))} as never;
 const snapshot=await fetchRoomQueueSnapshot(connection,program,1,{headsHead:BigInt(0),headsNext:BigInt(3),tailsHead:BigInt(0),tailsNext:BigInt(0)});
 assert.equal(snapshot.headsActive,1);
 const position=await fetchUserRoomQueuePosition(connection,program,1,0,BigInt(2),BigInt(0));
 assert.deepEqual(position,{position:1});
});