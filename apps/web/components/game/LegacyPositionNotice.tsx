"use client";
import { useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { buildLegacyRefund, inspectLegacyPosition, type HeadsOrTails } from "@heads-or-tails/game-sdk";
import { ensureSponsoredBalance } from "@/lib/solana/sponsorClient";

export function LegacyPositionNotice({program,address,onSubmit,onChanged}: {
  program: Program<HeadsOrTails> | null; address: string | null;
  onSubmit: (tx: Transaction) => Promise<string>; onChanged: () => void;
}) {
  const [position,setPosition] = useState<Awaited<ReturnType<typeof inspectLegacyPosition>>>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  useEffect(()=>{
    let live=true;setPosition(null);setError(null);
    if(program&&address) inspectLegacyPosition(program,new PublicKey(address))
      .then(value=>{if(live)setPosition(value);})
      .catch(()=>{if(live)setError("Historical position could not be checked. Try again before playing.");});
    return ()=>{live=false;};
  },[program,address]);
  if(!position&&!error)return null;
  return <aside className="w-full max-w-[760px] rounded-2xl border border-white/20 bg-white/5 p-4" aria-label="Historical token position">
    {position&&<p>You have an original-token {position.state.inMatch?"match awaiting settlement":"queue position"}. Your original tokens are kept separate from HTS. Finish this position before joining an HTS game.</p>}
    {position?.state.queued&&!position.state.inMatch&&<button type="button" disabled={busy} className="mt-3 rounded-xl border border-white/25 px-4 py-2 disabled:opacity-50" onClick={async()=>{
      if(!program||!address||busy)return;
      setBusy(true);setError(null);
      try {
        const current=await buildLegacyRefund(program,new PublicKey(address));
        const balance=await program.provider.connection.getBalance(new PublicKey(address),"confirmed");
        if(balance<5_000_000){
          const funding=await ensureSponsoredBalance(address);
          if(!funding.ok)throw new Error("Fee support is unavailable. You can retry with Devnet SOL in your wallet.");
        }
        await onSubmit(current.tx);
        setPosition(await inspectLegacyPosition(program,new PublicKey(address)));onChanged();
      }catch{setError("Refund was not completed. Your position can be checked and retried safely.");}
      finally{setBusy(false);}
    }}>{busy?"Confirming refund…":"Refund original tokens"}</button>}
    {error&&<p role="status" className="mt-2 text-sm">{error}</p>}
  </aside>;
}
