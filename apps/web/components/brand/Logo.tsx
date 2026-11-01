import Link from "next/link";

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
        <span className="mt-1 block text-[12.5px] font-medium tracking-wide text-[var(--text-secondary)]">
          HeadsTails.fun
        </span>
      </span>
    </Link>
  );
}
