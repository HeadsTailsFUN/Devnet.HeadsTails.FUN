import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const WC_DEVNET_CHAIN = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
// Both CAIP identifiers refer to Solana Devnet. Some wallets still use the
// older identifier recognized by the official WalletConnect Solana adapter.
export const WC_DEVNET_CHAINS = [WC_DEVNET_CHAIN, "solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K"] as const;
export const WC_METHODS = ["solana_signTransaction", "solana_signMessage"] as const;
const STANDARD_CHAIN = "solana:devnet" as const;
type DevnetChain = typeof WC_DEVNET_CHAINS[number];
const connectionErrors = {
  WALLETCONNECT_SESSION_MISSING: "WalletConnect did not return an active session. Please reconnect.",
  WALLETCONNECT_DEVNET_REQUIRED: "Your wallet did not approve a Solana Devnet account for WalletConnect. Check Devnet in your wallet and reconnect.",
  WALLETCONNECT_SIGNING_REQUIRED: "Your WalletConnect session did not approve both message and transaction signing on Solana Devnet.",
  WALLETCONNECT_ACCOUNT_AMBIGUOUS: "WalletConnect returned more than one Solana Devnet account. Reconnect with one account selected.",
  WALLETCONNECT_ACCOUNT_INVALID: "WalletConnect returned an invalid Solana Devnet account. Please reconnect.",
  WALLETCONNECT_TIMEOUT: "WalletConnect did not receive your approval in time. Please reconnect and return to this tab after approving.",
} as const;

type PairingStage = "START" | "RESET" | "OPEN" | "APPROVAL";
type ConnectionCode = keyof typeof connectionErrors | `WC-${PairingStage}` | `WC-${PairingStage}-${number}`;

export class WalletConnectConnectionError extends Error {
  constructor(readonly code: ConnectionCode, message?: string) {
    super(message ?? connectionErrors[code as keyof typeof connectionErrors]);
  }
}

/** WalletConnect errors can be JSON-RPC objects or Errors with only a message. */
export function walletConnectPairingFailure(stage: PairingStage, error: unknown): WalletConnectConnectionError {
  const raw = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const detail = typeof raw.message === "string" ? raw.message : "";
  const reported = typeof raw.code === "string" && /^-?\d{1,5}$/.test(raw.code) ? Number(raw.code) : raw.code;
  const known = /unsupported chains/i.test(detail) ? 5100 :
    /unsupported methods/i.test(detail) ? 5101 :
    /non conforming namespaces/i.test(detail) ? 9 :
    /session settlement failed/i.test(detail) ? 7000 : undefined;
  const number = typeof reported === "number" && Number.isInteger(reported) && Math.abs(reported) <= 99_999 ? reported : known;
  const code = number === undefined ? `WC-${stage}` as const : `WC-${stage}-${number}` as const;
  const message = number === 5100 || number === 5001
    ? "Your wallet rejected the requested Solana Devnet network."
    : number === 5101 || number === 5002
      ? "Your wallet rejected one of the required signing methods for Solana Devnet."
      : /origin|allowlist|not allowed/i.test(detail)
        ? "WalletConnect could not authorize this website address. Open headstails.fun in your browser."
        : stage === "APPROVAL"
          ? "WalletConnect could not complete the approval. Return to the original browser tab and try again."
          : "WalletConnect could not start a fresh connection. Reload this tab and try again.";
  return new WalletConnectConnectionError(code, `${message} [${code}]`);
}

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

function approvedDevnetBinding(session: WalletConnectSession | undefined): {account: WalletAccount; chain: DevnetChain} {
  if (typeof session?.topic !== "string" || !session.topic || !Number.isFinite(session.expiry) || session.expiry <= Date.now()/1000) {
    throw new WalletConnectConnectionError("WALLETCONNECT_SESSION_MISSING");
  }
  const approved = new Map<string, DevnetChain>();
  let hasDevnetAccount = false;
  for (const chain of WC_DEVNET_CHAINS) {
    const prefix = `${chain}:`;
    // WalletConnect allows the namespace to be keyed by Solana or by the
    // specific CAIP chain. Methods must be approved in the account's scope.
    for (const scope of [session.namespaces?.[chain], session.namespaces?.solana]) {
      if (!Array.isArray(scope?.accounts)) continue;
      for (const entry of scope.accounts) {
        if (typeof entry !== "string" || !entry.startsWith(prefix)) continue;
        hasDevnetAccount = true;
        if (!Array.isArray(scope.methods) || !WC_METHODS.every((method) => scope.methods.includes(method))) continue;
        const address = entry.slice(prefix.length);
        if (!approved.has(address)) approved.set(address, chain);
      }
    }
  }
  if (!hasDevnetAccount) throw new WalletConnectConnectionError("WALLETCONNECT_DEVNET_REQUIRED");
  if (!approved.size) throw new WalletConnectConnectionError("WALLETCONNECT_SIGNING_REQUIRED");
  if (approved.size !== 1) throw new WalletConnectConnectionError("WALLETCONNECT_ACCOUNT_AMBIGUOUS");
  const [[address, chain]] = approved;
  let publicKey: PublicKey;
  try { publicKey = new PublicKey(address); }
  catch { throw new WalletConnectConnectionError("WALLETCONNECT_ACCOUNT_INVALID"); }
  if (publicKey.toBase58() !== address) throw new WalletConnectConnectionError("WALLETCONNECT_ACCOUNT_INVALID");
  return {account: {address, publicKey: publicKey.toBytes(), chains: [STANDARD_CHAIN], features: ["solana:signTransaction", "solana:signMessage"]}, chain};
}

/** Only an explicitly approved Devnet account with both required methods is usable. */
export function approvedWalletConnectAccount(session: WalletConnectSession | undefined): WalletAccount {
  return approvedDevnetBinding(session).account;
}
const sameBytes=(a:ArrayLike<number>,b:ArrayLike<number>)=>a.length===b.length && Array.from(a).every((v,i)=>v===b[i]);

/** Wallet Standard boundary: no send-transaction feature and no RPC broadcast. */
export function createWalletConnectWallet(transport:WalletConnectTransport): Wallet {
  let accounts:readonly WalletAccount[]=[],topic:string|null=null,epoch=0,requestPending=false;
  let approvedChain: DevnetChain | null = null;
  const listeners=new Set<(change:{accounts:readonly WalletAccount[]})=>void>();
  const sync=()=>{
    let next: ReturnType<typeof approvedDevnetBinding> | null = null, nextTopic:string|null=null;
    try{const session=transport.session();next=approvedDevnetBinding(session);nextTopic=session!.topic;}catch{/* Fail closed on revoked, expired or incompatible sessions. */}
    const nextChain = next?.chain ?? null;
    if(next?.account.address!==accounts[0]?.address || nextTopic!==topic || nextChain!==approvedChain){
      epoch++;topic=nextTopic;approvedChain=nextChain;accounts=next?[next.account]:[];
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
    if(!approvedChain)throw new Error("WalletConnect is restricted to Solana Devnet.");
    const before=epoch;requestPending=true;
    try{
      const result=await transport.request(method,params,approvedChain);
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
        epoch++;accounts=[];topic=null;approvedChain=null;for(const listener of listeners)listener({accounts});
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
