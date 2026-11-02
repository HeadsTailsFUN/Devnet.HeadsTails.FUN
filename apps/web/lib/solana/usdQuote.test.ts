import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { referenceQuote, stakeForUsd } from "@heads-or-tails/game-sdk";
import { DevnetUsdQuoteAdapter } from "./usdQuote";

const mint = "HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4";
const fetchOriginal = globalThis.fetch;
const dateNow = Date.now;
afterEach(() => { globalThis.fetch = fetchOriginal; Date.now = dateNow; });
const serverNow = Date.UTC(2026,10,2,12,0,0,500);
function serve(quote = referenceQuote(mint,serverNow), headers: Record<string,string> = {Date:new Date(serverNow).toUTCString()}) {
  globalThis.fetch = async () => Response.json(quote,{headers});
}

test("fresh authenticated-origin test rate works with phone clock ahead or behind, exact room stakes unchanged", async () => {
  for(const skew of [-300_000,-1_000,0,300_000]) {
    Date.now = () => serverNow + skew;
    serve();
    const quote = await new DevnetUsdQuoteAdapter().getQuote(mint);
    assert.equal(stakeForUsd(quote,100),100_000_000n);
    assert.equal(stakeForUsd(quote,1000),1_000_000_000n);
    assert.ok(Date.now()-quote.updatedAtMs >= 500,"TTL conservatively includes Date precision");
    assert.ok(quote.maxAgeMs-(Date.now()-quote.updatedAtMs) < 30_000);
  }
});

test("missing/invalid server time, cached, expired, future and mismatched quotes fail closed",async () => {
  for(const [quote,headers] of [
    [referenceQuote(mint,serverNow),{}],
    [referenceQuote(mint,serverNow),{Date:"invalid"}],
    [referenceQuote(mint,serverNow),{Date:new Date(serverNow).toUTCString(),Age:"1"}],
    [referenceQuote(mint,serverNow-30_000),{Date:new Date(serverNow).toUTCString()}],
    [referenceQuote(mint,serverNow+5_000),{Date:new Date(serverNow).toUTCString()}],
    [{...referenceQuote(mint,serverNow),baseUnitsPerUsd:"1"},{Date:new Date(serverNow).toUTCString()}],
    [referenceQuote("different-mint",serverNow),{Date:new Date(serverNow).toUTCString()}],
  ] as const) {
    serve(quote,headers);
    await assert.rejects(new DevnetUsdQuoteAdapter().getQuote(mint));
  }
});

test("failed quote endpoint never supplies a fallback stake", async () => {
  globalThis.fetch=async()=>new Response(null,{status:503});
  await assert.rejects(new DevnetUsdQuoteAdapter().getQuote(mint),/unavailable/);
});
