"use client";

import { LiveGameClient } from "@/components/game/LiveGameClient";
import { WalletStandardProvider } from "@/components/wallet/WalletProvider";
import { EarnPointsProvider } from "@/components/earn/EarnPointsProvider";

export default function HomePage() {
  return (
    <WalletStandardProvider>
      <EarnPointsProvider><LiveGameClient /></EarnPointsProvider>
    </WalletStandardProvider>
  );
}
