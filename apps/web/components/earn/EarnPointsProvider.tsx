"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WalletModal } from "@/components/wallet/WalletModal";
import { EarnPointsContext } from "./EarnPointsContext";

import { EarnPointsModal } from "./EarnPointsModal";

/** Shares the existing wallet provider and never replaces the mounted game. */
export function EarnPointsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    trigger.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : document.querySelector<HTMLElement>(".earn-entry");
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setWalletOpen(false);
  }, []);
  useEffect(() => {
    if (open || !trigger.current) return;
    const target = trigger.current.isConnected ? trigger.current : document.querySelector<HTMLElement>(".earn-entry");
    target?.focus({ preventScroll: true });
    trigger.current = null;
  }, [open]);
  const play = useCallback(() => {
    close();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "play");
    url.searchParams.delete("info");
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [close]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("earn") !== "1") return;
    show();
    url.searchParams.delete("earn");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [show]);
  const context = useMemo(() => ({ open: show }), [show]);
  return <EarnPointsContext.Provider value={context}>
    {children}
    {open && <EarnPointsModal visible={!walletOpen} onClose={close} onPlay={play} onConnect={() => setWalletOpen(true)} />}
    <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
  </EarnPointsContext.Provider>;
}
