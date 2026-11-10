/** Synthetic in-memory signing fixtures only. No network, wallet files or broadcasts. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {Keypair,PublicKey,SystemProgram,Transaction,TransactionMessage,VersionedTransaction} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {getConnectMethod,getSignMethod} from "./walletStandard";
import {signMessageBytes} from "./signMessage";
import {createWalletConnectWallet,approvedWalletConnectAccount,WC_DEVNET_CHAIN,WC_DEVNET_CHAINS,WC_METHODS,type WalletConnectSession,type WalletConnectTransport} from "./walletConnectBridge";
const a=Keypair.fromSeed(new Uint8Array(32).fill(7)),b=Keypair.fromSeed(new Uint8Array(32).fill(8));
const session=():WalletConnectSession=>({topic:"synthetic-devnet-session",expiry:Math.floor(Date.now()/1000)+3600,namespaces:{solana:{accounts:[`${WC_DEVNET_CHAIN}:${a.publicKey}`],methods:[...WC_METHODS]}}});
function fixture(){
  let current:WalletConnectSession|undefined=session(),connects=0,requests=0;
  const listeners=new Set<()=>void>();
  let respond:(method:string,params:Record<string,unknown>)=>Promise<unknown>=async(method,params)=>{
    if(method==="solana_signMessage")return {signature:bs58.encode(nacl.sign.detached(bs58.decode(String(params.message)),a.secretKey))};
    const tx=VersionedTransaction.deserialize(Buffer.from(String(params.transaction),"base64"));tx.sign([a]);
    return {transaction:Buffer.from(tx.serialize()).toString("base64")};
  };
  const transport:WalletConnectTransport={session:()=>current,connect:async()=>{connects++;current=session();return current;},disconnect:async()=>{current=undefined;for(const cb of listeners)cb();},
    request:async(method,params,chain)=>{requests++;assert.equal(chain,WC_DEVNET_CHAIN);assert.equal(params.pubkey,a.publicKey.toBase58());return respond(method,params);},
    onChange:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);}}};
  return {wallet:createWalletConnectWallet(transport),setSession:(s:WalletConnectSession|undefined)=>{current=s;for(const cb of listeners)cb();},respond:(fn:typeof respond)=>{respond=fn;},counts:()=>({connects,requests})};
}
async function connected(){const f=fixture();const {accounts}=await getConnectMethod(f.wallet)!();return {...f,account:accounts[0],sign:getSignMethod(f.wallet)!};}
function legacy(){return new Transaction({feePayer:a.publicKey,recentBlockhash:"11111111111111111111111111111111"}).add(SystemProgram.transfer({fromPubkey:a.publicKey,toPubkey:b.publicKey,lamports:1}));}
const bytes=(tx:Transaction)=>tx.serialize({requireAllSignatures:false,verifySignatures:false});

test("Devnet approval requires the exact chain, a valid account, expiry and both methods",()=>{
  assert.equal(approvedWalletConnectAccount(session()).address,a.publicKey.toBase58());
  const wrong=session();wrong.namespaces.solana.accounts=[`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${a.publicKey}`];
  assert.throws(()=>approvedWalletConnectAccount(wrong));
  const missing=session();missing.namespaces.solana.methods=["solana_signTransaction"];assert.throws(()=>approvedWalletConnectAccount(missing));
  assert.throws(()=>approvedWalletConnectAccount({...session(),expiry:0}));
  const multi=session();multi.namespaces.solana.accounts.push(`${WC_DEVNET_CHAIN}:${b.publicKey}`);assert.throws(()=>approvedWalletConnectAccount(multi));
});
test("chain-qualified and mixed-chain approvals expose only the single Devnet account", () => {
  const current = session();
  const legacyChain = WC_DEVNET_CHAINS[1];
  current.namespaces = {
    [legacyChain]: { accounts: [`${legacyChain}:${a.publicKey}`], methods: [...WC_METHODS] },
    solana: { accounts: [`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${b.publicKey}`], methods: [...WC_METHODS] },
  };
  assert.equal(approvedWalletConnectAccount(current).address, a.publicKey.toBase58());
  current.namespaces.solana.accounts.push(`${WC_DEVNET_CHAIN}:${a.publicKey}`);
  assert.equal(approvedWalletConnectAccount(current).address, a.publicKey.toBase58());
  current.namespaces.solana.accounts.push(`${WC_DEVNET_CHAIN}:${b.publicKey}`);
  assert.throws(() => approvedWalletConnectAccount(current), { code: "WALLETCONNECT_ACCOUNT_AMBIGUOUS" });
});
test("a method approved on another chain does not authorize Devnet signing", () => {
  const current = session();
  const mainnet = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  current.namespaces = {
    [WC_DEVNET_CHAIN]: { accounts: [`${WC_DEVNET_CHAIN}:${a.publicKey}`], methods: ["solana_signTransaction"] },
    [mainnet]: { accounts: [`${mainnet}:${a.publicKey}`], methods: [...WC_METHODS] },
  };
  assert.throws(() => approvedWalletConnectAccount(current), { code: "WALLETCONNECT_SIGNING_REQUIRED" });
});
test("requests use the approved Devnet alias and invalidate an alias change during approval", async () => {
  const legacyChain = WC_DEVNET_CHAINS[1];
  const current = session();
  current.namespaces.solana.accounts = [`${legacyChain}:${a.publicKey}`];
  const requestedChains: string[] = [];
  const wallet = createWalletConnectWallet({
    session: () => current,
    connect: async () => current,
    disconnect: async () => {},
    request: async (_method, params, chain) => {
      requestedChains.push(chain);
      if (requestedChains.length === 2) current.namespaces.solana.accounts.push(`${WC_DEVNET_CHAIN}:${a.publicKey}`);
      return { signature: bs58.encode(nacl.sign.detached(bs58.decode(String(params.message)), a.secretKey)) };
    },
    onChange: () => () => {},
  });
  const { accounts: [account] } = await getConnectMethod(wallet)!();
  assert.equal((await signMessageBytes(wallet, account, new Uint8Array([1]))).length, 64);
  await assert.rejects(signMessageBytes(wallet, account, new Uint8Array([2])), /account changed/);
  assert.equal((await signMessageBytes(wallet, account, new Uint8Array([3]))).length, 64);
  assert.deepEqual(requestedChains, [legacyChain, legacyChain, WC_DEVNET_CHAIN]);
});
test("silent restore never creates a pairing and rejects missing/expired authorization",async()=>{
  const f=fixture();await getConnectMethod(f.wallet)!({silent:true});assert.equal(f.counts().connects,0);
  f.setSession(undefined);await assert.rejects(getConnectMethod(f.wallet)!({silent:true}));assert.equal(f.counts().connects,0);
});
test("ownership signing uses Devnet and verifies the exact challenge signature",async()=>{
  const f=await connected(),message=new TextEncoder().encode("Synthetic HeadsTails ownership challenge");
  const signature=await signMessageBytes(f.wallet,f.account,message);assert(nacl.sign.detached.verify(message,signature,a.publicKey.toBytes()));
  f.respond(async()=>({signature:bs58.encode(new Uint8Array(64))}));await assert.rejects(signMessageBytes(f.wallet,f.account,message),/invalid ownership signature/);
});
test("legacy and v0 signing return verified bytes without broadcasting",async()=>{
  const f=await connected();
  const v0=new VersionedTransaction(new TransactionMessage({payerKey:a.publicKey,recentBlockhash:"11111111111111111111111111111111",instructions:legacy().instructions}).compileToV0Message());
  for(const original of [bytes(legacy()),v0.serialize()]){
    const out=await f.sign({account:f.account,chain:"solana:devnet",transaction:original});
    const tx=VersionedTransaction.deserialize(out[0].signedTransaction);assert(nacl.sign.detached.verify(tx.message.serialize(),tx.signatures[0],a.publicKey.toBytes()));
    assert.deepEqual(tx.message.serialize(),VersionedTransaction.deserialize(original).message.serialize());
  }
  assert.equal(f.wallet.features["solana:signAndSendTransaction"],undefined);assert.equal(f.counts().requests,2);
});
test("signature-only wallet responses preserve preexisting co-signer approvals",async()=>{
  const f=await connected(),tx=legacy().add(SystemProgram.transfer({fromPubkey:b.publicKey,toPubkey:a.publicKey,lamports:1}));tx.partialSign(b);
  const original=bytes(tx),before=VersionedTransaction.deserialize(original);
  f.respond(async(_method,params)=>({signature:bs58.encode(nacl.sign.detached(VersionedTransaction.deserialize(Buffer.from(String(params.transaction),"base64")).message.serialize(),a.secretKey))}));
  const out=await f.sign({account:f.account,chain:"solana:devnet",transaction:original}),signed=VersionedTransaction.deserialize(out[0].signedTransaction);
  assert.deepEqual(signed.signatures[1],before.signatures[1]);
});
test("modified transaction messages and erased co-signer signatures are rejected",async()=>{
  const f=await connected();
  f.respond(async()=>{const changed=legacy();changed.instructions=[SystemProgram.transfer({fromPubkey:a.publicKey,toPubkey:new PublicKey("11111111111111111111111111111111"),lamports:99})];changed.partialSign(a);return {transaction:Buffer.from(bytes(changed)).toString("base64")};});
  await assert.rejects(f.sign({account:f.account,transaction:bytes(legacy()),chain:"solana:devnet"}),/changed the reviewed transaction/);
  const original=legacy().add(SystemProgram.transfer({fromPubkey:b.publicKey,toPubkey:a.publicKey,lamports:1}));original.partialSign(b);
  f.respond(async(_m,params)=>{const changed=VersionedTransaction.deserialize(Buffer.from(String(params.transaction),"base64"));changed.signatures[1]=new Uint8Array(64);changed.sign([a]);return {transaction:Buffer.from(changed.serialize()).toString("base64")};});
  await assert.rejects(f.sign({account:f.account,transaction:bytes(original),chain:"solana:devnet"}),/another signer's approval/);
});
test("wrong chain, account substitution and a non-signer fail before requesting approval",async()=>{
  const f=await connected();
  await assert.rejects(f.sign({account:f.account,transaction:bytes(legacy()),chain:"solana:mainnet"}),/restricted to Solana Devnet/);
  await assert.rejects(f.sign({account:{...f.account,publicKey:b.publicKey.toBytes()},transaction:bytes(legacy())}),/account changed/);
  const other=new Transaction({feePayer:b.publicKey,recentBlockhash:"11111111111111111111111111111111"}).add(SystemProgram.transfer({fromPubkey:b.publicKey,toPubkey:a.publicKey,lamports:1}));
  await assert.rejects(f.sign({account:f.account,transaction:bytes(other)}),/not a required/);assert.equal(f.counts().requests,0);
});
test("revocation and account changes invalidate the context and in-flight approvals",async()=>{
  const f=await connected();let changes=0;
  const events=f.wallet.features["standard:events"] as {on:(event:string,cb:()=>void)=>()=>void};events.on("change",()=>{changes++;});
  f.respond(async(_m,params)=>{const next=session();next.namespaces.solana.accounts=[`${WC_DEVNET_CHAIN}:${b.publicKey}`];f.setSession(next);return {signature:bs58.encode(nacl.sign.detached(bs58.decode(String(params.message)),a.secretKey))};});
  await assert.rejects(signMessageBytes(f.wallet,f.account,new Uint8Array([1,2,3])),/account changed/);
  assert.equal(f.wallet.accounts[0].address,b.publicKey.toBase58());f.setSession(undefined);assert.equal(f.wallet.accounts.length,0);assert(changes>=2);
});
test("a cancelled pairing creates no account and requests no signature",async()=>{
  let requests=0;
  const wallet=createWalletConnectWallet({session:()=>undefined,connect:async()=>{throw Error("Connection cancelled");},disconnect:async()=>undefined,request:async()=>{requests++;},onChange:()=>()=>undefined});
  await assert.rejects(getConnectMethod(wallet)!(),/cancelled/);assert.equal(wallet.accounts.length,0);assert.equal(requests,0);
});
test("concurrent approvals are rejected and the request lock clears after completion or failure",async()=>{
  const f=await connected(),message=new Uint8Array([1,2,3]);let finish:(value:unknown)=>void=()=>undefined;
  f.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const first=signMessageBytes(f.wallet,f.account,message);
  await assert.rejects(signMessageBytes(f.wallet,f.account,message),/already pending/);
  finish({signature:bs58.encode(nacl.sign.detached(message,a.secretKey))});assert.equal((await first).length,64);
  f.respond(async()=>{throw Error("User rejected request");});await assert.rejects(signMessageBytes(f.wallet,f.account,message),/rejected/);
  f.respond(async()=>({signature:bs58.encode(nacl.sign.detached(message,a.secretKey))}));assert.equal((await signMessageBytes(f.wallet,f.account,message)).length,64);
});
