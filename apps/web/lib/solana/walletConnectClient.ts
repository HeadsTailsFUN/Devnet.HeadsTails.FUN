"use client";
import type { Wallet } from "@wallet-standard/base";
import { IS_DEVNET } from "./cluster";
import { isMobileUserAgent } from "./mobileWallets";
import { createWalletConnectWallet, WalletConnectConnectionError, WC_DEVNET_CHAINS, WC_METHODS, type WalletConnectSession } from "./walletConnectBridge";

// Public Reown project identifier supplied by the owner; never a signing key.
export const WALLETCONNECT_PROJECT_ID="aa863806da500d92667fb8955ef1395b";
// Reown listings advertising the exact Devnet chain and a mobile relay link.
// Phantom and Solflare are routed through their official wallet browsers.
export const MOBILE_DEVNET_WALLETCONNECT_IDS = [
  "2bd8c14e035c2d48f184aaa168559e86b0e3433228d3c4075900a221785019b0", // Backpack
  "9a4cddbdbc19005be790f37cc9176dd24eae51aa2a49fa3edeb3b6a8b089b7be", // Nightly
];

export function filterRecentWalletConnectChoices(storage?: Pick<Storage, "getItem" | "setItem">): void {
  // AppKit 1.8.19 renders recent choices separately from includeWalletIds.
  const key = "@appkit/recent_wallets";
  try {
    const recentStorage = storage ?? window.localStorage;
    const raw = recentStorage.getItem(key);
    if (!raw) return;
    const recent: unknown = JSON.parse(raw);
    const filtered = Array.isArray(recent) ? recent.filter(
      (wallet) => typeof wallet?.id === "string" && MOBILE_DEVNET_WALLETCONNECT_IDS.includes(wallet.id),
    ) : [];
    if (!Array.isArray(recent) || filtered.length !== recent.length) {
      recentStorage.setItem(key, JSON.stringify(filtered));
    }
  } catch {
    // Storage may be blocked. AppKit can still use its configured list.
  }
}

let instance:Promise<Wallet>|null=null;
export function getWalletConnectWallet():Promise<Wallet>{
  if(!IS_DEVNET || typeof window==="undefined")return Promise.reject(new Error("WalletConnect is enabled for this Devnet beta only."));
  if(instance)return instance;
  instance=initialize().catch(error=>{instance=null;throw error;});
  return instance;
}
async function initialize():Promise<Wallet>{
  const mobile = isMobileUserAgent(navigator.userAgent);
  const [{default:UniversalProvider},{createAppKit},{solanaDevnet}]=await Promise.all([
    import("@walletconnect/universal-provider"),import("@reown/appkit/core"),import("@reown/appkit/networks"),
  ]);
  const metadata={name:"HeadsTails.fun — Devnet Beta",description:"Test HTS coin-flip game on Solana Devnet",url:window.location.origin,icons:[`${window.location.origin}/brand/favicon-32.png`]};
  const provider=await UniversalProvider.init({projectId:WALLETCONNECT_PROJECT_ID,metadata,logger:"silent",customStoragePrefix:"headstails-devnet-beta",telemetryEnabled:false});
  const modal=createAppKit({projectId:WALLETCONNECT_PROJECT_ID,metadata,universalProvider:provider,
    networks:[solanaDevnet],defaultNetwork:solanaDevnet,manualWCControl:true,allowUnsupportedChain:false,
    ...(mobile ? { includeWalletIds: MOBILE_DEVNET_WALLETCONNECT_IDS, allWallets: "HIDE" as const } : {}),
    features:{analytics:false,email:false,socials:false,onramp:false,swaps:false,send:false},
    themeMode:"dark",themeVariables:{"--w3m-z-index":100,"--w3m-accent":"#3dffc8"},
  });
  return createWalletConnectWallet({
    session:()=>provider.session as WalletConnectSession|undefined,
    connect:async()=>{
      // This prefix belongs only to this integration. Replace an expired or
      // incompatible local session before requesting the exact Devnet scope.
      if(provider.session)await provider.disconnect();
      let finished=false,aborted=false,rejectCancelled:(error:Error)=>void=()=>undefined;
      const cancelled=new Promise<never>((_,reject)=>{rejectCancelled=reject;});
      if (mobile) filterRecentWalletConnectChoices();
      await modal.open();
      const off=modal.subscribeState(state=>{if(!state.open&&!finished){aborted=true;provider.abortPairingAttempt();rejectCancelled(new Error("WalletConnect connection cancelled."));}});
      const timeout=setTimeout(()=>{aborted=true;provider.abortPairingAttempt();rejectCancelled(new WalletConnectConnectionError("WALLETCONNECT_TIMEOUT"));},120_000);
      try{
        const proposal=provider.connect({optionalNamespaces:{solana:{chains:[...WC_DEVNET_CHAINS],methods:[...WC_METHODS],events:[]}}}).then(async session=>{
          if(aborted){if(session && provider.session?.topic===session.topic)await provider.disconnect();throw new Error("WalletConnect connection cancelled.");}
          return session;
        });
        const session=await Promise.race([proposal,cancelled]);
        if(!session)throw new WalletConnectConnectionError("WALLETCONNECT_SESSION_MISSING");
        return session as WalletConnectSession;
      }finally{finished=true;clearTimeout(timeout);off();await modal.close();}
    },
    disconnect:async()=>{await modal.close();if(provider.session)await provider.disconnect();},
    request:(method,params,chain)=>provider.request({method,params},chain),
    onChange:listener=>{
      const events=["session_update","session_delete","session_expire","accountsChanged","chainChanged","disconnect"];
      for(const event of events)provider.on(event,listener);
      return()=>{for(const event of events)provider.off(event,listener);};
    },
  });
}
