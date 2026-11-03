import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const WC_DEVNET_CHAIN = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const WC_METHODS = ["solana_signTransaction", "solana_signMessage"] as const;
const STANDARD_CHAIN = "solana:devnet" as const;
export interface WalletConnectSession {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[]; methods: string[] }>;
}
export interface WalletConnectTransport {
  session(): WalletConnectSession | undefined;
  connect(): Promise<WalletConnectSession>;
  disconnect(): Promise<void>;
  request(method: string, params: Record<string, unknown>, chain: string): Promise<unknown>;
  onChange(listener: () => void): () => void;
}

/** Only an explicitly approved Devnet account with both required methods is usable. */
export function approvedWalletConnectAccount(session: WalletConnectSession | undefined): WalletAccount {
  const ns = session?.namespaces.solana;
  if (!session || typeof session.topic!=="string" || !session.topic || !Number.isFinite(session.expiry) || session.expiry <= Date.now()/1000 || !ns || !Array.isArray(ns.methods) || !Array.isArray(ns.accounts) ||
      !WC_METHODS.every(method=>ns.methods.includes(method)) || ns.accounts.length!==1 ||
      !ns.accounts[0].startsWith(`${WC_DEVNET_CHAIN}:`)) {
    throw new Error("WalletConnect requires a Solana Devnet account with transaction and message signing. Use your wallet browser if unsupported.");
  }
  const address=ns.accounts[0].slice(WC_DEVNET_CHAIN.length+1);
  const publicKey=new PublicKey(address);
  if(publicKey.toBase58()!==address)throw new Error("WalletConnect returned an invalid Solana account.");
  return {address,publicKey:publicKey.toBytes(),chains:[STANDARD_CHAIN],features:["solana:signTransaction","solana:signMessage"]};
}
const sameBytes=(a:ArrayLike<number>,b:ArrayLike<number>)=>a.length===b.length && Array.from(a).every((v,i)=>v===b[i]);

/** Wallet Standard boundary: no send-transaction feature and no RPC broadcast. */
export function createWalletConnectWallet(transport:WalletConnectTransport): Wallet {
  let accounts:readonly WalletAccount[]=[],topic:string|null=null,epoch=0,requestPending=false;
  const listeners=new Set<(change:{accounts:readonly WalletAccount[]})=>void>();
  const sync=()=>{
    let next:WalletAccount|null=null,nextTopic:string|null=null;
    try{const session=transport.session();next=approvedWalletConnectAccount(session);nextTopic=session!.topic;}catch{/* Fail closed on revoked, expired or incompatible sessions. */}
    if(next?.address!==accounts[0]?.address || nextTopic!==topic){
      epoch++;topic=nextTopic;accounts=next?[next]:[];
      for(const listener of listeners)listener({accounts});
    }
  };
  transport.onChange(sync);
  const current=(input:WalletAccount,chain?:string)=>{
    sync();
    const account=accounts[0];
    if(chain && chain!==STANDARD_CHAIN)throw new Error("WalletConnect is restricted to Solana Devnet.");
    if(!account || input.address!==account.address || !sameBytes(input.publicKey,account.publicKey))
      throw new Error("WalletConnect account changed or disconnected. Reconnect and verify your wallet.");
    return account;
  };
  const request=async(method:string,params:Record<string,unknown>,account:WalletAccount)=>{
    if(requestPending)throw new Error("A wallet approval is already pending. Review it in your wallet first.");
    const before=epoch;requestPending=true;
    try{
      const result=await transport.request(method,params,WC_DEVNET_CHAIN);
      current(account);
      if(before!==epoch)throw new Error("WalletConnect account changed during approval. Please reconnect.");
      return result as {signature?:string;transaction?:string};
    }finally{requestPending=false;}
  };
  const wallet={
    version:"1.0.0" as const,name:"WalletConnect",
    icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyByeD0nOCcgZmlsbD0nIzNiOTlmYycvPjx0ZXh0IHg9JzE2JyB5PScyMScgdGV4dC1hbmNob3I9J21pZGRsZScgZm9udC1zaXplPScxNCcgZmlsbD0nd2hpdGUnPldDPC90ZXh0Pjwvc3ZnPg==" as const,
    chains:[STANDARD_CHAIN],
    get accounts(){return accounts;},
    features:{
      "standard:connect":{version:"1.0.0" as const,connect:async(options?:{silent?:boolean})=>{
        if(!options?.silent){try{approvedWalletConnectAccount(transport.session());}catch{await transport.connect();}}
        // Silent restoration never opens a connection or signing prompt.
        approvedWalletConnectAccount(transport.session());sync();return {accounts};
      }},
      "standard:disconnect":{version:"1.0.0" as const,disconnect:async()=>{
        epoch++;accounts=[];topic=null;for(const listener of listeners)listener({accounts});
        await transport.disconnect();
      }},
      "standard:events":{version:"1.0.0" as const,on:(event:string,listener:(change:{accounts:readonly WalletAccount[]})=>void)=>{
        if(event!=="change")return ()=>undefined;
        listeners.add(listener);return ()=>{listeners.delete(listener);};
      }},
      "solana:signTransaction":{version:"1.0.0" as const,supportedTransactionVersions:["legacy",0] as const,
        signTransaction:async(...inputs:{account:WalletAccount;transaction:Uint8Array;chain?:string}[])=>{
          if(inputs.length!==1)throw new Error("Review one transaction at a time.");
          const input=inputs[0],account=current(input.account,input.chain);
          const original=VersionedTransaction.deserialize(input.transaction),message=original.message.serialize();
          const signer=original.message.staticAccountKeys.findIndex(key=>key.toBase58()===account.address);
          if(signer<0 || signer>=original.message.header.numRequiredSignatures)throw new Error("Connected wallet is not a required transaction signer.");
          const response=await request("solana_signTransaction",{transaction:Buffer.from(input.transaction).toString("base64"),pubkey:account.address},account);
          let signed=original;
          if(response.transaction){
            signed=VersionedTransaction.deserialize(Buffer.from(response.transaction,"base64"));
          }else if(response.signature){signed.signatures[signer]=bs58.decode(response.signature);}
          else throw new Error("WalletConnect returned no signed transaction.");
          if(!sameBytes(message,signed.message.serialize()) || signed.signatures.length!==original.signatures.length)
            throw new Error("WalletConnect changed the reviewed transaction. Nothing was submitted.");
          for(let i=0;i<original.signatures.length;i++)if(i!==signer && !sameBytes(original.signatures[i],signed.signatures[i]))
            throw new Error("WalletConnect changed another signer's approval. Nothing was submitted.");
          const signature=signed.signatures[signer];
          if(signature.length!==64 || !nacl.sign.detached.verify(message,signature,new Uint8Array(account.publicKey)))
            throw new Error("WalletConnect returned an invalid transaction signature.");
          return [{signedTransaction:signed.serialize()}];
        }},
      "solana:signMessage":{version:"1.0.0" as const,signMessage:async(...inputs:{account:WalletAccount;message:Uint8Array}[])=>{
        if(inputs.length!==1)throw new Error("Review one ownership message at a time.");
        const input=inputs[0],account=current(input.account),message=new Uint8Array(input.message);
        const response=await request("solana_signMessage",{pubkey:account.address,message:bs58.encode(message)},account);
        const signature=bs58.decode(response.signature ?? "");
        if(signature.length!==64 || !nacl.sign.detached.verify(message,signature,new Uint8Array(account.publicKey)))
          throw new Error("WalletConnect returned an invalid ownership signature.");
        return [{signedMessage:message,signature}];
      }},
    },
  };
  return wallet;
}
