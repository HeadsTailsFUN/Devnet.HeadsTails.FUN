"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { reactionAsset, WIN_PHRASES, LOSS_PHRASES } from "@/lib/game/reaction";
export function ResultReaction({
  wallet,
  matchId,
  win,
}: {
  wallet: string;
  matchId: string;
  win: boolean;
}) {
  const [reaction, setReaction] = useState<{
    side: "HEADS" | "TAILS";
    win: boolean;
    ordinal: number;
  } | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setReaction(null);
    const choices = win ? WIN_PHRASES : LOSS_PHRASES,
      key = `ht-result-phrase:${wallet}:${matchId}:${win}`;
    const reactionKey = `ht-result-reaction:${wallet}:${matchId}:${win}`;
    let cachedReaction = false;
    try {
      const cached = JSON.parse(localStorage.getItem(reactionKey) ?? "null");
      if (
        cached &&
        ["HEADS", "TAILS"].includes(cached.side) &&
        cached.win === win &&
        Number.isSafeInteger(cached.ordinal) &&
        cached.ordinal > 0
      ) {
        setReaction(cached);
        cachedReaction = true;
      }
    } catch {
      /* Presentation storage is optional. */
    }
    try {
      let selected = localStorage.getItem(key);
      if (!selected || !choices.includes(selected)) {
        selected =
          choices[
            crypto.getRandomValues(new Uint32Array(1))[0] % choices.length
          ];
        localStorage.setItem(key, selected);
      }
      setPhrase(selected);
    } catch {
      setPhrase(choices[Number(BigInt(matchId) % BigInt(choices.length))]);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(attempt: number) {
      try {
        const response = await fetch(
          `/api/profile/reaction?match=${encodeURIComponent(matchId)}`,
          { cache: "no-store" },
        );
        const data = response.ok ? await response.json() : null;
        if (stopped) return;
        if (
          data &&
          ["HEADS", "TAILS"].includes(data.side) &&
          data.win === win &&
          Number.isSafeInteger(data.ordinal) &&
          data.ordinal > 0
        ) {
          setReaction(data);
          try {
            localStorage.setItem(reactionKey, JSON.stringify(data));
          } catch {
            /* Optional cache. */
          }
        } else if (attempt < 4 && response.status !== 401)
          timer = setTimeout(() => {
            void load(attempt + 1);
          }, 1500);
      } catch {
        if (!stopped && attempt < 4)
          timer = setTimeout(() => {
            void load(attempt + 1);
          }, 1500);
      }
    }
    if (!cachedReaction) void load(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [wallet, matchId, win]);
  return (
    <div className="mt-2" aria-label={win ? "You won" : "You lost"}>
      <div className="mx-auto h-28 w-28">
        {reaction && (
          <Image
            src={reactionAsset(reaction.side, win, reaction.ordinal)}
            alt={`${reaction.side} ${win ? "win" : "loss"} reaction`}
            width={112}
            height={112}
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <p
        className={`font-display min-h-7 text-xl font-bold ${!reaction ? "text-white" : reaction.side === "TAILS" ? "text-[var(--tails)]" : "text-[var(--heads)]"}`}
      >
        {phrase}
      </p>
    </div>
  );
}
