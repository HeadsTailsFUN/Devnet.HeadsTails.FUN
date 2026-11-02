"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
export type Team = "HEADS" | "TAILS" | null;
export function TeamPreference({
  value,
  onSave,
  busy = false,
}: {
  value: Team;
  onSave: (team: Team) => void;
  busy?: boolean;
}) {
  return (
    <fieldset disabled={busy} className="mt-3">
      <legend className="text-sm font-bold">Your community team</legend>
      <p className="mb-2 text-xs text-white/60">
        A preference, never your game side.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["HEADS", "TAILS"] as const).map((team) => (
          <button
            type="button"
            key={team}
            aria-pressed={value === team}
            onClick={() => onSave(team)}
            className={`min-h-[44px] rounded-xl border px-2 text-xs font-bold ${value === team ? "border-[var(--heads)] bg-white/10" : "border-white/15"}`}
          >
            {`TEAM ${team}`}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export function TeamWelcome({
  wallet,
  onSaved,
}: {
  wallet: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let stopped = false;
    void fetch(`/api/profile/team?wallet=${encodeURIComponent(wallet)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!stopped && data && !data.completed) setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [wallet]);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  async function save(team: Team) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/profile/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team, wallet }),
      });
      if (!r.ok) throw Error("Could not save. Please retry.");
      setOpen(false);
      onSaved();
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Choose your team"
        className="glass w-full max-w-md rounded-3xl p-6 text-center"
        onKeyDown={(e) => {
          if (e.key === "Escape") void save(null);
          if (e.key === "Tab") {
            const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 className="font-display text-2xl">Which team are you?</h2>
        <p className="mt-2 text-sm text-white/60">
          Pick a favorite. You can play either side, every round.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {(["HEADS", "TAILS"] as const).map((team) => (
            <button
              type="button"
              disabled={busy}
              key={team}
              onClick={() => void save(team)}
              className="rounded-2xl border border-white/15 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <Image
                src={`/assets/characters/${team === "HEADS" ? "Head" : "Tail"}.png`}
                alt=""
                width={120}
                height={120}
                className="mx-auto h-28 w-full max-w-28 object-contain"
              />
              <span
                className={
                  team === "HEADS"
                    ? "text-[var(--heads)]"
                    : "text-[var(--tails)]"
                }
              >
                TEAM {team}
              </span>
            </button>
          ))}
        </div>
        <button
          ref={closeRef}
          type="button"
          disabled={busy}
          onClick={() => void save(null)}
          className="mt-3 min-h-[44px] px-5 text-sm text-white/70"
        >
          Choose Later
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
