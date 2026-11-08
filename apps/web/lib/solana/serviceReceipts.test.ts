import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import type {Connection} from '@solana/web3.js';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reconcileServiceReceipts} from './expenseJournal';
test('reconcile landed service receipts and keep missing transaction holds',async()=>{
 const finished:unknown[]=[];
 const query:any={select(){return this},eq(){return this},in(){return this},order(){return this},async limit(){return {data:[{signature:'landed',id:'one'},{signature:'missing',id:'two'}],error:null}}};
 const db={from(){return query},async rpc(name:string,args:unknown){assert.equal(name,'finish_devnet_expense');finished.push(args);return {data:true,error:null}}} as unknown as SupabaseClient;
 const connection={async getTransaction(signature:string){return signature==='missing'?null:{meta:{err:null,fee:5000,preBalances:[100000000],postBalances:[93619320]},blockTime:1794087336}}} as unknown as Connection;
 await reconcileServiceReceipts(connection,db,'service');
 assert.equal(finished.length,1);
 assert.equal((finished[0] as any).p_charge,6380680);
 assert.equal((finished[0] as any).p_signature,'landed');
});