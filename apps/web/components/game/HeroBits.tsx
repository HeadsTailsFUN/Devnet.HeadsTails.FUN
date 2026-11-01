import { InfoIcon, SolanaIcon } from "@/components/ui/icons";

export function FlipPill({ label }: { label?: string } = {}) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold tracking-widest">
      <SolanaIcon className="h-5 w-5 text-[var(--heads)]" />
      <span className="font-display text-[17px]">{label ?? "$1 FLIP"}</span>
    </span>
  );
}

export function LivePriceNotice({ mode }: { mode: "live" | "unavailable" | "paused" }) {
  if (mode === "unavailable") {
    return (
      <p className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,93,122,.4)] bg-[rgba(255,93,122,.1)] px-4 py-2 text-[13px] font-medium text-[#ff9db1]" role="alert">
        <InfoIcon className="h-4 w-4" />
        Devnet Test Rate unavailable — joining is disabled
      </p>
    );
  }
  if (mode === "paused") {
    return (
      <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-[13px] font-medium text-amber-200" role="status">
        <InfoIcon className="h-4 w-4" />
        Flips are paused — queue is read-only
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 text-[13.5px] text-[var(--text-secondary)]">
      <InfoIcon className="h-4 w-4" aria-hidden="true" />
      Devnet Test Rate: 100 HTS = $1 simulated USD; no guaranteed USD value
    </p>
  );
}
