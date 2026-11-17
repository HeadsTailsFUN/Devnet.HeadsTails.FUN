import assert from 'node:assert/strict';
import fs from 'node:fs';
const base='http://127.0.0.1:3340', results=[];
for (let attempt=0;attempt<20;attempt++) {
 try { const ready=await fetch(base+'/welcome',{method:'HEAD'}); if(ready.status===200)break; if(attempt===19)throw new Error('Preview did not become ready'); }
 catch (error) { if(attempt===19)throw error; }
 await new Promise(resolve=>setTimeout(resolve,250));
}
const request=(path,headers={})=>fetch(base+path,{redirect:'manual',headers});
async function check(name,fn) { await fn(); results.push({name,passed:true}); console.log('PASS '+name); }
await check('first root visit is a temporary private redirect to welcome',async()=>{
 const r=await request('/');assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),base).pathname,'/welcome');
 assert.match(r.headers.get('cache-control'),/no-store/);assert.match(r.headers.get('set-cookie'),/ht_welcome_seen=1/);
});
await check('direct welcome renders official artwork, metadata and same-origin root launch links',async()=>{
 const r=await request('/welcome?ref=KEEP_CODE'); assert.equal(r.status,200); const html=await r.text();
 assert.match(r.headers.get('set-cookie'),/ht_welcome_seen=1/);
 assert.match(html,/https:\/\/headstails.fun\/welcome/); assert.match(html,/href="\/\?ref=KEEP_CODE"/);
 assert.match(html,/100/);assert.match(html,/1,000/);assert.match(html,/simulated USD/);
 for(const word of ['HOW IT WORKS','WHY HEADSTAILS','Devnet Beta','Good questions.','HeadsTails.fun'])assert.ok(html.includes(word),word);
 for(const word of ['TOKENOMICS','ROADMAP','Founder','Player Rewards','Initial Community','COMMUNITY &amp; GROWTH','EXPANSION','planning allocations','mint and metadata update authority'])assert.ok(html.includes(word),word);
 assert.ok(!html.includes('id="game-rooms"')); assert.ok(!html.includes('id="app-preview"')); assert.ok(!html.includes('id="earn-points"'));
 assert.match(html,/HEADS OR TAILS/); assert.match(html,/ONE FLIP. ONE WINNER/); assert.ok(!html.includes('Two Idiots'));
 assert.ok(!html.includes('/devnet')); // The owner's correction keeps the game at /.
});
await check('Launch App and later visits render the original root game with no welcome loop',async()=>{
 const r=await request('/',{cookie:'ht_welcome_seen=1'});assert.equal(r.status,200);const html=await r.text();
 assert.match(html,/Heads or Tails — HeadsTails.fun/);assert.ok(!html.includes('id="hero-heading"'));
});
await check('legacy referral, Earn and all mobile tabs still open the root app',async()=>{
 for(const path of ['/?ref=KEEP_CODE','/?earn=1','/?earn=1&earn_notice=discord_verified','/?tab=social','/?tab=flips','/?tab=profile&info=privacy','/?tab=play','/?data=wallet-return&nonce=state']) {
  const r=await request(path);assert.equal(r.status,200,path); assert.equal(r.headers.get('location'),null,path);
 }
 const earn=await request('/earn-points');assert.equal(earn.status,307);assert.equal(earn.headers.get('location'),'/?earn=1');
});
await check('supporting routes and admin remain accessible, API sessions remain anonymous',async()=>{
 for(const path of ['/admin','/how-to','/privacy','/terms','/tokenomics','/roadmap'])assert.equal((await request(path)).status,200,path);
 const session=await request('/api/auth/session');assert.equal(session.status,200);assert.deepEqual(await session.json(),{wallet:null});
 for(const path of ['/api/earn/status','/api/admin/status'])assert.equal((await request(path)).status,401,path);
 const denied=await request('/api/auth/session',{origin:'https://other.invalid','sec-fetch-site':'cross-site'});assert.equal(denied.status,403);
});
await check('all provided artwork and optimized image endpoints render successfully',async()=>{
 for(const path of ['/welcome/heads.png','/welcome/tails.png','/welcome/coin.png','/welcome/coin-fire.png','/_next/image?url=%2Fwelcome%2Fcoin.png&w=640&q=90']) {
  const r=await request(path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/image/);
 }
});
fs.writeFileSync('artifacts/welcome/http-results.json',JSON.stringify({base,checks:results,passed:results.length,productionTouched:false},null,2));
console.log(`${results.length} production-build HTTP flows passed`);
