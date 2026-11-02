import { test } from "node:test";
import assert from "node:assert/strict";
import { restrictedQaAdmission, QA_PLAYERS } from "./restrictedQa";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [A,B] = [...QA_PLAYERS];
const mint="HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4";
const env={HEADSTAILS_RESTRICTED_QA:"true",NEXT_PUBLIC_RESTRICTED_QA:"true",NEXT_PUBLIC_SOLANA_CLUSTER:"devnet",NEXT_PUBLIC_HTS_TOKEN_MINT:mint,NEXT_PUBLIC_PROJECT_TOKEN_MINT:mint};
const req=(wallet:unknown)=>new Request("https://fixture.invalid/api/devnet/welcome-tokens",{method:"POST",headers:{"content-type":"application/json",cookie:"forged=public-address"},body:JSON.stringify({wallet})});

test("the additional owner-approved wallet requires its own verified session",async()=>{
  const wallet="BKYA1MNgLvnj8WkRaaBEcnyVEwFmm6nrGzov3KhMkKRo";
  assert.equal(QA_PLAYERS.size,3);
  assert.equal(await restrictedQaAdmission(req(wallet),env,async()=>wallet),null);
  assert.equal((await restrictedQaAdmission(req(wallet),env,async()=>null))?.status,401);
  assert.equal((await restrictedQaAdmission(req(wallet),env,async()=>A))?.status,403);
  assert.equal((await restrictedQaAdmission(req(A),env,async()=>wallet))?.status,403);
});
test("public address and forged cookies alone cannot authorize either approved player",async()=>{
  for(const wallet of [A,B])assert.equal((await restrictedQaAdmission(req(wallet),env,async()=>null))?.status,401);
});
test("verified session is restricted to designated players and its own recipient",async()=>{
  assert.equal((await restrictedQaAdmission(req(A),env,async()=>"11111111111111111111111111111111"))?.status,403);
  assert.equal((await restrictedQaAdmission(req(B),env,async()=>A))?.status,403);
  const request=req(A);assert.equal(await restrictedQaAdmission(request,env,async()=>A),null);assert.deepEqual(await request.json(),{wallet:A});
  assert.equal(await restrictedQaAdmission(req(B),env,async()=>B),null);
});
test("wrong network or inconsistent QA flags fail before session resolution",async()=>{
  let calls=0;for(const patch of [{NEXT_PUBLIC_SOLANA_CLUSTER:"mainnet-beta"},{HEADSTAILS_RESTRICTED_QA:"false"},{NEXT_PUBLIC_RESTRICTED_QA:"false"}])assert.equal((await restrictedQaAdmission(req(A),{...env,...patch},async()=>{calls++;return A;}))?.status,503);
  assert.equal(calls,0);
});
test("every external gameplay signing trigger admits QA before business work",()=>{
  for(const file of ["devnet/welcome-tokens","devnet/sponsor/prepare","devnet/sponsor/reimburse","devnet/maintain-room","devnet/match-crank","devnet/match-crank-room","settlement/ensure","history/index-settlement"]){const src=readFileSync(join(process.cwd(),"app/api",file,"route.ts"),"utf8");assert(src.includes("await restrictedQaAdmission(req)"),file);}
});
