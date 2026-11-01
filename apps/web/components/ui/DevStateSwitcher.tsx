"use client";

import { ALL_GAME_STATES, GAME_STATE_LABELS, type GameStateId } from "@/lib/mockGameData";

/**
 * Developer-only state switcher. Rendered only when `enabled` and never in production builds.
 */
export function DevStateSwitcher({
  enabled,
  state,
  onChange,
}: {
  enabled: boolean;
  state: GameStateId;
  onChange: (s: GameStateId) => void;
}) {
  if (!enabled) return null;
  return (
    <aside
      aria-label="Development state switcher"
      className="fixed bottom-3 left-3 z-50 w-[248px] rounded-2xl border border-amber-300/40 bg-black/90 p-3 shadow-2xl backdrop-blur"
    >
      <p className="text-[11px] font-bold tracking-widest text-amber-300">
        DEV ONLY — MOCK STATE
      </p>
      <p className="mt-0.5 text-[11px] text-white/60">Excluded from production builds.</p>
      <label htmlFor="dev-state" className="mt-2 block text-[11px] font-semibold text-white/80">
        Game state
      </label>
      <select
        id="dev-state"
        value={state}
        onChange={(e) => onChange(e.target.value as GameStateId)}
        className="mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-[#0d141d] px-2 text-[13px] font-medium text-white"
      >
        {ALL_GAME_STATES.map((s) => (
          <option key={s} value={s}>
            {GAME_STATE_LABELS[s]}
          </option>
        ))}
      </select>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {ALL_GAME_STATES.slice(0, 8).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={state === s}
            className={`min-h-[36px] rounded-lg px-1 text-[11px] font-semibold transition ${
              state === s ? "bg-amber-300 text-black" : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            {GAME_STATE_LABELS[s]}
          </button>
        ))}
      </div>
    </aside>
  );
}
