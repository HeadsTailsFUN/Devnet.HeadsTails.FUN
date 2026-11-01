import '../test/hts-release-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { gameIdlJson } from '@heads-or-tails/game-sdk';
import { devnetEnvironmentAllowed, assertDevnetConnection, DEVNET_GENESIS, DEVNET_PROGRAM_ID } from './devnetSafety';
import { HTS_TOKEN_MINT, LEGACY_TOKEN_MINT, validHtsMint, validServiceSigner, OWNER_AUTHORITY, DEPLOYMENT_PAYER } from './releaseToken';
const env={NEXT_PUBLIC_SOLANA_CLUSTER:'devnet',NEXT_PUBLIC_HTS_TOKEN_MINT:HTS_TOKEN_MINT,NEXT_PUBLIC_PROJECT_TOKEN_MINT:HTS_TOKEN_MINT,MAINNET_REAL_VALUE_ENABLED:'false',NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED:'false'};
test('release gate requires a new mint, matching bindings, explicit Devnet and Mainnet disabled',()=>{
 assert.equal(devnetEnvironmentAllowed(env),true);
 for(const delta of [{NEXT_PUBLIC_HTS_TOKEN_MINT:''},{NEXT_PUBLIC_HTS_TOKEN_MINT:LEGACY_TOKEN_MINT,NEXT_PUBLIC_PROJECT_TOKEN_MINT:LEGACY_TOKEN_MINT},{NEXT_PUBLIC_PROJECT_TOKEN_MINT:LEGACY_TOKEN_MINT},{NEXT_PUBLIC_SOLANA_CLUSTER:'mainnet-beta'},{NEXT_PUBLIC_SOLANA_CLUSTER:undefined},{MAINNET_REAL_VALUE_ENABLED:'true'},{NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED:'true'},{HEADS_TAILS_PROGRAM_ID:SystemProgram.programId.toBase58()}])assert.equal(devnetEnvironmentAllowed({...env,...delta}),false);
});
test('deployment, authority, historical sponsor and staging identities cannot be the new service signer',()=>{
 for(const address of ['',LEGACY_TOKEN_MINT,PublicKey.default.toBase58(),OWNER_AUTHORITY,DEPLOYMENT_PAYER,'11111111111111111111111111111112','FwP4JekrFhJ2PksQXdi4DhiPTfVvYTkgpnjJTwaW2nY8'])assert.equal(validServiceSigner(address),false);
 assert.equal(validHtsMint(HTS_TOKEN_MINT),true);assert.equal(validServiceSigner(HTS_TOKEN_MINT),false);
 assert.equal(validServiceSigner(new PublicKey(new Uint8Array(32).fill(7)).toBase58()),true);
});
test('spending guard checks actual RPC genesis, config owner, discriminator, size and immutable mint',async()=>{
 const original={...process.env};Object.assign(process.env,env);
 try{
  const data=Buffer.alloc(117);Buffer.from(gameIdlJson.accounts.find(a=>a.name==='GameConfig')!.discriminator).copy(data);new PublicKey(HTS_TOKEN_MINT).toBuffer().copy(data,40);
  const cfg={owner:new PublicKey(DEVNET_PROGRAM_ID),data};let genesis=DEVNET_GENESIS;
  const rpc={getGenesisHash:async()=>genesis,getAccountInfo:async()=>cfg} as never;
  await assertDevnetConnection(rpc);genesis='wrong-chain';await assert.rejects(assertDevnetConnection(rpc),/identity/);genesis=DEVNET_GENESIS;
  cfg.owner=SystemProgram.programId;await assert.rejects(assertDevnetConnection(rpc),/binding/);cfg.owner=new PublicKey(DEVNET_PROGRAM_ID);
  cfg.data=Buffer.alloc(117);await assert.rejects(assertDevnetConnection(rpc),/binding/);cfg.data=Buffer.from(data);new PublicKey(LEGACY_TOKEN_MINT).toBuffer().copy(cfg.data,40);await assert.rejects(assertDevnetConnection(rpc),/binding/);cfg.data=data.subarray(0,116);await assert.rejects(assertDevnetConnection(rpc),/binding/);
 }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
