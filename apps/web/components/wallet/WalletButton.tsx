"use client";

import type { GameStateId } from "@/lib/mockGameData";
import { WalletIcon } from "@/components/ui/icons";

export function WalletButton({
  state,
  onConnect,
  onDisconnect,
  addressLabel,
  live,
}: {
  state: GameStateId;
  onConnect: () => void;
  onDisconnect: () => void;
  addressLabel?: string;
  live?: boolean;
}) {
  const connected = state !== "disconnected";
  if (!connected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="font-display inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-[var(--heads)] px-5 text-[15px] font-bold text-[#04120d] shadow-[0_10px_30px_-10px_var(--heads-glow)] transition hover:brightness-105 active:translate-y-px"
      >
        <WalletIcon className="h-5 w-5" />
        Connect Wallet
      </button>
    );
  }
  const label = addressLabel ?? "7xK9…pL";
  return (
    <button
      type="button"
      onClick={onDisconnect}
      className="glass inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white transition hover:bg-[var(--bg-panel-hover)]"
      aria-label={`Disconnect wallet ${label}`}
    >
      <span className="h-2 w-2 rounded-full bg-[var(--heads)] shadow-[0_0_10px_var(--heads)]" aria-hidden="true" />
      {label}
      {!live && (
        <span className="hidden text-[var(--text-secondary)] sm:inline">(dev mock)</span>
      )}
    </button>
  );
}
