import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
globalThis.fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.hostname === "recovery-rpc.invalid") {
    const body = await req.json();
    let result: unknown;
    if (body.method === "getGenesisHash") result = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    else if (body.method === "getAccountInfo") result = { context: { slot: 1 }, value: account(config) };
    else if (body.method === "getMultipleAccounts") {
      matchReads++;
      readIds.push(body.params[0].map((address: string) => byAddress.get(address)).find((id: number | undefined) => id !== undefined));
      result = { context: { slot: 1 }, value: body.params[0].map((address: string) =>
        byAddress.has(address) ? settledMatch(byAddress.get(address)!) : null) };
    } else if (body.method === "getSignaturesForAddress") result = [];
    else throw Error("Unexpected RPC or attempted transaction: " + body.method);
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  }
  assert.equal(url.hostname, "recovery-db.invalid");
  assert.equal(req.method, "GET", "the fixture must not sign or submit game transactions or create historical jobs");
  if (url.pathname.endsWith("/matches")) {
    return Response.json(indexed ? [...byAddress.values()].map(id => ({ onchain_match_id: String(id) })) : []);
  }
  if (url.pathname.endsWith("/devnet_expenses")) return Response.json(null);
  if (url.pathname.endsWith("/settlement_jobs")) return Response.json(url.searchParams.get("match_id") ? null : oldJob ? [{match_id: "3"}] : []);
  throw Error("Unexpected table");
};
let program: import("@solana/web3.js").PublicKey;
let config: Buffer;
const byAddress = new Map<string, number>();
before(async () => {
  const { PublicKey, Keypair } = await import("@solana/web3.js");
  const {default: bs58} = await import("bs58");
  const signer = Keypair.fromSeed(new Uint8Array(32).fill(19));
  const { matchPda } = await import("@heads-or-tails/game-sdk");
  program = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
  const mint = new PublicKey("DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy");
  Object.assign(process.env, {
    NEXT_PUBLIC_SOLANA_CLUSTER: "devnet",
    NEXT_PUBLIC_HTS_TOKEN_MINT: mint.toBase58(),
    NEXT_PUBLIC_PROJECT_TOKEN_MINT: mint.toBase58(),
    NEXT_PUBLIC_SUPABASE_URL: "https://recovery-db.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-only",
    SOLANA_SERVER_RPC_URL: "https://recovery-rpc.invalid",
    MAINNET_REAL_VALUE_ENABLED: "false",
    NEXT_PUBLIC_DEVNET_SERVICE_SIGNER: signer.publicKey.toBase58(),
    DEVNET_SOL_SPONSOR_SECRET_KEY: bs58.encode(signer.secretKey),
});
config = Buffer.alloc(117);
createHash("sha256").update("account:GameConfig").digest().copy(config, 0, 0, 8);
mint.toBuffer().copy(config, 40);
config.writeBigUInt64LE(BigInt(100), 106);

byAddress.set(matchPda(program, BigInt(3), "hts")[0].toBase58(), 3);
for (let id = 50; id < 100; id++) byAddress.set(matchPda(program, BigInt(id), "hts")[0].toBase58(), id);
});
function account(data: Buffer) {
  return { data: [data.toString("base64"), "base64"], owner: program.toBase58(), executable: false, lamports: 1_000_000, rentEpoch: 0 };
}
function settledMatch(id: number) {
  const data = Buffer.alloc(191);
  createHash("sha256").update("account:Match").digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(BigInt(id), 8);
  data[104] = 1;
  data[113] = 1;
  data[146] = 1;
  data[148] = 1;
  data[181] = 1;
  return account(data);
}
let indexed = false;
let matchReads = 0;
let oldJob = false;
const readIds: Array<number | undefined> = [];

test("settled and missing-history matches count against the per-run scan limit", async () => {
  const { reconcileUnresolved } = await import("./settle");
  const result = await reconcileUnresolved({ lookback: 50, limit: 2 });
  assert.equal(result.checked, 2);
  assert.equal(matchReads, 2);
  assert.equal(result.deferred, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.historyPending.length, 2);
  assert.equal(result.settlementsSubmitted, 0);
});
test("an indexed 50-match window needs no repeated match-account scans", async () => {
  indexed = true;
  matchReads = 0;
  const { reconcileUnresolved } = await import("./settle");
  const result = await reconcileUnresolved({ lookback: 50, limit: 2 });
  assert.equal(result.checked, 0);
  assert.equal(matchReads, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.settlementsSubmitted, 0);
});


test("old durable jobs outside the lookback get a slot before new scans without exceeding the run limit", async () => {
  oldJob = true;
  indexed = false;
  matchReads = 0;
  readIds.length = 0;
  const {reconcileUnresolved} = await import("./settle");
  const result = await reconcileUnresolved({lookback: 50, limit: 3});
  assert.equal(result.checked, 3);
  assert.deepEqual(readIds, [3, 99, 98]);
  assert.deepEqual(result.historyPending, ["3", "99", "98"]);
  assert.equal(result.settlementsSubmitted, 0);
  assert.deepEqual(result.errors, []);
});
