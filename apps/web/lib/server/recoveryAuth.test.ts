import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { authorizeRecovery, recoveryMessage, recoveryHealth } from "./recoveryAuth";

const origin="https://headstails-devnet-beta.vercel.app", mint="HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4";
const cfg={secret:"a".repeat(64),origin,mint,nowSeconds:1793406000};
const nonce="11111111-2222-3333-4444-555555555555", timestamp=String(cfg.nowSeconds);
function request(overrides: Record<string,string>={}, path="/api/cron/maintain-rooms") {
  const mac=createHmac("sha256",cfg.secret).update(recoveryMessage(origin,mint,timestamp,nonce)).digest("hex");
  return new Request(origin+path,{headers:{"x-ht-recovery-time":timestamp,"x-ht-recovery-nonce":nonce,"x-ht-recovery-mac":mac,...overrides}});
}
test("valid HMAC admits one synthetic claim adapter winner among concurrent copies",async()=>{
  const used=new Set(); const consume=async(n:string)=>{if(used.has(n))return false;used.add(n);return true;};
  const results=await Promise.all(Array.from({length:20},()=>authorizeRecovery(request(),cfg,consume)));
  assert.equal(results.filter(Boolean).length,1);
});
test("queue-visible health strips raw exception strings and preserves failure signals",()=>{
  const secret="SYNTHETIC_PRIVATE_RPC_CREDENTIAL";
  const body = recoveryHealth({rooms:[{tierUsd:1,invariants:[],notes:[secret]},{tierUsd:10,error:secret}],settle:{errors:[secret]},rewards:{failed:1,errors:[secret]}});
  const json=JSON.stringify(body);assert(!json.includes(secret));assert(json.includes('ROOM_MAINTENANCE_FAILED'));assert(json.includes('SETTLEMENT_RECOVERY_FAILED'));assert(json.includes('REWARD_RECOVERY_FAILED'));
});
test("tampered, expired, future, wrong-purpose and wrong-key requests never reach claim",async()=>{
  let calls=0;const consume=async()=>{calls++;return true;};
  for(const req of [request({"x-ht-recovery-mac":"0".repeat(64)}),request({"x-ht-recovery-mac":"invalid"}),request({"x-ht-recovery-nonce":"bad"}),request({},"/api/admin/game")])assert.equal(await authorizeRecovery(req,cfg,consume),false);
  for(const patch of [{secret:"b".repeat(64)},{nowSeconds:cfg.nowSeconds+121},{nowSeconds:cfg.nowSeconds-11},{origin:"https://unrelated.invalid"},{mint:"BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh"}])assert.equal(await authorizeRecovery(request(),{...cfg,...patch},consume),false);
  assert.equal(calls,0);
});
test("claim outage fails closed and signed headers contain no long-lived secret",async()=>{
  assert.equal(await authorizeRecovery(request(),cfg,async()=>{throw Error("synthetic");}),false);
  assert.equal(JSON.stringify([...request().headers]).includes(cfg.secret),false);
});
