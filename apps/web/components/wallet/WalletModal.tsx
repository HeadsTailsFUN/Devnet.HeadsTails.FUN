"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Wallet } from "@wallet-standard/base";
import { useWalletState, walletKey } from "./WalletProvider";
import {
  CAPABILITY_LABEL,
  compatibleInjectedWallets,
  isMobileUserAgent,
  mobileWalletActions,
  platformFromUserAgent,
} from "@/lib/solana/mobileWallets";
import { IS_DEVNET } from "@/lib/solana/cluster";
import { FAUCET_CLAIM_HTS } from "@/lib/solana/faucetGate";
import { LinkIcon } from "@/components/ui/icons";

const EXPECTED_CHAIN = IS_DEVNET ? "solana:devnet" : "solana:mainnet";

export function WalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { wallets, connect, connectWalletConnect, connecting, error } = useWalletState();
  const mobile = useMemo(
    () =>
      typeof navigator !== "undefined"
        ? isMobileUserAgent(navigator.userAgent)
        : false,
    []
  );
  const mobileActions = useMemo(() => {
    if (!mobile || typeof window === "undefined") return [];
    return mobileWalletActions(
      window.location.href,
      window.location.origin,
      platformFromUserAgent(navigator.userAgent)
    );
  }, [mobile]);

  // In-app detection: inspect the live Wallet Standard registry for
  // compatible Solana providers. Single injected provider -> show ONLY it.
  const compatible = useMemo(
    () => compatibleInjectedWallets(wallets, EXPECTED_CHAIN),
    [wallets]
  );
  const inAppSingle = mobile && compatible.length === 1;
  const inAppMultiple = mobile && compatible.length > 1;
  const showCurated = mobile && compatible.length === 0;

  // HT-QA-005: accessible dialog behavior — focus moves inside on open,
  // stays trapped while open, returns to the trigger on close.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what opened the dialog so focus can return on close.
    triggerRef.current =
      document.activeElement instanceof Element ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling inside the dialog.
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const items = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Move focus inside on open (first focusable, fallback to dialog).
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      const first = root?.querySelector<HTMLElement>("button:not([disabled]), a[href]");
      if (first) first.focus();
      else root?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      // Return focus to the original trigger when appropriate.
      const trigger = triggerRef.current as HTMLElement | null;
      if (trigger && typeof trigger.focus === "function") {
        try {
          trigger.focus();
        } catch {
          // ignore
        }
      }
      triggerRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const pick = async (w: Wallet) => {
    await connect(w);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect a Solana wallet"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close wallet dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div ref={dialogRef} tabIndex={-1} className="glass relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-3xl p-5">
        <h2 className="font-display text-[19px] font-bold text-white">
          Connect wallet
        </h2>
        {IS_DEVNET && (
          <div className="mt-3 space-y-1 rounded-2xl border border-white/10 bg-white/5 p-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            <p>Set your wallet network to <strong className="text-white">Devnet</strong></p>
            <p>You&apos;ll receive <strong className="text-white">{FAUCET_CLAIM_HTS.toLocaleString("en-US")} test HTS</strong> by connecting new wallet.</p>
          </div>
        )}
        {IS_DEVNET && (showCurated || (!mobile && wallets.length===0)) && <div className="mt-4">
          <button type="button" disabled={connecting} onClick={async()=>{if(await connectWalletConnect())onClose();}}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-4 text-left font-bold text-white transition hover:bg-white/10 disabled:opacity-60">
            <LinkIcon className="h-7 w-7 shrink-0"/>
            <span>{connecting ? "Connecting…" : "WalletConnect"}</span>
          </button>
          <p className="mt-2 px-1 text-xs leading-relaxed text-[var(--text-secondary)]">{mobile ? "Stay in this browser. Approve in a wallet that supports Solana Devnet." : "Scan with a mobile wallet that supports Solana Devnet."}</p>
          {mobile && <p className="mt-3 px-1 text-xs font-semibold text-white/60">Or open your wallet browser:</p>}
        </div>}
        {wallets.length === 0 && !mobile && (
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-[13px] text-[var(--text-secondary)]">
            No wallet extension detected. Use WalletConnect above or install a Solana wallet extension.
          </p>
        )}
        {mobile && (inAppSingle || inAppMultiple) && (
          <ul className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {compatible.map((w) => (
              <li key={walletKey(w)}>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => pick(w)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left transition hover:bg-white/10 disabled:opacity-60"
                >
                  {w.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={w.icon}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 shrink-0 rounded-full object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white"
                    >
                      {w.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="text-[15px] font-bold text-white">{w.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {mobile && showCurated && (
          <ul className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {mobileActions.map((a) => (
              <li key={a.id}>
                {a.inert || !a.href ? (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="flex min-h-[52px] w-full cursor-not-allowed items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left opacity-60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.logo}
                      alt=""
                      width={28}
                      height={28}
                      draggable={false}
                      className="h-7 w-7 shrink-0 rounded-full bg-white/10 object-contain"
                    />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">{a.label}</span>
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white/60">
                      {CAPABILITY_LABEL[a.capability]}
                    </span>
                  </button>
                ) : (
                  <a
                    href={a.href}
                    className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left transition hover:bg-white/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.logo}
                      alt=""
                      width={28}
                      height={28}
                      draggable={false}
                      className="h-7 w-7 shrink-0 rounded-full bg-white/10 object-contain"
                    />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">{a.label}</span>
                    {a.capability !== "available" && (
                      <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white/60">
                        {CAPABILITY_LABEL[a.capability]}
                      </span>
                    )}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {(!mobile || (!inAppSingle && !inAppMultiple)) && (
          <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {!mobile &&
              wallets.map((w) => (
                <li key={walletKey(w)}>
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() => pick(w)}
                    className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 text-left transition hover:bg-white/10 disabled:opacity-60"
                  >
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={w.icon}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 shrink-0 rounded-full object-contain"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white"
                      >
                        {w.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="text-[15px] font-bold text-white">{w.name}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-[#ff9db1]">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-white/15 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
