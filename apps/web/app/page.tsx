"use client";

import { LiveGameClient } from "@/components/game/LiveGameClient";
import { WalletStandardProvider } from "@/components/wallet/WalletProvider";

export default function HomePage() {
  return (
    <WalletStandardProvider>
      <LiveGameClient />
    </WalletStandardProvider>
  );
}
