"use client";
import {useRef,useState} from "react";
import {compareVerifications,createRpc,DEFAULT_RPC,explorerAccount,explorerTransaction,formatHts,SOURCE_URL,verifyMatch,type Verification} from "@/lib/fairness/verifier";

export function FairnessPanel({matchId,standalone=false}:{matchId?:string;standalone?:boolean}){
  const [input,setInput]=useState(matchId||"74"),[endpoint,setEndpoint]=useState(DEFAULT_RPC),[second,setSecond]=useState("");
  const [report,setReport]=useState<Verification|null>(null),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);const epoch=useRef(0);
  async function verify(){if(busy)return;const current=++epoch.current;setBusy(true);setCopied(false);setReport(null);try{let result=await verifyMatch(createRpc(endpoint),matchId||input);if(second.trim())result=compareVerifications(result,await verifyMatch(createRpc(second.trim()),matchId||input));if(current===epoch.current)setReport(result);}catch{setReport({status:"UNAVAILABLE",reason:"Check the HTTPS RPC endpoint and try again.",checks:[],network:"devnet",sourceCorrespondence:"Not established by this check",cryptographicProof:"Not independently audited"});}finally{if(current===epoch.current)setBusy(false);}}
  const value=(label:string,content:React.ReactNode)=><div className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2"><dt>{label}</dt><dd className="min-w-0 break-all text-right font-semibold text-white">{content}</dd></div>;
  return <section aria-label="Verify Fairness" className="mt-5 min-w-0 rounded-3xl border border-white/10 bg-black/20 p-4 text-left text-sm">
    <h2 className="font-display text-xl font-bold text-white">Verify Fairness</h2>
    <p className="my-2 text-[var(--text-secondary)]">Read Solana directly. Calculate the result. Check the full payout. No wallet connection needed.</p>
    {!matchId&&<label className="mb-3 block">Match ID or HTS Match PDA<input disabled={busy} aria-label="Match ID or Match PDA" value={input} onChange={e=>{setInput(e.target.value);setReport(null);}} className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 p-3 text-base text-white"/></label>}
    <details className="my-3"><summary className="min-h-[44px] cursor-pointer py-3">Choose an independent RPC endpoint</summary>
      <label className="block">Solana Devnet RPC<input disabled={busy} aria-label="Solana Devnet RPC" type="url" value={endpoint} onChange={e=>{setEndpoint(e.target.value);setReport(null);}} className="my-2 w-full rounded-xl border border-white/15 bg-black/30 p-3 text-base text-white"/></label>
      <label className="block">Second RPC (optional cross-check)<input disabled={busy} aria-label="Second RPC endpoint" type="url" value={second} onChange={e=>{setSecond(e.target.value);setReport(null);}} placeholder="https://…" className="my-2 w-full rounded-xl border border-white/15 bg-black/30 p-3 text-base text-white"/></label>
      <p className="text-xs">Use a public endpoint that allows browser requests. Keep private API keys out of shared URLs. Conflicting responses are flagged.</p>
    </details>
    <button type="button" disabled={busy} onClick={()=>void verify()} className="my-2 min-h-[44px] w-full rounded-2xl bg-[var(--heads)] px-4 py-3 font-bold text-black disabled:opacity-60">{busy?"Reading blockchain…":report?"Recalculate Result":"Verify Fairness"}</button>
    <aside aria-label="How to read the binary result" className="my-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="mb-3 font-semibold text-white">Check the last binary digit:</p>
      <div className="grid gap-2 font-display text-xl font-bold sm:grid-cols-2 sm:text-2xl">
        <p className="text-[var(--tails)] sm:whitespace-nowrap">1 → TAILS wins</p>
        <p className="text-[var(--heads)] sm:whitespace-nowrap">0 → HEADS wins</p>
      </div>
    </aside>
    {report&&<div aria-live="polite"><p className={`mt-3 font-bold ${report.status==="VERIFIED"?"text-[var(--heads)]":report.status==="NOT VERIFIED"?"text-[var(--tails)]":"text-orange-300"}`}>{report.status}</p><p className="my-2">{report.reason}</p>
      <dl className="text-[var(--text-secondary)]">
        {report.matchId&&value("Round",`#${report.matchId} · $${report.room}`)}
        {value("ORAO VRF",report.randomnessHex?"Fulfilled":report.status==="PENDING"?"Pending":"Not established")}
        {report.firstByte!==undefined&&<>{value("First random byte",`${report.firstByte} · 0x${report.firstHex}`)}{value("Binary",<code>{report.binary}</code>)}{value("Result bit",report.bit)}{value("Calculated result",<span className={report.calculated==="HEADS"?"text-[var(--heads)]":"text-[var(--tails)]"}>{report.calculated}</span>)}</>}
        {report.recordedResult&&value("Recorded match result",report.recordedResult)}
        {report.pot&&value("Total pot",formatHts(report.pot))}{value("Verified payout",report.payout?formatHts(report.payout):"Not confirmed")}
      </dl>
      <details className="my-3"><summary className="min-h-[44px] cursor-pointer py-3">Raw evidence and checks</summary>
        {report.randomnessHex&&<><p className="mt-2">64-byte randomness (hex)</p><code className="block break-all rounded-xl bg-black/30 p-3 text-xs text-white">{report.randomnessHex}</code><button type="button" className="min-h-[44px] py-2 font-bold text-[var(--heads)]" onClick={()=>void navigator.clipboard.writeText(report.randomnessHex!).then(()=>setCopied(true)).catch(()=>setCopied(false))}>{copied?"Copied":"Copy randomness"}</button></>}
        <dl>{report.seed&&value("Match seed",report.seed)}{report.heads&&value("HEADS player",report.heads)}{report.tails&&value("TAILS player",report.tails)}{report.calculatedWinner&&value("Calculated winning wallet",report.calculatedWinner)}{report.recordedWinner&&value("Recorded winner",report.recordedWinner)}{report.payoutRecipient&&value("Payout recipient",report.payoutRecipient)}{report.settledSlot&&value("Settlement slot",report.settledSlot)}</dl>
        <ul className="my-3 list-inside list-disc space-y-2">{report.checks.map(check=><li key={check}>{check}</li>)}</ul>
      </details>
      <div className="flex flex-col gap-2">{[["View ORAO Randomness",report.randomnessAddress?explorerAccount(report.randomnessAddress):null],["View Match on Solana",report.matchAddress?explorerAccount(report.matchAddress):null],["View Settlement on Solana",report.settlementSignature?explorerTransaction(report.settlementSignature):null],["View Winner Algorithm on GitHub",SOURCE_URL]].map(([label,url])=>url?<a key={label} href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center break-all font-semibold text-[var(--heads)]">{label} ↗</a>:null)}</div>
    </div>}
    <p className="mt-3 text-xs text-[var(--text-secondary)]">This checks program-owned blockchain data and payout consistency. Independent VRF proof auditing and reproducible source-to-binary verification are separate checks. A memo is never evidence of randomness.</p>
    {!standalone&&<a href="https://headstailsfun.github.io/Devnet.HeadsTails.FUN/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center font-bold text-[var(--heads)]">Open independent verifier ↗</a>}
  </section>;
}
