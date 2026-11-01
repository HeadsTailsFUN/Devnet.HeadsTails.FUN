const HEADS_IMG = "/assets/coin/heads-coin.webp";
const TAILS_IMG = "/assets/coin/tails-coin.webp";

function QueueCell({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  sub: string;
  accent?: "heads" | "tails";
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border border-white/8 px-3 py-3 text-center sm:rounded-none sm:border-0 sm:px-4">
      <span className="flex h-9 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      {/* Fixed heading height: one- or two-line labels never shift siblings. */}
      <span className="flex min-h-[2.6em] items-center justify-center text-[13px] font-bold leading-snug text-white">
        {label}
      </span>
      {/* Fixed value slot: counters share one baseline whether set or loading. */}
      <span
        className={`font-display flex h-8 items-center justify-center text-[26px] font-bold leading-none ${
          accent === "heads" ? "text-[var(--heads)]" : accent === "tails" ? "text-[var(--tails)]" : "text-white"
        }`}
      >
        {value ?? "…"}
      </span>
      <span className="flex min-h-[1.4em] items-center justify-center text-[11.5px] leading-snug text-[var(--text-secondary)]">
        {sub}
      </span>
    </div>
  );
}

export function QueueStatusBar({
  headsWaiting,
  tailsWaiting,
}: {
  headsWaiting?: number | null;
  tailsWaiting?: number | null;
}) {
  // No mock fallback: undefined means still loading.
  const sub = "live • on-chain";
  const metric = (n?: number | null) => ({
    value: typeof n === "number" ? String(n) : undefined,
    sub: typeof n === "number" ? sub : "loading…",
  });
  const heads = metric(headsWaiting);
  const tails = metric(tailsWaiting);
  return (
    <section aria-label="Queue status" className="w-full max-w-[880px]">
      {/*
        TARGET DESKTOP ORDER (left → right): TAILS WAITING | FIFO QUEUE |
        AUTO ON-CHAIN | HEADS WAITING. Data stays bound to its side: the
        tails counter drives the TAILS cell, heads counter drives HEADS.
        Mobile 2×2 follows the same DOM order: row 1 = TAILS + FIFO,
        row 2 = AUTO + HEADS — balanced, HEADS/TAILS remain opposite corners
        and immediately distinguishable.
      */}
      <div className="glass grid min-w-0 grid-cols-2 gap-2 rounded-3xl p-2 sm:gap-0 sm:p-0 sm:grid-cols-4 sm:divide-x sm:divide-white/8">
        {/* Waiting artwork reuses the real coin assets at the same footprint. */}
        <QueueCell
          // eslint-disable-next-line @next/next/no-img-element
          icon={<img src={TAILS_IMG} alt="" width={36} height={36} draggable={false} className="h-9 w-9 shrink-0 object-contain" />}
          label="Tails Waiting"
          value={tails.value}
          sub={tails.sub}
          accent="tails"
        />
        <QueueCell
          label="FIFO Queue"
          sub="Fair. First in, first matched."
          icon={<span aria-hidden="true" className="inline-block h-9 w-9 shrink-0 text-center text-[22px] font-bold leading-9 text-slate-200">≡</span>}
        />
        <QueueCell
          label="Auto On-Chain"
          sub="Transparent • Provably fair"
          icon={<span aria-hidden="true" className="inline-block h-9 w-9 shrink-0 text-center text-[22px] font-bold leading-9 text-slate-200">◈</span>}
        />
        <QueueCell
          // eslint-disable-next-line @next/next/no-img-element
          icon={<img src={HEADS_IMG} alt="" width={36} height={36} draggable={false} className="h-9 w-9 shrink-0 object-contain" />}
          label="Heads Waiting"
          value={heads.value}
          sub={heads.sub}
          accent="heads"
        />
      </div>
    </section>
  );
}
