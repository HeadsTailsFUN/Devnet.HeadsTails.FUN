import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const { container, db } = JSON.parse(fs.readFileSync('artifacts/earn-points/verification-db.json', 'utf8'));
assert.equal(container,'headstails-earn-v510-qa'); assert.match(db,/^earn_bootstrap_\d+$/);
assert.equal(execFileSync('docker',['inspect','-f','{{index .Config.Labels "headstails.purpose"}}',container],{encoding:'utf8'}).trim(),'earn-v510-isolated-tests');
function sql(text){try{return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Error(String(e.stderr));}}
const lit=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
sql(`create table public.profiles(wallet text primary key,username text);create table public.admin_audit_log(id uuid primary key default gen_random_uuid(),admin_wallet text,action text,target text,metadata jsonb,created_at timestamptz default now());grant all on public.profiles,public.admin_audit_log to service_role;`);
sql(fs.readFileSync('supabase/migrations/20261116005911_admin_earn_activity_report.sql','utf8'));
const season=sql('select id from public.airdrop_seasons where active');
const report=(options={})=>JSON.parse(sql(`select public.admin_earn_activity_report(${Object.entries({p_season:season,...options}).map(([k,v])=>k+'=>'+lit(v)).join(',')});`));
const review=(id,decision,ownership=false,evidence=false)=>JSON.parse(sql(`select public.admin_review_earn_claim(${lit(id)},${lit(decision)},'qa-reviewer','Evidence checked in isolated QA',${ownership},${evidence});`));
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
sql(`insert into public.profiles values('alpha','Alpha'),('beta','Beta'),('idle','Idle');
insert into public.airdrop_points_ledger(season_id,wallet,category,event_type,source_key,points,status,metadata)
 select ${lit(season)},'alpha','gameplay','gameplay_match','match-'||g,2,'verified',jsonb_build_object('outcome',case when g%3=0 then 'win' else 'loss' end) from generate_series(1,1050) g;
insert into public.airdrop_points_ledger(season_id,wallet,category,event_type,source_key,points,status)
 select ${lit(season)},'alpha','win_bonus','win_bonus_match','match-'||g,3,'verified' from generate_series(3,1050,3) g;
insert into public.airdrop_points_ledger(season_id,wallet,category,event_type,source_key,points,status,metadata) values(${lit(season)},'beta','gameplay','gameplay_match','beta-match',0,'verified','{"outcome":"loss"}');`);
await test('global aggregation includes more than 1000 ledger rows and folds win bonuses into one game',()=>{
 const r=report();assert.equal(r.total,3);assert.equal(r.rows[0].wallet,'alpha');assert.equal(r.rows[0].events,1050);assert.equal(r.rows[0].points,3150);assert.equal(r.rows[0].activities.win.events,350);assert.equal(r.rows[0].activities.loss.events,700);assert.equal(r.summary.events,1051);
});
await test('pagination and ascending sort cover all users without repeats or silent truncation',()=>{
 const pages=[1,2,3].map(p=>report({p_page:p,p_limit:1}));assert.equal(new Set(pages.map(p=>p.rows[0].wallet)).size,3);assert.equal(report({p_sort:'events',p_direction:'asc'}).rows[0].wallet,'idle');
});
await test('activity filter and literal username search rank across the entire matching set',()=>{
 const r=report({p_activity:'win',p_query:'ALPHA'});assert.equal(r.total,1);assert.equal(r.rows[0].events,350);assert.equal(report({p_query:'%'}).total,0);
});
await test('zero-Point capped game remains an activity and date filtering does not invent inactive records',()=>{
 assert.equal(report({p_wallet:'beta'}).rows[0].events,1);assert.equal(report({p_wallet:'beta'}).rows[0].points,0);assert.equal(report({p_from:'2099-01-01'}).total,0);
});
await test('full per-user timeline is paginated past 1000 games',()=>{
 const r=report({p_mode:'events',p_wallet:'alpha',p_page:11,p_limit:100});assert.equal(r.total,1050);assert.equal(r.rows.length,50);assert.equal(r.activities.win.events,350);
});
sql(`insert into public.earn_verification_jobs(wallet,season_id,telegram_user_id,chat,chat_id,expires_at) values('alpha',${lit(season)},'123456789','group',-1001234567890,now()+interval '10 minutes');`);
await test('uncompleted membership jobs stay pending with zero confirmed Points',()=>{
 const r=report({p_mode:'events',p_wallet:'alpha',p_activity:'telegram_group'});assert.equal(r.rows.length,1);assert.equal(r.rows[0].status,'pending');assert.equal(r.rows[0].verified_points,0);
});
sql(`select public.create_airdrop_social_claim_atomic(${lit(season)},'beta','connect_x','betafixture','https://x.com/betafixture',null,null,100);`);
const claim=sql(`select id from public.airdrop_social_claims where wallet='beta' and task_type='connect_x'`);
await test('existing ownership claim review works while new submissions are disabled and requires attestation',()=>{
 assert.equal(sql('select x_manual_enabled from public.earn_season_settings'),'f');assert.throws(()=>review(claim,'verified'),/ownership-challenge-required/);assert.equal(review(claim,'verified',true).status,'verified');
});
await test('approval is idempotent, rejection revokes the same credit, and both review logs are retained',()=>{
 assert.equal(review(claim,'verified',true).status,'unchanged');assert.equal(sql(`select count(*) from public.airdrop_points_ledger where source_key=${lit(claim)}`),'1');review(claim,'rejected');assert.equal(sql(`select status from public.airdrop_points_ledger where source_key=${lit(claim)}`),'rejected');assert.equal(sql(`select count(*) from public.earn_verification_audit where related_ref=${lit(claim)} and event='x_review'`),'2');assert.equal(sql(`select count(*) from public.admin_audit_log where target=${lit(claim)}`),'2');
});
review(claim,'verified',true);
sql(`select public.create_airdrop_social_claim_atomic(${lit(season)},'beta','reply','betafixture','https://x.com/betafixture','https://x.com/betafixture/status/123',null,50);`);
const reply=sql(`select id from public.airdrop_social_claims where wallet='beta' and task_type='reply'`);
await test('reply approval requires explicit evidence review and records the approved 50 Points once',()=>{
 assert.throws(()=>review(reply,'verified'),/evidence-review-required/);review(reply,'verified',false,true);assert.equal(sql(`select sum(points) from public.airdrop_points_ledger where source_key=${lit(reply)} and status='verified'`),'50');
});
sql(`update public.earn_season_settings set x_manual_enabled=true;`);
const challenge=JSON.parse(sql(`select public.earn_dispatch('x_challenge','alpha','{"handle":"alphafixture","profile_url":"https://x.com/alphafixture","code":"HTS-ISOLATED-PUBLIC-CODE"}');`));
sql(`select public.earn_dispatch('x_submit','alpha',jsonb_build_object('challenge_id',${lit(challenge.challenge_id)}));update public.earn_season_settings set x_manual_enabled=false;`);
const modern=sql(`select id from public.airdrop_social_claims where wallet='alpha' and task_type='connect_x'`);
await test('bio proof expiry remains enforced even with full admin and paused submissions',()=>{
 sql(`update public.earn_x_challenges set expires_at=now()-interval '1 second' where id=${lit(challenge.challenge_id)};`);assert.throws(()=>review(modern,'verified',true),/ownership-challenge-required/);
});
sql(`insert into public.airdrop_social_claims(season_id,wallet,task_type,x_handle,x_profile_url,status) select ${lit(season)},'pending-'||g,'connect_x','handle'||g,'https://x.com/handle'||g,'pending' from generate_series(1,130) g;`);
await test('review search/status filtering occurs before pagination, including claims beyond the old recent-100 limit',()=>{
 const r=report({p_mode:'reviews',p_query:'handle129',p_state:'pending',p_limit:1});assert.equal(r.total,1);assert.equal(r.rows[0].x_handle,'handle129');assert.equal(report({p_mode:'reviews',p_state:'pending',p_page:6,p_limit:25}).rows.length,5);
});
await test('social claim and its ledger credit appear once and reporting reveals no token/identity secrets',()=>{
 const r=report({p_mode:'events',p_wallet:'beta',p_activity:'reply'});assert.equal(r.total,1);assert.equal(r.rows[0].verified_points,50);assert(!JSON.stringify(r).includes('body_digest'));assert(!JSON.stringify(r).includes('telegram_user_id'));
});
await test('blocked and qualified referrals without a reward still have truthful activity records',()=>{
 sql(`insert into public.referral_attributions(invitee_wallet,referrer_wallet,referral_code,status,qualification_reason) values('blocked-invitee','blocked-referrer','fixture','blocked','Excluded activity'),('unpaid-invitee','unpaid-referrer','fixture','qualified',null);`);
 const blocked=report({p_mode:'events',p_wallet:'blocked-referrer'});assert.equal(blocked.rows[0].status,'rejected');const unpaid=report({p_mode:'events',p_wallet:'unpaid-referrer'});assert.equal(unpaid.rows[0].status,'verified');assert.equal(unpaid.rows[0].verified_points,0);
});
await test('server-only views and RPCs deny browser roles and permit service-role report reads',()=>{
 assert.throws(()=>sql('set role anon;select * from public.admin_earn_activity_events;'),/permission denied/);assert.throws(()=>sql(`set role authenticated;select public.admin_earn_activity_report(${lit(season)});`),/permission denied/);assert.throws(()=>sql(`set role anon;select public.admin_review_earn_claim(${lit(claim)},'verified','x','reason',true,true);`),/permission denied/);assert.equal(sql(`set role service_role;select (public.admin_earn_activity_report(${lit(season)})->>'total')::int>0;`),'SET\nt');
});
fs.writeFileSync('artifacts/earn-points/admin-sql-results.json',JSON.stringify({passed,failed:0,database:db,productionModified:false},null,2));
console.log(JSON.stringify({passed,failed:0,productionModified:false}));
