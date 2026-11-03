import Link from "next/link";
import { IS_DEVNET } from "@/lib/solana/cluster";

export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small static logo; plain img avoids next/image wrapper sizing issues */}
      <img
        src="/assets/coin/default-coin.webp"
        alt=""
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        fetchPriority="high"
        className="h-full w-full object-contain"
        style={{
          filter:
            "drop-shadow(0 0 10px rgba(61,255,200,.35)) drop-shadow(0 0 10px rgba(255,126,189,.28))",
        }}
      />
    </span>
  );
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex min-h-[44px] items-center gap-3" aria-label="Heads or Tails — home">
      <LogoMark size={compact ? 38 : 44} />
      <span className="leading-none">
        <span className="font-display block text-[22px] font-bold tracking-wide sm:text-[24px]">
          <span className="text-[var(--heads)]">HEADS</span>{" "}
          <span className="text-white">OR</span>{" "}
          <span className="text-[var(--tails)]">TAILS</span>
        </span>
        <span className="mt-1 flex items-center gap-2 text-[12.5px] font-medium tracking-wide text-[var(--text-secondary)]">
          <span>HeadsTails.fun</span>
          {IS_DEVNET && <span className="rounded border border-[var(--heads)]/30 bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider text-[var(--heads)]">Devnet</span>}
        </span>
      </span>
    </Link>
  );
}
