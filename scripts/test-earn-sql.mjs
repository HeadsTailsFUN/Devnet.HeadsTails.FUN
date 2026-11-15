import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const { container, db } = JSON.parse(fs.readFileSync('artifacts/earn-points/verification-db.json', 'utf8'));
assert.equal(container, 'headstails-earn-v510-qa'); assert.match(db, /^earn_bootstrap_\d+$/);
assert.equal(execFileSync('docker', ['inspect','-f','{{index .Config.Labels "headstails.purpose"}}',container], { encoding:'utf8' }).trim(), 'earn-v510-isolated-tests');
const args=['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-At','-v','ON_ERROR_STOP=1'];
function sql(input) { try { return execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(); } catch(e) { throw new Error(String(e.stderr)); } }
const literal = v => v === null ? 'null' : "'"+String(v).replaceAll("'","''")+"'";
const hash = v => createHash('sha256').update(v).digest('hex');
const statement=(action,wallet,data={})=>`select public.earn_dispatch(${literal(action)},${literal(wallet)},${literal(JSON.stringify(data))}::jsonb);`;
const call=(a,w,d)=>JSON.parse(sql(statement(a,w,d)));
const asyncSQL = input => new Promise((resolve,reject)=>{ const p=execFile('docker',args,{encoding:'utf8'},(e,out,err)=>e?reject(new Error(err)):resolve(out.trim())); p.stdin.end(input); });
const concurrent=(a,w,d)=>asyncSQL(statement(a,w,d)).then(JSON.parse);
const season=sql('select id from public.airdrop_seasons where active');
const amount=w=>+sql(`select coalesce(sum(points),0) from public.airdrop_points_ledger where wallet=${literal(w)} and status='verified'`);
const token=(w,raw)=>call('token',w,{provider:'telegram',digest:hash(raw)});
const link=(raw,id,key=randomUUID())=>({token_digest:hash(raw),external_id:String(id),request_key:key,body_digest:hash(raw+id)});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}

await test('all new flows and rewards are disabled on a clean migration',()=>{
 assert.equal(call('token','disabled',{provider:'telegram',digest:hash('off')}).status,'disabled');
 assert.equal(sql('select count(*) from public.earn_link_tokens'),'0');
});
sql(`update public.earn_season_settings set telegram_linking=true,telegram_jobs=true,discord_enabled=true,x_manual_enabled=true,new_rewards_enabled=true,
 quest_flags='{"telegram_group":true,"telegram_channel":true,"discord_member":true,"three_days":true}';`);
await test('token issue -> atomic link -> identical receipt -> replay refusal',()=>{
 const raw='TEST_ONLY_'+randomUUID(); token('alice',raw); const payload=link(raw,111);
 const first=call('telegram_link',null,payload); assert.equal(first.status,'linked'); assert.equal(first.ok,true); assert.notEqual(first.account_ref,'alice');
 assert.deepEqual(call('telegram_link',null,payload),first);
 assert.equal(call('telegram_link',null,link(raw,111)).status,'used');
 assert.equal(call('telegram_link',null,link(raw,222)).status,'used');
 assert.equal(amount('alice'),0);
 assert.equal(sql(`select count(*) from public.earn_link_tokens where digest=${literal(raw)}`),'0');
});
await test('expired/unknown tokens cannot link and conflicting identities cannot move wallets',()=>{
 const raw='expired-token'; token('expired',raw); sql(`update public.earn_link_tokens set expires_at=now()-interval '1 second' where digest=${literal(hash(raw))}`);
 assert.equal(call('telegram_link',null,link(raw,333)).status,'expired');
 assert.equal(call('telegram_link',null,link('unknown',333)).status,'invalid');
 token('mallory','conflict-token'); assert.equal(call('telegram_link',null,link('conflict-token',111)).status,'conflict');
 assert.equal(sql("select count(*) from public.earn_social_links where wallet='mallory'"),'0');
});
await test('competing link claims serialize and exactly one identity binding commits',async()=>{
 token('race-a','race-a');token('race-b','race-b');
 const results=await Promise.all([concurrent('telegram_link',null,link('race-a',444)),concurrent('telegram_link',null,link('race-b',444))]);
 assert.equal(results.filter(r=>r.ok===true).length,1);assert.equal(results.filter(r=>r.status==='conflict').length,1);
});
await test('idempotency keys cannot be reused for a changed body',()=>{
 token('receipt','receipt'); const payload=link('receipt',555);call('telegram_link',null,payload);
 assert.throws(()=>call('telegram_link',null,{...payload,body_digest:hash('changed')}),/idempotency-conflict/);
});
await test('persistent rate buckets stop the sixth attempt and give a bounded retry',()=>{
 for(let i=0;i<5;i++)assert.equal(call('rate',null,{bucket:'rate-test',limit:5,window:600}).allowed,true);
 const r=call('rate',null,{bucket:'rate-test',limit:5,window:600});assert.equal(r.allowed,false);assert(r.retry_after>0&&r.retry_after<=600);
});
function setupMember(wallet,id){token(wallet,wallet);assert.equal(call('telegram_link',null,link(wallet,id)).ok,true);}
function job(wallet,chat='group'){return call('telegram_job',wallet,{chat,chat_id:chat==='group'?-100111:-100222}).job_id;}
function poll(){return call('telegram_poll',null,{limit:50});}
function result(jid,id,status='VERIFIED',chat='group',override={}) {
 const payload={job_id:jid,external_id:String(id),chat,chat_id:chat==='group'?-100111:-100222,status,checked_at:Date.now()/1000,award:true,request_key:'verification:'+jid,...override};
 payload.body_digest=hash(JSON.stringify({...payload,body_digest:undefined}));return payload;
}
await test('jobs are scoped, bounded and leased only once per active lease',()=>{
 const id=job('alice');assert(id);assert.equal(job('alice'),id);
 const first=poll();assert(first.jobs.some(j=>j.job_id===id));assert.equal(poll().jobs.length,0);
 assert.throws(()=>call('telegram_result',null,result(id,999)),/job-scope-conflict/);
 const payload=result(id,111);assert.equal(call('telegram_result',null,payload).ok,true);
 assert.equal(amount('alice'),20);assert.equal(call('telegram_result',null,payload).ok,true);assert.equal(amount('alice'),20);
 assert.throws(()=>call('telegram_result',null,{...payload,body_digest:hash('different')}),/idempotency-conflict/);
});
await test('only authoritative VERIFIED membership earns; all other outcomes earn zero',()=>{
 let id=600;
 for(const status of ['NOT_MEMBER','PENDING','UNAVAILABLE','ERROR']){
  const w='membership-'+status;setupMember(w,++id);const jid=job(w);poll();assert.equal(call('telegram_result',null,result(jid,id,status)).ok,true);assert.equal(amount(w),0);
 }
 const channel=job('alice','channel');poll();call('telegram_result',null,result(channel,111,'VERIFIED','channel'));assert.equal(amount('alice'),25);
});
await test('expired or unleased jobs are durably acknowledged without reward',()=>{
 setupMember('late',700);let jid=job('late');poll();sql(`update public.earn_verification_jobs set expires_at=now()-interval '1 second' where job_id=${literal(jid)}`);
 assert.equal(call('telegram_result',null,result(jid,700)).ok,true);assert.equal(amount('late'),0);
 setupMember('unleased',701);jid=job('unleased');call('telegram_result',null,result(jid,701));assert.equal(amount('unleased'),0);
});
await test('disabled or excluded rewards never credit a successful membership proof',()=>{
 setupMember('off',702);let jid=job('off');poll();sql('update public.earn_season_settings set new_rewards_enabled=false');call('telegram_result',null,result(jid,702));assert.equal(amount('off'),0);
 sql("update public.earn_season_settings set new_rewards_enabled=true;insert into public.reward_exclusions(wallet,reason)values('excluded','fixture')");
 setupMember('excluded',703);jid=job('excluded');poll();call('telegram_result',null,result(jid,703));assert.equal(amount('excluded'),0);
});
await test('only the website owner can unlink; unlink/reconnect cannot reset rewards or social uniqueness',()=>{
 assert.equal(call('telegram_unlink',null,{external_id:'111',request_key:randomUUID(),body_digest:hash('no-owner')}).status,'unavailable');
 call('wallet_unlink','alice',{provider:'telegram'});assert.equal(amount('alice'),25);
 assert.equal(call('telegram_unlink',null,{external_id:'111',request_key:randomUUID(),body_digest:hash('owner-unlinked')}).status,'not_linked');
 token('alice','relink');assert.equal(call('telegram_link',null,link('relink',111)).ok,true);assert.equal(job('alice'),undefined);
 token('steal','steal');assert.equal(call('telegram_link',null,link('steal',111)).status,'conflict');assert.equal(amount('alice'),25);
});
await test('Discord links use unique platform IDs and only complete membership can award once',()=>{
 assert.equal(call('discord_link','discord-a',{external_id:'123456789012345678',membership:'PENDING',award:true}).status,'linked');assert.equal(amount('discord-a'),0);
 call('discord_link','discord-a',{external_id:'123456789012345678',membership:'VERIFIED',award:true});assert.equal(amount('discord-a'),15);
 call('discord_link','discord-a',{external_id:'123456789012345678',membership:'VERIFIED',award:true});assert.equal(amount('discord-a'),15);
 assert.equal(call('discord_link','discord-b',{external_id:'123456789012345678',membership:'VERIFIED',award:true}).status,'conflict');
});
await test('OAuth state consumption is wallet-bound, expiring and single-use',()=>{
 call('token','oauth',{provider:'discord',digest:hash('oauth')});
 assert.equal(call('discord_consume','attacker',{digest:hash('oauth')}).status,'invalid_state');
 assert.equal(call('discord_consume','oauth',{digest:hash('oauth')}).status,'consumed');
 assert.equal(call('discord_consume','oauth',{digest:hash('oauth')}).status,'invalid_state');
});
function match(wallet,id,date,{settled=true,marker=true}={}) {
 sql(`insert into public.matches(cluster,program_id,onchain_match_id,transaction_signature,heads_wallet,tails_wallet,heads_amount,tails_amount,token_mint,result,winner_wallet,settled_at)
 values('devnet','qa-program',${literal(id)},${literal('tx'+id)},${literal(wallet)},'other',100,100,'qa-mint','HEADS',${literal(wallet)},${settled?literal(date):'null'});`);
 if(marker)sql(`select public.award_gameplay_match_atomic(${literal(season)},${literal(wallet)},${literal(id)},true,${literal(date)}::timestamptz);`);
}
const dayInput={program:'qa-program',mint:'qa-mint',award:true};
const dayAgo=(days,hour=12)=>{const date=new Date();date.setUTCDate(date.getUTCDate()-days);date.setUTCHours(hour,0,0,0);return date.toISOString();};
await test('three-day quest counts retroactive nonconsecutive settled UTC dates; no duplicates or unsettled matches',()=>{
 sql("update public.airdrop_seasons set starts_at=now()-interval '30 days'");
 match('three','d1',dayAgo(12));match('three','d1b',dayAgo(12,22));assert.equal(call('three_days','three',dayInput).days,1);
 match('three','d2',dayAgo(8));match('three','unsettled',dayAgo(7),{settled:false});match('three','unverified',dayAgo(6),{marker:false});
 assert.equal(call('three_days','three',dayInput).days,2);
 const before=amount('three');match('three','d3',dayAgo(2));assert.equal(call('three_days','three',dayInput).status,'awarded');
 const after=amount('three');assert.equal(after,before+5+20);call('three_days','three',dayInput);assert.equal(amount('three'),after);
});
function challenge(wallet,handle){return call('x_challenge',wallet,{handle,profile_url:'https://x.com/'+handle,code:'HTS-'+randomUUID()});}
function submit(wallet,c){return call('x_submit',wallet,{challenge_id:c.challenge_id});}
function claimId(wallet){return sql(`select id from public.airdrop_social_claims where wallet=${literal(wallet)} and task_type='connect_x'`);}
const review=(id,extra={})=>call('x_review','reviewer',{claim_id:id,decision:'verified',reason:'Bio code observed in isolated fixture',ownership_confirmed:true,...extra});
await test('X requires an unexpired ownership challenge and explicit audited manual approval',()=>{
 const c=challenge('x-a','xhandle');submit('x-a',c);const id=claimId('x-a');
 assert.equal(amount('x-a'),0);assert.throws(()=>review(id,{ownership_confirmed:false}),/ownership-challenge-required/);
 review(id);assert.equal(amount('x-a'),100);review(id);assert.equal(amount('x-a'),100);
 assert.equal(sql("select count(*) from public.airdrop_x_identities where wallet='x-a' and x_user_id is not null"),'0');
 const expired=challenge('x-expired','expiredhandle');sql(`update public.earn_x_challenges set expires_at=now()-interval '1 second' where id=${literal(expired.challenge_id)}`);
 assert.equal(submit('x-expired',expired).status,'expired');
});
await test('competing X reviews cannot credit a shared external handle twice',async()=>{
 submit('x-race-a',challenge('x-race-a','sharedhandle'));submit('x-race-b',challenge('x-race-b','sharedhandle'));
 const inputs=['x-race-a','x-race-b'].map(w=>({claim_id:claimId(w),decision:'verified',reason:'Fixture bio ownership attestation',ownership_confirmed:true}));
 const results=await Promise.allSettled(inputs.map(data=>concurrent('x_review','reviewer',data)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(amount('x-race-a')+amount('x-race-b'),100);
});
await test('X unlink/reconnect and rejected re-verification preserve historical approved Points',()=>{
 call('wallet_unlink','x-a',{provider:'x'});const c=challenge('x-a','xhandle');submit('x-a',c);assert.equal(amount('x-a'),100);
 review(claimId('x-a'),{decision:'rejected',reason:'Fixture re-verification rejected'});assert.equal(amount('x-a'),100);
 const retry=challenge('x-a','xhandle');submit('x-a',retry);review(claimId('x-a'));assert.equal(amount('x-a'),100);
 assert.equal(sql("select count(*) from public.earn_verification_audit where event='x_review' and review_details->>'reason'='Fixture re-verification rejected'"),'1');
 assert.equal(sql("select count(*) from public.earn_verification_audit where event='x_review' and review_details->>'reason'='Bio code observed in isolated fixture' and related_ref="+literal(claimId('x-a'))),'2');
});
await test('RLS and RPC grants deny anonymous/authenticated access',()=>{
 assert.throws(()=>sql("set role anon;select * from public.earn_link_tokens;"),/permission denied/);
 assert.throws(()=>sql("set role authenticated;select public.earn_dispatch('three_days','attacker','{}');"),/permission denied/);
 assert.equal(sql("set role service_role;select public.earn_eligible('alice',(select id from public.airdrop_seasons where active));"),'SET\nt');
});
console.log(JSON.stringify({passed,failed:0,engine:'PostgreSQL 17',database:db,productionModified:false}));
fs.writeFileSync('artifacts/earn-points/sql-test-summary.json',JSON.stringify({passed,failed:0,engine:'PostgreSQL 17',database:db},null,2));
