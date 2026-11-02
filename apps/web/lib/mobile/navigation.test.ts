import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeMobileRoom, mobileLocation, readMobileLocation, mobileGameFeedback } from "./navigation";
test("mobile deep links accept only the four tabs and existing information pages",()=>{
  assert.deepEqual(readMobileLocation(""),{tab:"play",info:null});
  assert.deepEqual(readMobileLocation("?tab=flips"),{tab:"flips",info:null});
  assert.deepEqual(readMobileLocation("?tab=profile&info=terms"),{tab:"profile",info:"terms"});
  assert.deepEqual(readMobileLocation("?tab=https://other.test&info=admin"),{tab:"play",info:null});
});
test("tab and information navigation retain referral attribution and clear old information",()=>{
  const info=new URLSearchParams(mobileLocation("?ref=OWNER_REF&tab=social","profile","privacy"));
  assert.equal(info.get("ref"),"OWNER_REF");assert.equal(info.get("info"),"privacy");
  const play=new URLSearchParams(mobileLocation(`?${info}`,"play",null));
  assert.equal(play.get("ref"),"OWNER_REF");assert.equal(play.get("tab"),"play");assert.equal(play.has("info"),false);
});
test("room changes fail closed during stake preparation, queue, match and pending settlement",()=>{
  for(const state of ["joining","queued-heads","queued-tails","match-found","flipping"])assert.equal(canChangeMobileRoom(state,false,false,false),false);
  assert.equal(canChangeMobileRoom("ready",true,false,false),false);
  assert.equal(canChangeMobileRoom("ready",false,true,false),false);
  assert.equal(canChangeMobileRoom("win",false,false,true),false);
  for(const state of ["disconnected","ready","heads-selected","win"])assert.equal(canChangeMobileRoom(state,false,false,false),true);
});
test("cross-tab feedback distinguishes submitted, queued, pending payout and completed states",()=>{
  assert.equal(mobileGameFeedback("joining",false),"Transaction pending");
  assert.equal(mobileGameFeedback("queued-heads",false),"Queued");
  assert.equal(mobileGameFeedback("win",true),"Settlement pending");
  assert.equal(mobileGameFeedback("win",false),"You won");
  assert.equal(mobileGameFeedback("error",false),"Action failed");
  assert.equal(mobileGameFeedback("ready",false),null);
});
