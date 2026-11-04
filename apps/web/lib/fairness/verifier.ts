import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import gameIdl from "../../../../packages/game-sdk/src/idl.json";

export const PROGRAM = "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
export const MINT = "HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4";
export const ORAO = "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const DEFAULT_RPC = "https://api.devnet.solana.com";
export const SOURCE_URL = "https://github.com/HeadsTailsFUN/Devnet.HeadsTails.FUN/blob/1e4eaeed5425fd98ce89f14033b468e198a9f35d/programs/heads-or-tails/src/vrf.rs";
export type Status = "VERIFIED" | "NOT VERIFIED" | "PENDING" | "UNAVAILABLE";
export interface Rpc { call(method: string, params: unknown[]): Promise<any> }
export interface Verification {
  status: Status; reason: string; checks: string[]; network: "devnet";
  matchId?: string; matchAddress?: string; room?: number; heads?: string; tails?: string;
  headsStake?: string; tailsStake?: string; pot?: string; seed?: string;
  randomnessAddress?: string; randomnessOwner?: string; randomnessHex?: string;
  firstByte?: number; firstHex?: string; binary?: string; bit?: number; calculated?: "HEADS"|"TAILS";
  calculatedWinner?: string; recordedResult?: string|null; recordedWinner?: string|null;
  settledSlot?: string|null; state?: string; settlementSignature?: string; payoutRecipient?: string; payout?: string;
  evidenceFingerprint?: string; sourceCorrespondence: string; cryptographicProof: string;
}
class Contradiction extends Error {}
class Unsupported extends Error {}
class RpcUnavailable extends Error {}
function check(condition:unknown,message:string): asserts condition {if(!condition)throw new Contradiction(message);}
const text=new TextEncoder();
const eq=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
export function formatHts(raw:string):string {const n=BigInt(raw),whole=n/BigInt(1000000),fraction=(n%BigInt(1000000)).toString().padStart(6,"0").replace(/0+$/,"");return `${whole}${fraction?'.'+fraction:''} HTS`;}
function u64(n:bigint){const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,n,true);return b;}
function pda(label:string,...seeds:Uint8Array[]){return PublicKey.findProgramAddressSync([text.encode(label),...seeds],new PublicKey(PROGRAM))[0].toBase58();}
export function matchAddress(id:bigint){return pda("hts-match",u64(id));}
export function randomnessAddress(seed:Uint8Array){return PublicKey.findProgramAddressSync([text.encode("orao-vrf-randomness-request"),seed],new PublicKey(ORAO))[0].toBase58();}
export function outcome(randomness:Uint8Array){if(randomness.length!==64)throw new Contradiction("Expected exactly 64 randomness bytes");return randomness[0]&1?"TAILS" as const:"HEADS" as const;}
class Reader {
  offset=0;
  constructor(readonly bytes:Uint8Array){}
  take(n:number){if(n<0||this.offset+n>this.bytes.length)throw new Unsupported("Truncated account layout");const v=this.bytes.slice(this.offset,this.offset+n);this.offset+=n;return v;}
  byte(){return this.take(1)[0];}
  int(){const b=this.take(8);return new DataView(b.buffer,b.byteOffset,8).getBigUint64(0,true);}
  uint(){const b=this.take(4);return new DataView(b.buffer,b.byteOffset,4).getUint32(0,true);}
  pubkey(){return new PublicKey(this.take(32)).toBase58();}
}
const idl:any=gameIdl;
function decodeType(r:Reader,t:any):any {
  if(t==="u64")return r.int().toString();if(t==="u8")return r.byte();if(t==="pubkey")return r.pubkey();
  if(t==="bool"){const value=r.byte();check(value<=1,"Invalid account boolean");return value===1;}
  if(t?.array){if(t.array[0]!=="u8")throw new Unsupported("Unsupported IDL array");return r.take(t.array[1]);}
  if(t?.option){const tag=r.byte();if(tag>1)throw new Contradiction("Invalid account option tag");return tag?decodeType(r,t.option):null;}
  if(t?.defined){const d=idl.types.find((x:any)=>x.name===t.defined.name)?.type;if(!d)throw new Unsupported("Unknown IDL type");if(d.kind==="enum"){const v=d.variants[r.byte()];if(!v)throw new Contradiction("Invalid account enum tag");if(v.fields?.length)throw new Unsupported("Unsupported game enum version");return v.name;}if(d.kind==="struct")return Object.fromEntries(d.fields.map((f:any)=>[f.name,decodeType(r,f.type)]));}
  throw new Unsupported("Unsupported account version");
}
function maxSize(t:any):number{if(t==="u64")return 8;if(t==="u8"||t==="bool")return 1;if(t==="pubkey")return 32;if(t.array)return t.array[1]*maxSize(t.array[0]);if(t.option)return 1+maxSize(t.option);if(t.defined){const type=idl.types.find((x:any)=>x.name===t.defined.name)?.type;if(type?.kind==="enum"&&type.variants.every((v:any)=>!v.fields?.length))return 1;if(type?.kind==="struct")return type.fields.reduce((sum:number,f:any)=>sum+maxSize(f.type),0);}throw new Unsupported("Unsupported account schema");}
function decodeAccount(name:string,bytes:Uint8Array){const account=idl.accounts.find((a:any)=>a.name===name);if(!account)throw new Unsupported("Missing pinned account schema");const r=new Reader(bytes);check(eq(r.take(8),new Uint8Array(account.discriminator)),`Wrong ${name} discriminator`);if(bytes.length!==8+maxSize({defined:{name}}))throw new Unsupported(`Unsupported ${name} account size`);return decodeType(r,{defined:{name}});}

/** Borsh sequence from orao-solana-vrf 0.7.0 src/state/randomness_v2.rs.
 * Discriminator = sha256("account:RandomnessV2")[0..8]. See schema provenance.
 * Parse fields in declared order, not an unverified randomness byte offset. */
export function decodeOrao(bytes:Uint8Array,owner:string,seed:Uint8Array){
  check(owner===ORAO,"Wrong ORAO program owner");const r=new Reader(bytes);
  check(eq(r.take(8),new Uint8Array([139,239,184,215,227,86,191,226])),"Wrong RandomnessV2 discriminator");
  const tag=r.byte(),client=r.pubkey(),storedSeed=r.take(32);check(eq(seed,storedSeed),"ORAO seed does not match the Match PDA");
  if(tag===0){const responses=r.uint();if(responses>7)throw new Contradiction("Invalid pending ORAO response count");r.take(responses*(32+64));return {pending:true as const,client};}
  if(tag!==1)throw new Unsupported("Unsupported ORAO account variant");
  const randomness=r.take(64);if(r.offset!==bytes.length)throw new Unsupported("Unsupported fulfilled ORAO account size");return {pending:false as const,client,randomness};
}
export function createRpc(endpoint:string):Rpc {
  const url=new URL(endpoint);if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["127.0.0.1","localhost"].includes(url.hostname)))throw new Error("Use an HTTPS RPC endpoint");
  if(url.username||url.password)throw new Error("Do not enter credentials in an RPC URL");
  const methods=new Set(["getGenesisHash","getAccountInfo","getSignaturesForAddress","getTransaction"]);
  return {async call(method,params){if(!methods.has(method))throw new Error("Verifier is read-only");const response=await fetch(url,{method:"POST",credentials:"omit",referrerPolicy:"no-referrer",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new RpcUnavailable(`RPC HTTP ${response.status} while reading ${method}. Choose another endpoint or retry.`);const body=await response.json();if(body.error)throw new RpcUnavailable(`RPC error ${typeof body.error.code==='number'?body.error.code:'unknown'} while reading ${method}.`);return body.result;}};
}
async function account(rpc:Rpc,address:string,headerOnly=false){const response=await rpc.call("getAccountInfo",[address,{encoding:"base64",commitment:"finalized",...(headerOnly?{dataSlice:{offset:0,length:45}}:{})}]);const value=response?.value;if(!value)throw new Unsupported(`Account unavailable: ${address}`);if(!Array.isArray(value.data)||value.data[1]!=="base64")throw new Unsupported("Unsupported account encoding");return {...value,bytes:Uint8Array.from(atob(value.data[0]),c=>c.charCodeAt(0))};}
async function programBinding(rpc:Rpc,programId:string,expectedSlot:string){const loader="BPFLoaderUpgradeab1e11111111111111111111111",program=await account(rpc,programId);check(program.executable&&program.owner===loader&&program.bytes.length===36,"Wrong or non-executable program");const r=new Reader(program.bytes);check(r.uint()===2,"Wrong executable program state");const header=await account(rpc,r.pubkey(),true);check(header.owner===loader&&!header.executable,"Wrong ProgramData owner");const data=new Reader(header.bytes);check(data.uint()===3,"Wrong ProgramData state");if(data.int().toString()!==expectedSlot)throw new Unsupported(`${programId===PROGRAM?'HeadsTails':'ORAO'} was upgraded after the pinned verifier release. Review the executable and decoder before verifying.`);}
function ata(wallet:string){return PublicKey.findProgramAddressSync([new PublicKey(wallet).toBytes(),new PublicKey(TOKEN).toBytes(),new PublicKey(MINT).toBytes()],new PublicKey(ATA_PROGRAM))[0].toBase58();}
function key(account:any){return typeof account==="string"?account:account.pubkey;}
async function payout(rpc:Rpc,m:any,address:string,randomness:string,winner:string){
  let before:string|undefined;let tx:any=null,signature="";
  for(let page=0;page<3&&!tx;page++){
    const rows=await rpc.call("getSignaturesForAddress",[address,{limit:30,commitment:"finalized",...(before?{before}:{})}]);if(!Array.isArray(rows))throw new Unsupported("Transaction history unavailable");
    for(const s of rows){if(String(s.slot)!==m.settled_slot||s.err)continue;const candidate=await rpc.call("getTransaction",[s.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);if(candidate){tx=candidate;signature=s.signature;break;}}
    if(rows.length<30)break;before=rows.at(-1).signature;
  }
  if(!tx?.meta)throw new Unsupported("Original settlement transaction metadata unavailable");check(tx.meta.err===null,"Settlement transaction failed");check(String(tx.slot)===m.settled_slot,"Settlement slot mismatch");check(tx.transaction.signatures[0]===signature,"Settlement signature mismatch");
  const ixDef=idl.instructions.find((i:any)=>i.name==="settle_hts_match");if(!ixDef)throw new Unsupported("Missing settlement IDL");
  const instructions=tx.transaction.message.instructions.filter((i:any)=>i.programId===PROGRAM&&i.data&&eq(bs58.decode(i.data).slice(0,8),new Uint8Array(ixDef.discriminator)));
  check(instructions.length===1,"Expected exactly one HTS settlement instruction");const instruction=instructions[0],data=bs58.decode(instruction.data);check(data.length===16&&new Reader(data.slice(8)).int().toString()===m.id,"Settlement match identity mismatch");
  const accounts=Object.fromEntries(ixDef.accounts.map((a:any,i:number)=>[a.name,instruction.accounts[i]]));const destination=ata(winner),vault=pda("hts-vault"),authority=pda("hts-vault-authority");
  for(const [name,value]of Object.entries({config:pda("hts-config"),game_match:address,randomness,heads_state:pda("hts-player",new PublicKey(m.heads_player).toBytes()),tails_state:pda("hts-player",new PublicKey(m.tails_player).toBytes()),project_mint:MINT,vault,vault_authority:authority,winner_tokens:destination,token_program:TOKEN}))check(accounts[name]===value,`Settlement ${name} binding mismatch`);
  const inner=tx.meta.innerInstructions?.find((i:any)=>i.index===tx.transaction.message.instructions.indexOf(instruction))?.instructions??[];
  const transfers=inner.filter((i:any)=>i.programId===TOKEN&&i.parsed?.type==="transferChecked"&&i.parsed.info.source===vault);
  check(transfers.length===1,"Missing or ambiguous token payout instruction");const info=transfers[0].parsed.info;
  check(info.destination===destination&&info.mint===MINT&&info.authority===authority,"Wrong payout token destination, mint or authority");check(info.tokenAmount?.amount===m.total_pot&&info.tokenAmount?.decimals===6,"Wrong payout amount or decimals");
  const pre=tx.meta.preTokenBalances,post=tx.meta.postTokenBalances;if(!Array.isArray(pre)||!Array.isArray(post))throw new Unsupported("Token balance metadata unavailable");
  check(pre.filter((b:any)=>b.mint===MINT).every((b:any)=>post.some((v:any)=>v.accountIndex===b.accountIndex&&v.mint===MINT)),"Missing closing HTS balance metadata");
  const keys=tx.transaction.message.accountKeys.map(key);let winnerDelta:bigint|null=null,vaultDelta:bigint|null=null;
  for(const balance of post.filter((b:any)=>b.mint===MINT)){
    check(balance.uiTokenAmount.decimals===6,"Token metadata decimals mismatch");const prior=pre.find((b:any)=>b.accountIndex===balance.accountIndex);
    if(prior)check(prior.mint===MINT&&prior.owner===balance.owner,"Token balance owner/mint changed");
    const delta=BigInt(balance.uiTokenAmount.amount)-BigInt(prior?.uiTokenAmount.amount??"0"),tokenAddress=keys[balance.accountIndex];
    if(tokenAddress===destination){check(balance.owner===winner,"Payout token account owner mismatch");winnerDelta=delta;}
    else if(tokenAddress===vault){check(balance.owner===authority,"Vault token authority mismatch");vaultDelta=delta;}
    else check(delta===BigInt(0),"Unexplained HTS movement in settlement transaction");
  }
  check(winnerDelta===BigInt(m.total_pot)&&vaultDelta===-BigInt(m.total_pot),"Payout balance deltas do not equal the complete pot");
  return {signature,destination,amount:m.total_pot};
}
async function requestBinding(rpc:Rpc,m:any,address:string,randomness:string,client:string){
  const rows=await rpc.call("getSignaturesForAddress",[address,{limit:30,commitment:"finalized"}]);
  const creation=rows?.find((s:any)=>String(s.slot)===m.created_slot&&!s.err);
  if(!creation)throw new Unsupported("Original randomness request transaction unavailable");
  const tx=await rpc.call("getTransaction",[creation.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);
  if(!tx?.meta)throw new Unsupported("Original randomness request metadata unavailable");check(tx.meta.err===null,"Randomness request transaction failed");check(String(tx.slot)===m.created_slot&&tx.transaction.signatures[0]===creation.signature,"Original request slot or signature mismatch");
  const definition=idl.instructions.find((i:any)=>i.name==="match_next_hts_room");
  const ixs=tx.transaction.message.instructions.filter((i:any)=>i.programId===PROGRAM&&i.data&&eq(bs58.decode(i.data).slice(0,8),new Uint8Array(definition.discriminator)));
  check(ixs.length===1,"Missing or ambiguous original match request instruction");const ix=ixs[0],r=new Reader(bs58.decode(ix.data));r.take(8);
  check(r.int().toString()===m.id&&r.byte()===m.tier_usd,"Original match ID or room mismatch");const nonce=r.take(32);check(r.offset===r.bytes.length&&nonce.some(n=>n!==0),"Invalid original match nonce");
  const parts=[text.encode("heads-or-tails-vrf-v2"),new PublicKey(PROGRAM).toBytes(),u64(BigInt(m.id)),nonce],bytes=new Uint8Array(parts.reduce((sum,b)=>sum+b.length,0));let offset=0;for(const b of parts){bytes.set(b,offset);offset+=b.length;}
  check(eq(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),m.seed),"Original match nonce does not derive the recorded seed");
  const accounts=Object.fromEntries(definition.accounts.map((a:any,i:number)=>[a.name,ix.accounts[i]]));
  check(accounts.caller===client&&accounts.game_match===address&&accounts.randomness===randomness&&accounts.config===pda("hts-config"),"ORAO request client or original match account binding mismatch");
}
export async function verifyMatch(rpc:Rpc,input:string):Promise<Verification>{
  const report:Verification={status:"UNAVAILABLE",reason:"Verification has not completed",checks:[],network:"devnet",sourceCorrespondence:"Source-to-executable reproducibility is a separate release check; not proved by this result.",cryptographicProof:"Reads ORAO program-owned fulfilled output. Does not independently audit the VRF cryptographic proof."};
  try{
    check(await rpc.call("getGenesisHash",[])===DEVNET_GENESIS,"RPC is not Solana Devnet");report.checks.push("Solana Devnet genesis hash");
    await programBinding(rpc,PROGRAM,"517449562");await programBinding(rpc,ORAO,"517655076");report.checks.push("Executable program identities and pinned Devnet upgrade slots");
    let id:bigint|null=null,address:string;
    if(/^\d{1,20}$/.test(input.trim())){id=BigInt(input.trim());check(id<=BigInt("18446744073709551615"),"Match ID outside u64 range");address=matchAddress(id);}else address=new PublicKey(input.trim()).toBase58();
    const matchInfo=await account(rpc,address);check(matchInfo.owner===PROGRAM&&!matchInfo.executable,"Wrong Match PDA owner");const m=decodeAccount("Match",matchInfo.bytes);check(id===null||m.id===id.toString(),"Match ID mismatch");check(address===matchAddress(BigInt(m.id)),"Incorrect HTS Match PDA derivation");
    check(m.tier_usd===1||m.tier_usd===10,"Unsupported HTS room");check(m.heads_player!==m.tails_player,"Players must differ");check(BigInt(m.heads_amount)===BigInt(m.tails_amount)&&BigInt(m.total_pot)===BigInt(m.heads_amount)+BigInt(m.tails_amount),"Stake or pot mismatch");check(BigInt(m.heads_amount)===BigInt(m.tier_usd)*(BigInt(m.created_slot)<BigInt(517449562)?BigInt(1000000):BigInt(100000000)),"HTS room stake denomination mismatch");
    const config=await account(rpc,pda("hts-config"));check(config.owner===PROGRAM,"Wrong HTS configuration owner");const cfg=decodeAccount("GameConfig",config.bytes);check(cfg.project_mint===MINT,"HTS mint configuration mismatch");
    const mint=await account(rpc,MINT);check(mint.owner===TOKEN&&mint.bytes.length===82&&mint.bytes[44]===6&&mint.bytes[45]===1,"Wrong token mint program, layout, initialization or decimals");
    Object.assign(report,{matchId:m.id,matchAddress:address,room:m.tier_usd,heads:m.heads_player,tails:m.tails_player,headsStake:m.heads_amount,tailsStake:m.tails_amount,pot:m.total_pot,seed:hex(m.seed),state:m.state,recordedResult:m.result?.toUpperCase()??null,recordedWinner:m.winner,settledSlot:m.settled_slot});report.checks.push("Match owner, discriminator, ID, PDA, room, stakes and mint");
    const randomness=randomnessAddress(m.seed),rinfo=await account(rpc,randomness),r=decodeOrao(rinfo.bytes,rinfo.owner,m.seed);await requestBinding(rpc,m,address,randomness,r.client);Object.assign(report,{randomnessAddress:randomness,randomnessOwner:rinfo.owner});report.checks.push("ORAO PDA, owner, discriminator, schema, original client/nonce and match seed");
    if(r.pending){check(m.state!=="Settled","Settled match contradicts pending ORAO randomness");report.status="PENDING";report.reason="ORAO randomness has not been fulfilled";return report;}
    const calculated=outcome(r.randomness),winner=calculated==="HEADS"?m.heads_player:m.tails_player;
    Object.assign(report,{randomnessHex:hex(r.randomness),firstByte:r.randomness[0],firstHex:r.randomness[0].toString(16).padStart(2,"0"),binary:r.randomness[0].toString(2).padStart(8,"0"),bit:r.randomness[0]&1,calculated,calculatedWinner:winner});report.checks.push("64-byte fulfilled randomness and first-byte least significant bit");
    if(m.state==="WaitingForRandomness"){check(m.result===null&&m.winner===null&&m.settled_slot===null,"Unsettled match has contradictory final fields");report.status="PENDING";report.reason="Randomness is fulfilled; on-chain settlement and payout are pending";return report;}
    check(m.state==="Settled"&&m.result?.toUpperCase()===calculated&&m.winner===winner,"Recorded outcome or winner contradicts ORAO randomness");check(m.settled_slot!==null&&BigInt(m.settled_slot)>=BigInt(m.created_slot),"Invalid settlement slot");report.checks.push("Recorded result, winner and settlement slot");
    const paid=await payout(rpc,m,address,randomness,winner);Object.assign(report,{settlementSignature:paid.signature,payoutRecipient:winner,payout:paid.amount});report.checks.push("Successful bound settlement instruction, token transfer and exact winner/vault balance deltas");
    // Reject an upgrade that finalized while the account/receipt reads ran.
    await programBinding(rpc,PROGRAM,"517449562");await programBinding(rpc,ORAO,"517655076");
    report.evidenceFingerprint=JSON.stringify([report.matchAddress,report.seed,report.randomnessHex,report.calculatedWinner,report.settlementSignature,report.payout]);report.status="VERIFIED";report.reason="ORAO calculation, recorded outcome and full-pot payout agree";
  }catch(error){report.status=error instanceof Contradiction?"NOT VERIFIED":"UNAVAILABLE";report.reason=error instanceof Contradiction||error instanceof Unsupported||error instanceof RpcUnavailable?error.message:"Required RPC data could not be retrieved or decoded. Retry or choose another endpoint.";}
  return report;
}
export function compareVerifications(a:Verification,b:Verification):Verification{if(a.status==="UNAVAILABLE"||b.status==="UNAVAILABLE")return {...a,status:"UNAVAILABLE",reason:"Required verification data were unavailable from one of the selected RPC endpoints."};if(a.status!==b.status||(a.evidenceFingerprint&&a.evidenceFingerprint!==b.evidenceFingerprint)||a.randomnessHex!==b.randomnessHex||a.matchAddress!==b.matchAddress)return {...a,status:"NOT VERIFIED",reason:"RPC endpoints disagree. Do not rely on this result."};return {...a,checks:[...a.checks,"Repeated independently against a second RPC endpoint"]};}
export const explorerAccount=(address:string)=>`https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
export const explorerTransaction=(signature:string)=>`https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
