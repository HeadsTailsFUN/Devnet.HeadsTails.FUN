"use client";
import { useEffect, useRef, useState } from "react";
import { FlipPill } from "@/components/game/HeroBits";
import { LockIcon } from "@/components/ui/icons";

export function MobileRoomSelector({tier,locked,liveTiers,onSelect}:{tier:number;locked:boolean;liveTiers:readonly number[];onSelect:(tier:number)=>void}) {
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){setOpen(false);trigger.current?.focus();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    root.current?.querySelector<HTMLButtonElement>("[role=group] button:not(:disabled)")?.focus();
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[open]);
  useEffect(()=>{if(locked)setOpen(false);},[locked]);
  return <div ref={root} className="mobile-room-selector relative">
    <button ref={trigger} type="button" disabled={locked} aria-label={`Choose room, $${tier} selected`}
      aria-expanded={open&&!locked} onClick={()=>setOpen(v=>!v)} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed">
      <FlipPill label={`$${tier.toLocaleString("en-US")} FLIP`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-white/40"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg></FlipPill>
    </button>
    {open&&!locked&&<div role="group" aria-label="Choose a room" className="glass absolute left-1/2 top-full z-30 mt-2 w-40 -translate-x-1/2 rounded-2xl border border-white/10 p-1 shadow-xl">
      {[1,10,100,1000].map(value=>{const disabled=value>10||!liveTiers.includes(value);return <button key={value} type="button" disabled={disabled}
        aria-pressed={tier===value} onClick={()=>{if(locked||disabled)return;onSelect(value);setOpen(false);trigger.current?.focus();}}
        className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:text-white/35 ${tier===value?"bg-white/10 text-[var(--heads)]":"text-white hover:bg-white/5"}`}>
        ${value.toLocaleString("en-US")}{disabled&&<LockIcon className="h-4 w-4"/>}</button>;})}
    </div>}
  </div>;
}
