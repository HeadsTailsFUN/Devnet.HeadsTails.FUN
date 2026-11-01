import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, Transaction, TransactionInstruction, TransactionMessage, type VersionedTransactionResponse } from "@solana/web3.js";
import { parseMatchId, U64_MAX } from "../settlement/jobPolicy";
import { devnetEnvironmentAllowed, DEVNET_MINT, DEVNET_PROGRAM_ID } from "../solana/devnetSafety";
import { normalizeSponsorTransaction } from "../solana/sponsorTransaction";
import { DISCRIMINATORS, GAME_PROGRAM_ID, verifySponsorTransaction } from "../solana/sponsorVerify";
import { PublicKey } from "@solana/web3.js";

test("settlement IDs canonicalize decimal aliases and reject unsafe representations", () => {
  for (const bad of [-1, -1.5, Number.MAX_SAFE_INTEGER+1, Infinity, NaN, "", "  ", "0x10", "+1", "1e3", "-1", U64_MAX+BigInt(1), {}, null]) {
    assert.equal(parseMatchId(bad), null, String(bad));
  }
  assert.equal(parseMatchId(" 00042 "), BigInt(42));
  assert.equal(parseMatchId(42), BigInt(42));
  assert.equal(parseMatchId(U64_MAX.toString()), U64_MAX);
});

test("Devnet identity is explicit and conflicting Mainnet signals never mask each other", () => {
  const good = { NEXT_PUBLIC_SOLANA_CLUSTER: "devnet", MAINNET_REAL_VALUE_ENABLED: "false",
    NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED: "false", HEADS_TAILS_PROGRAM_ID: DEVNET_PROGRAM_ID,
    NEXT_PUBLIC_PROJECT_TOKEN_MINT: DEVNET_MINT };
  assert.equal(devnetEnvironmentAllowed(good), true);
  for (const change of [{ NEXT_PUBLIC_SOLANA_CLUSTER: undefined }, { NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta" },
    { NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED: "true" }, { MAINNET_REAL_VALUE_ENABLED: "true" },
    { MAINNET_REAL_VALUE_ENABLED: "TRUE" }, { HEADS_TAILS_PROGRAM_ID: Keypair.generate().publicKey.toBase58() },
    { NEXT_PUBLIC_PROJECT_TOKEN_MINT: Keypair.generate().publicKey.toBase58() }]) {
    assert.equal(devnetEnvironmentAllowed({ ...good, ...change }), false);
  }
});

function fixture(versioned: boolean, separatePayer=false) {
  const player=Keypair.generate().publicKey;
  const payer=separatePayer ? Keypair.generate().publicKey : player;
  const config=Keypair.generate().publicKey;
  const blockhash=Keypair.generate().publicKey.toBase58();
  const instruction=new TransactionInstruction({ programId:new PublicKey(GAME_PROGRAM_ID),
    keys:[{pubkey:player,isSigner:true,isWritable:true},{pubkey:config,isSigner:false,isWritable:true}],
    data:Buffer.from(DISCRIMINATORS.cancel_queue_entry_room,"hex") });
  const lookup=new AddressLookupTableAccount({key:Keypair.generate().publicKey,state:{
    deactivationSlot:U64_MAX,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses:[config] }});
  const message=versioned
    ? new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[instruction]}).compileToV0Message([lookup])
    : new Transaction({feePayer:payer,recentBlockhash:blockhash}).add(instruction).compileMessage();
  const loaded="addressTableLookups" in message ? {
    writable:message.addressTableLookups.flatMap(l => l.writableIndexes.map(n => lookup.state.addresses[n])),
    readonly:message.addressTableLookups.flatMap(l => l.readonlyIndexes.map(n => lookup.state.addresses[n])),
  } : undefined;
  const tx={transaction:{message,signatures:[]},meta:{loadedAddresses:loaded}} as unknown as VersionedTransactionResponse;
  return {player,payer,config,...normalizeSponsorTransaction(tx)};
}

for (const versioned of [false,true]) {
  test(`${versioned ? "v0 lookup" : "legacy"} transactions preserve actual player and fee-payer binding`, () => {
    const f=fixture(versioned);
    const verify=(expectedWallet: string, txWallet=f.accountKeys[0]) => verifySponsorTransaction({
      action:"cancel",expectedWallet,txWallet,topLevel:f.topLevel,accountKeys:f.accountKeys,
      preBalances:f.accountKeys.map(() => 100_000_000),postBalances:f.accountKeys.map((_,n) => n===0 ? 99_995_000 : 100_000_000),feeLamports:5000 });
    assert.equal(verify(f.player.toBase58()).ok,true);
    assert.equal(verify(f.config.toBase58()).ok,false);
    // Even a falsified txWallet field cannot bypass the independently resolved keys.
    assert.equal(verify(f.config.toBase58(),f.config.toBase58()).ok,false);
    const separate=fixture(versioned,true);
    for (const claimant of [separate.player,separate.payer]) {
      assert.equal(verifySponsorTransaction({action:"cancel",expectedWallet:claimant.toBase58(),
        txWallet:separate.accountKeys[0],topLevel:separate.topLevel,accountKeys:separate.accountKeys,
        preBalances:[],postBalances:[],feeLamports:5000}).ok,false);
    }
  });
}
