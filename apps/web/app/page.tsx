"use client";

import { LiveGameClient } from "@/components/game/LiveGameClient";
import { WalletStandardProvider } from "@/components/wallet/WalletProvider";
import { EarnPointsProvider } from "@/components/earn/EarnPointsProvider";

export default function HomePage() {
  return (
    <>
      <link rel="preload" href="/assets/background-panorama.webp" as="image" type="image/webp" fetchPriority="high" />
      <WalletStandardProvider>
        <EarnPointsProvider><LiveGameClient /></EarnPointsProvider>
      </WalletStandardProvider>
    </>
  );
}
