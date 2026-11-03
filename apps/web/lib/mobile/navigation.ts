export const MOBILE_APP_QUERY = "(max-width: 767px), (max-width: 1023px) and (max-height: 600px)";
export const MOBILE_TABS = ["social", "play", "flips", "profile"] as const;
export type MobileTab = typeof MOBILE_TABS[number];
export const INFORMATION_PAGES = ["tokenomics", "roadmap", "terms", "privacy"] as const;
export type InformationPage = typeof INFORMATION_PAGES[number];
export function readMobileLocation(search: string): { tab: MobileTab; info: InformationPage | null } {
  const query = new URLSearchParams(search), tab = query.get("tab"), info = query.get("info");
  return { tab: MOBILE_TABS.includes(tab as MobileTab) ? tab as MobileTab : "play",
    info: INFORMATION_PAGES.includes(info as InformationPage) ? info as InformationPage : null };
}
export function mobileLocation(search: string, tab: MobileTab, info: InformationPage | null): string {
  const query = new URLSearchParams(search);
  query.set("tab", tab);
  if(info) query.set("info", info); else query.delete("info");
  return `?${query.toString()}`;
}
export function canChangeMobileRoom(state: string, busy: boolean, hasPosition: boolean, settlementPending: boolean): boolean {
  return !busy && !hasPosition && !settlementPending && !["joining","queued-heads","queued-tails","match-found","flipping"].includes(state);
}
/** An old round's selectedSide must never hide the buttons in Ready. */
export function mobilePlayShowsProgress(state: string): boolean {
  return !["disconnected", "connected", "ready"].includes(state);
}
export function canReturnToSidePicker(state: string, busy: boolean, hasPosition: boolean, settlementPending: boolean, pendingSignature: boolean): boolean {
  return !pendingSignature && canChangeMobileRoom(state,busy,hasPosition,settlementPending) &&
    ["heads-selected","tails-selected","error","insufficient-balance","price-unavailable"].includes(state);
}
/** Copy for the existing controller state; never reports a queue before join confirmation. */
export function mobileGameFeedback(state:string,settlementPending:boolean):string|null {
  if(settlementPending&&(state==="win"||state==="loss"))return "Settlement pending";
  return ({joining:"Transaction pending","queued-heads":"Queued","queued-tails":"Queued","match-found":"Match found",flipping:"Flipping…",win:"You won",loss:"You lost",error:"Action failed"} as Record<string,string>)[state]??null;
}
