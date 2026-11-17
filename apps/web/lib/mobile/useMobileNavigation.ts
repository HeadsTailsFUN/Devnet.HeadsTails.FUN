"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MOBILE_APP_QUERY, mobileLocation, readMobileLocation, type MobileTab, type InformationPage } from "./navigation";

/** Presentation only: this hook never mounts/unmounts the game controller or signs. */
export function useMobileNavigation() {
  const [mobile, setMobile] = useState(false);
  const [location, setLocation] = useState<{tab:MobileTab;info:InformationPage|null}>({tab:"play",info:null});
  const rootRef = useRef<HTMLDivElement>(null);
  const locationRef=useRef(location),profileReturnRef=useRef<MobileTab>("play");
  const applyLocation=useCallback((next:{tab:MobileTab;info:InformationPage|null})=>{
    if(next.tab==="profile"&&locationRef.current.tab!=="profile")profileReturnRef.current=locationRef.current.tab;
    locationRef.current=next;setLocation(next);
  },[]);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_APP_QUERY);
    const syncMedia = () => setMobile(media.matches);
    const syncLocation = () => applyLocation(readMobileLocation(window.location.search));
    syncMedia(); syncLocation();
    media.addEventListener("change",syncMedia);
    window.addEventListener("popstate",syncLocation);
    return () => {media.removeEventListener("change",syncMedia);window.removeEventListener("popstate",syncLocation);};
  },[applyLocation]);
  useEffect(() => {
    if(!mobile) return;
    const viewport=window.visualViewport;
    let restingHeight=viewport?.height ?? window.innerHeight;
    const resize=() => {
      const root=rootRef.current;if(!root)return;
      root.style.setProperty("--mobile-app-height",`${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--mobile-app-top",`${viewport?.offsetTop ?? 0}px`);
      const focused=document.activeElement;
      const editing=!!focused?.matches("input,textarea,[contenteditable=true]");
      const height=viewport?.height ?? window.innerHeight;
      if(!editing)restingHeight=height;
      root.dataset.keyboardOpen=String(editing && height < restingHeight * .8);
    };
    resize();viewport?.addEventListener("resize",resize);viewport?.addEventListener("scroll",resize);
    window.addEventListener("resize",resize);window.addEventListener("focusin",resize);window.addEventListener("focusout",resize);
    return ()=>{viewport?.removeEventListener("resize",resize);viewport?.removeEventListener("scroll",resize);window.removeEventListener("resize",resize);window.removeEventListener("focusin",resize);window.removeEventListener("focusout",resize);};
  },[mobile]);
  const navigate=useCallback((tab:MobileTab,info:InformationPage|null=null)=>{
    const next=mobileLocation(window.location.search,tab,info);
    if(next!==window.location.search) window.history.pushState(window.history.state,"",`${window.location.pathname}${next}${window.location.hash}`);
    applyLocation({tab,info});
  },[applyLocation]);
  const backFromProfile=useCallback(()=>navigate(profileReturnRef.current),[navigate]);
  return {mobile,...location,navigate,backFromProfile,rootRef};
}
