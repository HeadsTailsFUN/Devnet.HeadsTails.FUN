"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RecentFlipItem, RecentFlipDetailsModal } from "@/components/history/RecentFlips";
import { fetchRecentFlips, shortWallet, timeAgo, type HistoryResult, type RecentFlip } from "@/lib/solana/history";

export function MobileFlips({active,enabled=true}:{active:boolean;enabled?:boolean}) {
  const [history,setHistory]=useState<HistoryResult|null>(null),[opened,setOpened]=useState<RecentFlip|null>(null);
  const scrollRef=useRef<HTMLDivElement>(null),savedScroll=useRef(0),loadedAt=useRef(0);
  const mounted=useRef(false),inFlight=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!active)return;
    const load=async()=>{if(document.hidden||inFlight.current||Date.now()-loadedAt.current<15_000)return;inFlight.current=true;try{const data=await fetchRecentFlips(50);loadedAt.current=Date.now();if(mounted.current)setHistory(data);}finally{inFlight.current=false;}};
    void load();const timer=setInterval(()=>void load(),30_000);
    return()=>clearInterval(timer);
  },[active]);
  useLayoutEffect(()=>{if(active&&!opened&&scrollRef.current)scrollRef.current.scrollTop=savedScroll.current;},[active,opened]);
  const openFlip=(flip:RecentFlip)=>{savedScroll.current=scrollRef.current?.scrollTop ?? savedScroll.current;setOpened(flip);};
  return <section hidden={!enabled || !active} id="mobile-flips" className="mobile-flips-screen" aria-label="Flips" data-mobile-panel="flips">
    <div ref={scrollRef} hidden={opened!==null} className="mobile-flips-list" onScroll={e=>{if(active&&!opened)savedScroll.current=e.currentTarget.scrollTop;}}>
      <h2 className="font-display mb-3 text-[19px] font-bold text-white">Recent Flips</h2>
      {!history&&<p className="text-sm text-[var(--text-secondary)]">Loading…</p>}
      {history?.status==="unavailable"&&<p role="status" className="text-sm text-[var(--text-secondary)]">History temporarily unavailable</p>}
      {history?.status==="empty"&&<p className="text-sm text-[var(--text-secondary)]">No flips settled yet.</p>}
      {history?.status==="ok"&&<ol className="space-y-3" aria-label="Latest 50 completed games">
        {history.flips.map(f=><li key={f.matchId} className="recent-flips-glass flex items-center gap-4 rounded-3xl p-4">
          <RecentFlipItem flip={f} open={false} onToggle={()=>openFlip(f)}/>
          <button type="button" onClick={()=>openFlip(f)} aria-label={`View ROUND #${f.matchId}`} className="min-h-[56px] min-w-0 flex-1 text-left text-sm text-[var(--text-secondary)]">
            <span className="font-display block font-bold text-white">ROUND #{f.matchId} · ${f.tierUsd}</span>
            <span className="block">{f.result} · {shortWallet(f.winnerWallet)}</span>
            <span className="block text-xs">{timeAgo(f.settledAt)}</span>
          </button>
        </li>)}
      </ol>}
    </div>
    {opened&&<div className="mobile-flips-detail-scroll"><RecentFlipDetailsModal flip={opened} onClose={()=>setOpened(null)} presentation="page"/></div>}
  </section>;
}
