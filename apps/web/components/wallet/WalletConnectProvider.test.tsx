import {test,afterEach} from "node:test";
import assert from "node:assert/strict";
import {createElement,useState} from "react";
import {render,screen,fireEvent,waitFor,act,cleanup} from "@testing-library/react";
import {PublicKey} from "@solana/web3.js";
import {WalletStandardProvider,useWalletState} from "./WalletProvider";
import {createWalletConnectWallet,WC_DEVNET_CHAIN,WC_METHODS,type WalletConnectSession} from "@/lib/solana/walletConnectBridge";
import {rememberWallet} from "@/lib/solana/session";
afterEach(()=>{cleanup();window.localStorage.clear();});
test("paused WalletConnect does not restore or start a relay connection", async () => {
  rememberWallet("WalletConnect");
  function Probe() {
    const state = useWalletState();
    const [buttonLabel, setButtonLabel] = useState("Try relay");
    return <>
      <p role="status">{state.restoring ? "Restoring" : state.account?.address ?? "Disconnected"}</p>
      <button onClick={async () => setButtonLabel(await state.connectWalletConnect() ? "Started" : "Paused")}>{buttonLabel}</button>
    </>;
  }
  render(<WalletStandardProvider><Probe /></WalletStandardProvider>);
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, "Disconnected"));
  fireEvent.click(screen.getByRole("button", {name: "Try relay"}));
  assert(await screen.findByRole("button", {name: "Paused"}));
});
test("remote session account changes and revocation update the actual wallet context without signing",async()=>{
  const a=new PublicKey(new Uint8Array(32).fill(7)).toBase58(),b=new PublicKey(new Uint8Array(32).fill(8)).toBase58();
  let current:WalletConnectSession|undefined={topic:"synthetic-session",expiry:Math.floor(Date.now()/1000)+3600,namespaces:{solana:{accounts:[`${WC_DEVNET_CHAIN}:${a}`],methods:[...WC_METHODS]}}};
  let changed:()=>void=()=>undefined;let requests=0;
  const wallet=createWalletConnectWallet({session:()=>current,connect:async()=>current!,disconnect:async()=>{current=undefined;changed();},request:async()=>{requests++;throw Error("No signature requests permitted");},onChange:cb=>{changed=cb;return()=>undefined;}});
  function Probe(){const state=useWalletState();return <><p role="status">{state.account?.address ?? "Disconnected"}</p><button onClick={()=>void state.connect(wallet)}>Connect fixture</button></>;}
  render(createElement(WalletStandardProvider,null,createElement(Probe)));fireEvent.click(screen.getByRole("button",{name:"Connect fixture"}));
  await waitFor(()=>assert.equal(screen.getByRole("status").textContent,a));
  act(()=>{current!.namespaces.solana.accounts=[`${WC_DEVNET_CHAIN}:${b}`];changed();});
  await waitFor(()=>assert.equal(screen.getByRole("status").textContent,b));
  act(()=>{current=undefined;changed();});await waitFor(()=>assert.equal(screen.getByRole("status").textContent,"Disconnected"));
  assert.equal(requests,0);
});
