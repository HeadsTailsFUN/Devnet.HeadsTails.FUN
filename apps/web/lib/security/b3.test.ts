import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { deriveMatchSeed } from "@heads-or-tails/game-sdk";
import { DISCRIMINATORS, GAME_PROGRAM_ID, deriveVrfSeed, deriveVrfSeedForInstruction,
  deriveRandomnessPda, expectedPdasForAction } from "../solana/sponsorVerify";

for (const room of [false,true]) {
  test(`${room ? "room" : "legacy"} receipt seed parsing preserves old history and accepts nonce ABI`, async () => {
    const old = Buffer.alloc(room ? 17 : 16);
    Buffer.from(room ? DISCRIMINATORS.match_next_room : DISCRIMINATORS.match_next,"hex").copy(old);
    old.writeBigUInt64LE(BigInt(42),8);
    if (room) old[16]=10;
    const nonce=new Uint8Array(32).fill(7);
    const current=Buffer.concat([old,Buffer.from(nonce)]);
    assert.deepEqual(deriveVrfSeedForInstruction(GAME_PROGRAM_ID,old),deriveVrfSeed(GAME_PROGRAM_ID,BigInt(42)));
    const seed=await deriveMatchSeed(new PublicKey(GAME_PROGRAM_ID),BigInt(42),nonce);
    assert.deepEqual(deriveVrfSeedForInstruction(GAME_PROGRAM_ID,current),seed);
    assert.ok(expectedPdasForAction({action:"match",wallet:PublicKey.default.toBase58(),gameData:current})
      .includes(deriveRandomnessPda(seed)));
    for (const data of [current.subarray(0,current.length-1),Buffer.concat([current,Buffer.of(1)]),Buffer.concat([old,Buffer.alloc(32)])]) {
      assert.throws(()=>deriveVrfSeedForInstruction(GAME_PROGRAM_ID,data));
    }
  });
}

test("all new-match entry points validate denomination before transfer or state mutation", () => {
  // Supplemental wiring regression. Runtime rollback/CPI behavior requires validator tests.
  for (const file of ["instructions","rooms"]) {
    const source=readFileSync(`../../programs/heads-or-tails/src/${file}.rs`,"utf8");
    const join=source.slice(source.indexOf(`pub fn handle_join_queue${file === "rooms" ? "_room" : ""}(`));
    assert.ok(join.indexOf("denomination::validate_stake(tier_usd, stake_amount)?") < join.indexOf("token::transfer_checked("));
    const match=source.slice(source.indexOf(`pub fn handle_match_next${file === "rooms" ? "_room" : ""}(`));
    for (const side of ["heads","tails"]) {
      assert.ok(match.includes(`denomination::validate_stake(${file === "rooms" ? "tier_usd" : "TIER_1_USD"}, ${side}_entry.amount)?`));
    }
    assert.ok(match.includes("vrf::match_seed(match_id, &nonce)?"));
    assert.ok(match.includes("orao_solana_vrf::cpi::request_v2("));
    assert.ok(!match.includes("if ctx.accounts.randomness.data_is_empty()"));
  }
});

test("settlement reads stored seeds and existing exact refund/pot paths stay in place", () => {
  const settle=readFileSync("lib/settlement/settle.ts","utf8");
  assert.ok(!settle.includes("heads-or-tails-vrf-v1"));
  assert.ok(settle.includes("Buffer.from(m.seed"));
  const legacy=readFileSync("../../programs/heads-or-tails/src/instructions.rs","utf8");
  const room=readFileSync("../../programs/heads-or-tails/src/rooms.rs","utf8");
  assert.ok(legacy.includes("let amount = entry.amount;"));
  assert.ok(room.includes("let amount = entry.amount;"));
  assert.ok(legacy.includes("game_match.total_pot"));
});
