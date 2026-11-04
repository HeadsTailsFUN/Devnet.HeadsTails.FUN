import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect, useState } from "react";
import { render, screen, within, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MobileNavigation } from "./MobileNavigation";
import { MobileRoomSelector } from "./MobileRoomSelector";
import { MobileFlips } from "./MobileFlips";
import MobileInformation from "./MobileInformation";
import { ProfileModal } from "../profile/ProfileModal";
import { AppFooter } from "../brand/AppFooter";
import { useMobileNavigation } from "@/lib/mobile/useMobileNavigation";
const realFetch=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=realFetch;window.history.replaceState(null,"","/");});

test("navigation has exactly four ordered touch targets and preserves a mounted controller through info and browser Back",async()=>{
  Object.defineProperty(window,"matchMedia",{configurable:true,writable:true,value:(media:string)=>({matches:true,media,addEventListener(){},removeEventListener(){}})});
  let mounts=0,unmounts=0;
  function Controller(){const [value,setValue]=useState("HEADS");useEffect(()=>{mounts++;return()=>{unmounts++;};},[]);return <input aria-label="Controller selection" value={value} onChange={e=>setValue(e.target.value)}/>;}
  function Shell(){const nav=useMobileNavigation();return <div ref={nav.rootRef}><Controller/><p role="status">{nav.tab}:{nav.info??"none"}</p><MobileNavigation tab={nav.tab} onSelect={nav.navigate}/><button onClick={()=>nav.navigate("profile","terms")}>Read terms</button></div>;}
  window.history.replaceState(null,"","/?ref=KEPT");render(createElement(Shell));
  const nav=screen.getByRole("navigation",{name:"Mobile navigation"});
  assert.deepEqual(within(nav).getAllByRole("button").map(b=>b.textContent),["social","play","flips","profile"]);
  fireEvent.change(screen.getByLabelText("Controller selection"),{target:{value:"TAILS"}});
  for(const tab of ["social","flips","profile"]){fireEvent.click(within(nav).getByRole("button",{name:tab}));assert.equal(screen.getByRole("status").textContent,`${tab}:none`);}
  fireEvent.click(screen.getByRole("button",{name:"Read terms"}));assert.equal(screen.getByRole("status").textContent,"profile:terms");
  window.history.replaceState(null,"","/?ref=KEPT&tab=play");fireEvent(window,new window.PopStateEvent("popstate"));
  await waitFor(()=>assert.equal(screen.getByRole("status").textContent,"play:none"));
  assert.equal((screen.getByLabelText("Controller selection") as HTMLInputElement).value,"TAILS");
  assert.equal(mounts,1);assert.equal(unmounts,0);assert.equal(new URLSearchParams(window.location.search).get("ref"),"KEPT");
});

test("the compact pill selects actual allowed tiers, locks future rooms and closes on selection/Escape",async()=>{
  const selected:number[]=[];
  const view=render(createElement(MobileRoomSelector,{tier:1,locked:false,liveTiers:[1,10],onSelect:t=>selected.push(t)}));
  fireEvent.click(screen.getByRole("button",{name:"Choose room, $1 selected"}));
  const menu=screen.getByRole("group",{name:"Choose a room"});
  for(const label of ["$100","$1,000"]){const button=within(menu).getByRole("button",{name:label}) as HTMLButtonElement;assert.equal(button.disabled,true);fireEvent.click(button);}
  assert.equal(selected.length,0);fireEvent.click(within(menu).getByRole("button",{name:"$10"}));
  assert.deepEqual(selected,[10]);assert.equal(screen.queryByRole("group",{name:"Choose a room"}),null);
  view.rerender(createElement(MobileRoomSelector,{tier:10,locked:false,liveTiers:[1,10],onSelect:t=>selected.push(t)}));
  fireEvent.click(screen.getByRole("button",{name:"Choose room, $10 selected"}));fireEvent.keyDown(document,{key:"Escape"});assert.equal(screen.queryByRole("group",{name:"Choose a room"}),null);
  view.rerender(createElement(MobileRoomSelector,{tier:10,locked:true,liveTiers:[1,10],onSelect:t=>selected.push(t)}));
  assert.equal((screen.getByRole("button",{name:"Choose room, $10 selected"}) as HTMLButtonElement).disabled,true);
});

test("Profile page reuses every profile section and keeps the footer after its controls",async()=>{
  globalThis.fetch=async()=>Response.json({team:"HEADS",completed:true});
  const props={wallet:null,account:null,address:"SYNTHETIC_PROFILE",profile:null,presentation:"page" as const,balanceLabel:"200 HTS",footer:createElement(AppFooter),onClose(){},onChanged(){},onLogout(){}};
  const view=render(createElement(ProfileModal,props));
  const profile=screen.getByRole("region",{name:"Profile"});assert.equal(profile.hasAttribute("aria-modal"),false);
  assert.equal(screen.queryByRole("dialog",{name:"Profile"}),null);
  assert.deepEqual(within(profile).getAllByRole("tab").map(e=>e.textContent),["Profile","Referrals","Airdrop","Report Bug"]);
  for(const name of ["Change avatar","Copy address","TEAM HEADS","TEAM TAILS","Save","Disconnect wallet","Back to Play"])assert(within(profile).getByRole("button",{name}));
  assert.equal(within(profile).queryByRole("button",{name:"Choose Later"}),null);
  assert.equal(profile.lastElementChild?.tagName,"FOOTER");
  for(const name of ["Tokenomics","Roadmap","Terms","Privacy","GitHub","Discord"])assert(within(profile).getByRole("link",{name}));
  profile.scrollTop=340;fireEvent.scroll(profile);view.rerender(createElement(ProfileModal,{...props,hidden:true}));profile.scrollTop=0;fireEvent.scroll(profile);
  view.rerender(createElement(ProfileModal,{...props,hidden:false}));assert.equal(profile.scrollTop,340);
});

test("visual viewport keyboard resizing works even when Android also shrinks innerHeight",async(t)=>{
  const viewport=new window.EventTarget();Object.assign(viewport,{height:844,offsetTop:0});
  const original=Object.getOwnPropertyDescriptor(window,"visualViewport"),innerHeight=window.innerHeight;
  const media=window.matchMedia;
  Object.defineProperty(window,"matchMedia",{configurable:true,writable:true,value:(query:string)=>({matches:true,media:query,addEventListener(){},removeEventListener(){}})});
  t.after(()=>{if(original)Object.defineProperty(window,'visualViewport',original);else Reflect.deleteProperty(window,'visualViewport');window.innerHeight=innerHeight;Object.defineProperty(window,'matchMedia',{configurable:true,writable:true,value:media});});
  Object.defineProperty(window,"visualViewport",{configurable:true,value:viewport});Object.defineProperty(window,"innerHeight",{configurable:true,writable:true,value:844});
  function Shell(){const nav=useMobileNavigation();return <div ref={nav.rootRef} data-testid="keyboard-shell"><textarea aria-label="Keyboard draft"/></div>;}
  const view=render(createElement(Shell));
  const root=view.getByTestId('keyboard-shell'),input=screen.getByLabelText('Keyboard draft');
  await act(async()=>{input.focus();Object.assign(viewport,{height:440});window.innerHeight=440;viewport.dispatchEvent(new window.Event('resize'));});
  assert.equal(root.style.getPropertyValue('--mobile-app-height'),'440px');assert.equal(root.dataset.keyboardOpen,'true');
  await act(async()=>{Object.assign(viewport,{height:844});window.innerHeight=844;viewport.dispatchEvent(new window.Event('resize'));});
  assert.equal(root.dataset.keyboardOpen,'false');
});

test("Flips requests only 50 completed rows; Back restores list scroll and exposes recorded evidence only",async()=>{
  const reads:string[]=[];
  globalThis.fetch=async(input,init)=>{
    assert(!init?.method||init.method==="GET","No writes allowed in fixture");
    const url=String(input);reads.push(url);
    if(url.includes('/rest/v1/matches'))return Response.json([{id:1,onchain_match_id:"701",result:"TAILS",winner_wallet:"T",heads_wallet:"H",tails_wallet:"T",heads_amount:"100000000",tails_amount:"100000000",token_mint:"M",settled_at:"2026-11-03T00:00:00Z",transaction_signature:"5".repeat(88),tier_usd:1}]);
    return Response.json({});
  };
  render(createElement(MobileFlips,{active:true}));
  const row=await screen.findByRole("button",{name:"View ROUND #701"});
  const requested=new URL(reads.find(s=>s.includes('/rest/v1/matches'))!);assert.equal(requested.searchParams.get('limit'),'50');assert.equal(requested.searchParams.get('settled_at'),'not.is.null');
  const list=row.closest('.mobile-flips-list') as HTMLDivElement;list.scrollTop=240;fireEvent.scroll(list);
  fireEvent.click(row);const detail=screen.getByRole("region",{name:"ROUND #701 details"});
  assert.match(detail.textContent??"",/HEADS stake100000000 base units/);assert.match(detail.textContent??"",/Payout evidenceSettlement transaction below/);
  assert.equal(within(detail).queryByRole("link",{name:/ORAO fulfillment/}),null,"Missing metadata must never fabricate a signature");
  assert.match(within(detail).getByRole("link",{name:/View Settlement on Solana Explorer/}).getAttribute('href')??'',/cluster=devnet/);
  fireEvent.click(within(detail).getByRole("button",{name:"Back to Flips"}));await waitFor(()=>assert.equal(list.scrollTop,240));
});

test("mobile information reuses disclosures and handles Back without navigation away from the controller",()=>{
  let back=0;
  render(createElement(MobileInformation,{page:"terms",onBack(){back++;},onNavigate(){}}));
  assert(screen.getByRole("heading",{name:"Terms (Devnet Beta)"}));assert.match(document.body.textContent??"",/no guaranteed real-world value/);
  fireEvent.click(screen.getByRole("link",{name:"← Back to game"}));assert.equal(back,1);assert.equal(window.location.pathname,"/");
});
