import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AnchorProvider, BN, Program, BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { createMatchNonce, deriveMatchSeed } from "../src/vrf.js";
import { GameClient, PROGRAM_ID } from "../src/client.js";
import { configPda, oraoRandomnessPda } from "../src/pdas.js";
import idl from "../src/idl.json" with { type: "json" };
import type { HeadsOrTails } from "../src/idl-types.js";

const programId = PROGRAM_ID;
const nonce = new Uint8Array(32).fill(1);

test("nonce seeds bind domain, program, u64 LE counter and all 32 nonce bytes", async () => {
  const id = Buffer.alloc(8); id.writeBigUInt64LE(42n);
  const expected = createHash("sha256").update(Buffer.concat([
    Buffer.from("heads-or-tails-vrf-v2"), programId.toBuffer(), id, Buffer.from(nonce),
  ])).digest();
  assert.deepEqual(await deriveMatchSeed(programId, 42n, nonce), expected);
  assert.equal(expected.toString("hex"),"39a97ddc21487b683a03c473c0ffb4a52e41fb4f84af96dd534641f15bbdb332");
  assert.notDeepEqual(expected, await deriveMatchSeed(programId, 43n, nonce));
  assert.notDeepEqual(expected, await deriveMatchSeed(programId, 42n, new Uint8Array(32).fill(2)));
  assert.notDeepEqual(expected, await deriveMatchSeed(PublicKey.default, 42n, nonce));
  assert.notDeepEqual(oraoRandomnessPda(expected)[0], oraoRandomnessPda(await deriveMatchSeed(programId,42n,new Uint8Array(32).fill(2)))[0]);
  for (const bad of [new Uint8Array(0), new Uint8Array(31).fill(1), new Uint8Array(33).fill(1),new Uint8Array(32)]) {
    await assert.rejects(deriveMatchSeed(programId,42n,bad));
  }
  for (const bad of [-1n, 1n << 64n]) await assert.rejects(deriveMatchSeed(programId,bad,nonce));
  assert.equal((await deriveMatchSeed(programId,(1n<<64n)-1n,nonce)).length,32);
});

test("default nonce uses the runtime CSPRNG and is not shared between attempts", () => {
  const a = createMatchNonce(), b = createMatchNonce();
  assert.equal(a.length,32); assert.ok(a.some(Boolean));
  assert.notDeepEqual(a,b);
});

test("legacy and room SDK builders encode the new ABI and exact ORAO PDA without network I/O", async () => {
  const connection = new Connection("http://127.0.0.1:1");
  connection.getAccountInfo = async () => { throw new Error("Unexpected network read"); };
  const provider = new AnchorProvider(connection,{publicKey:PublicKey.default} as Wallet,{});
  const program = new Program<HeadsOrTails>(idl as HeadsOrTails,provider);
  const client = new GameClient(program, configPda(programId)[0]);
  const pk = new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR");
  const coder = new BorshInstructionCoder(program.idl);
  for (const room of [false,true]) {
    const built = room
      ? await client.matchNextRoomTx(pk,42n,10,pk,pk,pk,pk,pk,nonce)
      : await client.matchNextTx(pk,42n,pk,pk,pk,pk,pk,nonce);
    const ix = ("instructions" in built.tx ? built.tx.instructions[0] : null)!;
    assert.ok(ix);
    const offset = room ? 17 : 16;
    assert.equal(ix.data.length,offset+32);
    assert.equal(ix.data.readBigUInt64LE(8),42n);
    if (room) assert.equal(ix.data[16],10);
    assert.deepEqual(ix.data.subarray(offset),Buffer.from(nonce));
    assert.ok(ix.keys[room ? 11 : 10].pubkey.equals(oraoRandomnessPda(await deriveMatchSeed(programId,42n,nonce))[0]));
    assert.ok(ix.keys[1].pubkey.equals(client.config));
    const decoded = coder.decode(ix.data)!;
    assert.equal(decoded.name,room ? "matchNextRoom" : "matchNext");
    assert.deepEqual((decoded.data as {nonce:number[]}).nonce,Array.from(nonce));
    assert.throws(() => coder.decode(ix.data.subarray(0,offset)));
  }
  // The existing discriminator is retained; short old data is rejected by the new ABI.
  assert.equal(coder.encode("matchNext",{matchId:new BN(42),nonce:Array.from(nonce)}).length,48);
});
