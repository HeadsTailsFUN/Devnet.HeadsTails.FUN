"use client";
import { DiscordIcon, SolanaIcon, QueueIcon, WalletIcon } from "@/components/ui/icons";
import { MOBILE_TABS, type MobileTab } from "@/lib/mobile/navigation";
const ICONS={social:DiscordIcon,play:SolanaIcon,flips:QueueIcon,profile:WalletIcon};
export function MobileNavigation({tab,onSelect,enabled=true}:{tab:MobileTab;onSelect:(tab:MobileTab)=>void;enabled?:boolean}) {
  return <nav hidden={!enabled} aria-label="Mobile navigation" className="mobile-bottom-navigation glass">
    {MOBILE_TABS.map(item=>{const Icon=ICONS[item];return <button type="button" key={item}
      aria-current={tab===item?"page":undefined} aria-controls={`mobile-${item}`} onClick={()=>onSelect(item)}
      className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${tab===item?"bg-white/5 text-[var(--heads)]":"text-white/60 hover:text-white"}`}>
      <Icon className="h-5 w-5"/>{item}</button>;})}
  </nav>;
}
export function MobileSocialSwitch({value,onChange,enabled=true}:{value:"chat"|"leaderboard";onChange:(value:"chat"|"leaderboard")=>void;enabled?:boolean}) {
  return <div hidden={!enabled} id="mobile-social" className="mobile-social-switch grid grid-cols-2 gap-1 rounded-2xl bg-white/5 p-1" role="tablist" aria-label="Social sections">
    {(["chat","leaderboard"] as const).map(item=><button key={item} type="button" role="tab" aria-selected={value===item}
      tabIndex={value===item?0:-1} aria-controls={`mobile-social-${item}`} onClick={()=>onChange(item)}
      onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const next=e.key==="Home"?"chat":e.key==="End"?"leaderboard":item==="chat"?"leaderboard":"chat";onChange(next);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`button[data-social="${next}"]`)?.focus();}}
      data-social={item} className={`min-h-[44px] rounded-xl text-xs font-bold uppercase tracking-wide ${value===item?"bg-white text-black":"text-white/60 hover:text-white"}`}>{item}</button>)}
  </div>;
}
