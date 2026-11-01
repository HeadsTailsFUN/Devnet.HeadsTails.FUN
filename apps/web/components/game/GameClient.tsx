"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/brand/AppHeader";
import { AppFooter } from "@/components/brand/AppFooter";
import { GameHero } from "@/components/game/GameHero";
import { StakeTierSelector } from "@/components/game/StakeTierSelector";
import { GameStatePanel, TransactionStatus } from "@/components/game/GameStatePanel";
import { RecentFlips } from "@/components/history/RecentFlips";
import { QueueStatusBar } from "@/components/status/QueueStatusBar";
import { DevStateSwitcher } from "@/components/ui/DevStateSwitcher";
import type { GameStateId, Side } from "@/lib/mockGameData";

function resultFor(state: GameStateId, side: Side | null): Side | null {
  if (state === "win") return side ?? "HEADS";
  if (state === "loss") return side === "HEADS" ? "TAILS" : "HEADS";
  return null;
}

export function GameClient() {
  const [state, setState] = useState<GameStateId>("ready");
  const [selectedSide, setSelectedSide] = useState<Side | null>(null);
  const isDev = process.env.NODE_ENV !== "production";

  const handleConnect = useCallback(() => setState("connected"), []);
  const handleDisconnect = useCallback(() => {
    setSelectedSide(null);
    setState("disconnected");
  }, []);
  const handlePick = useCallback(
    (s: Side) => {
      setSelectedSide(s);
      setState(s === "HEADS" ? "heads-selected" : "tails-selected");
    },
    []
  );
  const handleConfirm = useCallback(() => {
    setState("joining");
  }, []);
  const handleLeave = useCallback(() => {
    setState("ready");
  }, []);
  const handleRetry = useCallback(() => {
    setState("ready");
  }, []);
  const handleDevChange = useCallback(
    (s: GameStateId) => {
      if (s === "heads-selected" || s === "queued-heads" || s === "win") {
        if (s === "win" && !selectedSide) setSelectedSide("HEADS");
        if (s.startsWith("queued-heads") || s === "heads-selected") setSelectedSide("HEADS");
      }
      if (s === "tails-selected" || s === "queued-tails" || s === "loss") {
        if (s === "loss" && !selectedSide) setSelectedSide("TAILS");
        if (s.startsWith("queued-tails") || s === "tails-selected") setSelectedSide("TAILS");
      }
      if (s === "disconnected" || s === "connected" || s === "ready") {
        // keep side for ready preview? clear on disconnect only
        if (s === "disconnected") setSelectedSide(null);
      }
      setState(s);
    },
    [selectedSide]
  );

  // Mock async: joining -> queued (based on side)
  useEffect(() => {
    if (state !== "joining") return;
    const side = selectedSide ?? "HEADS";
    const t = setTimeout(() => {
      setState(side === "HEADS" ? "queued-heads" : "queued-tails");
    }, 1400);
    return () => clearTimeout(t);
  }, [state, selectedSide]);

  const result = resultFor(state, selectedSide);

  return (
    <div className="relative flex min-h-[100svh] flex-col">
      <AppHeader state={state} onConnect={handleConnect} onDisconnect={handleDisconnect} />
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-6 px-0 pb-10 pt-6 sm:px-6">
        <GameHero state={state} selectedSide={selectedSide} result={result} onPick={handlePick} />
        <TransactionStatus state={state} />
        <GameStatePanel
          state={state}
          selectedSide={selectedSide}
          result={result}
          onConfirm={handleConfirm}
          onLeave={handleLeave}
          onRetry={handleRetry}
        />
        <StakeTierSelector />
        <RecentFlips />
        <QueueStatusBar />
      </main>
      <AppFooter />
      <DevStateSwitcher enabled={isDev} state={state} onChange={handleDevChange} />
    </div>
  );
}
