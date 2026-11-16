import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as report } from "../../app/api/admin/earn-activity/route";
import { GET as queue, POST as review } from "../../app/api/admin/earn-verifications/route";
import { POST as legacyReview } from "../../app/api/admin/airdrop/route";
import { SESSION_COOKIE } from "../auth/message";
const originalEnv={...process.env}, originalFetch=globalThis.fetch;
const origin="https://admin-report-fixture.invalid", wallet="11111111111111111111111111111111", claim="00000000-0000-4000-8000-000000000001";
afterEach(()=>{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in originalEnv))delete process.env[k];Object.assign(process.env,originalEnv);});
function fixture(role="FULL_ADMIN",failReview=false){
 process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-admin-fixture";process.env.NEXT_PUBLIC_SOLANA_CLUSTER="devnet";
 process.env.MAINNET_REAL_VALUE_ENABLED="false";process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED="false";process.env.EARN_X_MANUAL_VERIFICATION_ENABLED="false";
 delete process.env.SOLANA_SERVER_RPC_URL;delete process.env.NEXT_PUBLIC_RPC_URL;
 const calls:Array<{table:string;body:Record<string,unknown>|null}>=[];
 globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input)),table=u.pathname.split('/').at(-1)!;
  const body=init?.body?JSON.parse(String(init.body)):null;calls.push({table,body});
  if(u.hostname!==new URL(origin).hostname)return Response.json({jsonrpc:"2.0",id:1,result:{context:{slot:1},value:null}});
  if(table==='auth_sessions')return Response.json({wallet,expires_at:'2099-01-01T00:00:00Z'});
  if(table==='admin_members')return Response.json(role?{role}:null);
  if(table==='airdrop_seasons')return Response.json({id:'fixture-season',key:'QA',active:true});
  if(table==='earn_season_settings')return Response.json({x_manual_enabled:false});
  if(table==='admin_earn_activity_report')return Response.json({rows:[],total:125,page:body?.p_page,pageSize:25,summary:{events:5000}});
  if(table==='admin_review_earn_claim')return failReview?Response.json({message:'evidence-review-required',code:'P0001'},{status:400}):Response.json({status:body?.p_decision});
  throw Error('Unexpected fixture table '+table);
 };
 return calls;
}
function request(path:string,body?:Record<string,unknown>,auth=true,extra:Record<string,string>={}){
 return new Request(origin+path,{method:body?'POST':'GET',headers:{...(auth?{cookie:`${SESSION_COOKIE}=${'a'.repeat(64)}`} : {}),...(body?{'content-type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
}
test('new admin report and review APIs reject wallet-only impersonation without a session',async()=>{
 fixture();assert.equal((await report(request('/api/admin/earn-activity?wallet='+wallet,undefined,false))).status,401);assert.equal((await queue(request('/api/admin/earn-verifications',undefined,false))).status,401);assert.equal((await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'verified',reason:'review proof'},false))).status,401);
});
test('FULL_ADMIN uses global database pagination/sort and private no-store responses',async()=>{
 const calls=fixture();const r=await report(request('/api/admin/earn-activity?query=alpha&activity=win&sort=events&direction=desc&page=5&pageSize=25&from=2026-11-01&to=2026-11-16'));
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');const call=calls.find(c=>c.table==='admin_earn_activity_report')!;assert.equal(call.body?.p_page,5);assert.equal(call.body?.p_query,'alpha');assert.equal(call.body?.p_activity,'win');assert.equal(call.body?.p_to,'2026-11-17T00:00:00.000Z');assert.equal((await r.json()).total,125);
});
test('invalid activity, sort, page, wallet, and UTC dates fail before reporting RPC',async()=>{
 for(const query of ['activity=made_up','sort=sql','page=0','pageSize=1000','wallet=invalid','mode=events','from=2026-02-31','from=2026-11-17&to=2026-11-16']){const calls=fixture();assert.equal((await report(request('/api/admin/earn-activity?'+query))).status,400);assert(!calls.some(c=>c.table==='admin_earn_activity_report'));}
});
test('moderators may inspect but cannot decide; ordinary users and mainnet FULL_ADMIN are denied',async()=>{
 fixture('MODERATOR');assert.equal((await report(request('/api/admin/earn-activity'))).status,200);assert.equal((await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'rejected',reason:'Evidence missing'}))).status,403);
 fixture('');assert.equal((await report(request('/api/admin/earn-activity'))).status,403);fixture();process.env.NEXT_PUBLIC_SOLANA_CLUSTER='mainnet-beta';assert.equal((await report(request('/api/admin/earn-activity'))).status,403);
});
test('existing request review works with new X submissions paused and binds reviewer to session',async()=>{
 const calls=fixture();const r=await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'verified',reason:'Verified actual ownership',ownershipConfirmed:true,reviewer:'spoofed-wallet'}));assert.equal(r.status,200);
 const call=calls.find(c=>c.table==='admin_review_earn_claim')!;assert.equal(call.body?.p_reviewer,wallet);assert.equal(call.body?.p_ownership,true);assert.equal(call.body?.p_evidence,false);
 const q=await queue(request('/api/admin/earn-verifications?query=old-user&state=pending&page=4&task=reply'));assert.equal(q.status,200);const b=await q.json();assert.equal(b.active,true);assert.equal(b.newSubmissionsActive,false);
});
test('review requires auditable reason, same origin, and actual database evidence checks',async()=>{
 fixture();assert.equal((await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'verified',reason:'no'}))).status,400);assert.equal((await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'verified',reason:'valid reason'},true,{origin:'https://attacker.invalid'}))).status,403);
 fixture('FULL_ADMIN',true);assert.equal((await review(request('/api/admin/earn-verifications',{claimId:claim,decision:'verified',reason:'valid reason'}))).status,409);
});
test('legacy review endpoint shares full-admin, reason, and evidence controls instead of bypassing the queue',async()=>{
 fixture('MODERATOR');assert.equal((await legacyReview(request('/api/admin/airdrop',{action:'review-claim',id:claim,decision:'verified',note:'valid reason'}))).status,403);
 const calls=fixture();assert.equal((await legacyReview(request('/api/admin/airdrop',{action:'review-claim',id:claim,decision:'verified',note:'Inspected actual ownership',ownershipConfirmed:true}))).status,200);assert(calls.some(c=>c.table==='admin_review_earn_claim'));
});
