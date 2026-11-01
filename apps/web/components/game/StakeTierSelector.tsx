import { LockIcon } from "@/components/ui/icons";
import { ROOMS, resolveRoomCardWithConnection } from "@/lib/game/rooms";

export function StakeTierCard({
  value,
  note,
  active,
  selected,
  onSelect,
  badge,
}: {
  value: string;
  note: string;
  active: boolean;
  selected?: boolean;
  onSelect?: () => void;
  badge?: string | null;
}) {
  if (active) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected ?? false}
        aria-current={selected ? "true" : undefined}
        className={`relative rounded-2xl border px-4 py-4 text-center transition ${
          selected
            ? "neon-heads border-[var(--heads)] bg-[rgba(6,20,16,.85)]"
            : "border-[var(--border-subtle)] bg-[rgba(15,21,30,.7)] hover:border-white/25"
        }`}
      >
        {badge && (
          <span className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full border border-white/15 bg-white/5 px-2 py-px text-[9px] font-bold tracking-widest text-white/60">
            {badge}
          </span>
        )}
        <p className="font-display mt-2 text-[22px] font-bold text-white">{value}</p>
        <p className="mt-1 flex items-center justify-center gap-2 text-[14px] font-semibold text-[var(--heads)]">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--heads)] shadow-[0_0_10px_var(--heads)]" aria-hidden="true" />
          OPEN
        </p>
      </button>
    );
  }
  return (
    <div
      className="rounded-2xl border border-[var(--border-subtle)] bg-[rgba(15,21,30,.7)] px-4 py-4 text-center opacity-80"
      aria-disabled="true"
      title={`${value} — Opening Soon`}
    >
      <p className="font-display text-[22px] font-bold text-slate-300">{value}</p>
      <p className="mt-1 flex items-center justify-center gap-2 text-[14px] font-medium text-[var(--text-secondary)]">
        <LockIcon className="h-4 w-4" />
        {note}
      </p>
    </div>
  );
}

export function StakeTierSelector({
  selectedTier,
  onSelect,
  liveTiers,
  connected,
}: {
  selectedTier?: number;
  onSelect?: (tierUsd: number) => void;
  /** Tiers with a confirmed live on-chain RoomState. Unknown until probed. */
  liveTiers?: number[];
  /** False while wallet is NOT connected: $1/$10 show Connect Wallet. */
  connected?: boolean;
} = {}) {
  const sel = selectedTier ?? 1;
  const live = liveTiers ?? [];
  const isConnected = connected ?? true;
  return (
    <section aria-label="Rooms" className="w-full max-w-[760px]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Pick room">
        {ROOMS.map((t) => {
          const card = resolveRoomCardWithConnection(t.tierUsd, live, isConnected);
          if (card.mode !== "open") {
            return (
              <StakeTierCard
                key={t.label}
                value={t.label}
                note={`${card.note} · ${(t.tierUsd * 100).toLocaleString("en-US")} HTS`}
                active={false}
              />
            );
          }
          return (
            <StakeTierCard
              key={t.label}
              value={t.label}
              note={`${(t.tierUsd * 100).toLocaleString("en-US")} HTS · Devnet Test Rate`}
              active
              selected={sel === t.tierUsd}
              onSelect={() => onSelect?.(t.tierUsd)}
              badge={t.tierUsd === 1 ? "DEFAULT" : null}
            />
          );
        })}
      </div>
    </section>
  );
}
