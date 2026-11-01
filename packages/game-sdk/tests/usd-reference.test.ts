import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceStake, referenceQuote, validateReferenceQuote, validateMarketObservation, assertHtsRoomStake } from "../src/usdReference.js";
const mint="HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4",now=1_800_000_000_000;
test("USD rooms use exact six-decimal HTS amounts and full combined pots",()=>{
  for(const [cents,stake]of [[100,100n],[1000,1000n],[10000,10000n],[100000,100000n]] as const){assert.equal(referenceStake(cents),stake*1_000_000n);assert.equal(referenceStake(cents)*2n,stake*2_000_000n);}
  for(const cents of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1,NaN])assert.throws(()=>referenceStake(cents));
  for(const tier of [1,10]){assertHtsRoomStake(tier,BigInt(tier)*100_000_000n);assert.throws(()=>assertHtsRoomStake(tier,BigInt(tier)*1_000_000n));}
  assert.throws(()=>assertHtsRoomStake(100,10_000_000_000n));
});
test("quotes pin version, source, mint, simulated rate and bounded lifetime",()=>{
  const q=referenceQuote(mint,now);validateReferenceQuote(q,mint,now);validateReferenceQuote(q,mint,now+29_999);
  assert.throws(()=>validateReferenceQuote(q,mint,now+30_000));assert.throws(()=>validateReferenceQuote(q,mint,now-1));
  for(const patch of [{mint:"wrong"},{source:"invented-feed"},{version:"v2"},{simulated:false},{baseUnitsPerUsd:"1000000"},{priceMicroUsd:"1000000"},{expiresAtMs:now+31_000},{rounding:"floor"}])assert.throws(()=>validateReferenceQuote({...q,...patch} as typeof q,mint,now));
});
test("a replaceable real provider must pass source, mint, age, liquidity and deviation checks",()=>{
  const q={source:"approved-provider",mint,observedAtMs:now,priceMicroUsd:10_000n,executableLiquidityMicroUsd:1_000_000_000n};
  const policy={mint,allowedSources:new Set([q.source]),now,maxAgeMs:10_000,minLiquidityMicroUsd:500_000_000n,lastVerifiedPriceMicroUsd:10_000n,maxDeviationBps:500n};
  validateMarketObservation(q,policy);
  for(const patch of [{source:"invented"},{mint:"wrong"},{observedAtMs:now+1},{observedAtMs:now-10_001},{executableLiquidityMicroUsd:1n},{priceMicroUsd:0n},{priceMicroUsd:10_501n}])assert.throws(()=>validateMarketObservation({...q,...patch},policy));
  assert.throws(()=>validateMarketObservation(q,{...policy,lastVerifiedPriceMicroUsd:0n}));
});
