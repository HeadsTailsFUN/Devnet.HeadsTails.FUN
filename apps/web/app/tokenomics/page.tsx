import Image from "next/image";
import { InfoPage } from "@/components/brand/InfoPage";
export const metadata = { title: "HTS Tokenomics — HeadsTails.fun" };
const allocations = [
  ["Founder", 15, "#32f5c4"],
  ["Team", 5, "#77ffe0"],
  ["Player Rewards", 30, "#ff7ebd"],
  ["Ecosystem", 15, "#d564ef"],
  ["Treasury", 15, "#75aaff"],
  ["Liquidity", 15, "#f4c276"],
  ["Initial Community", 5, "#d9e8ef"],
] as const;
export default function Tokenomics() {
  return (
    <InfoPage title="One token. Every flip." eyebrow="HTS / TOKENOMICS">
      <div className="glass rounded-3xl p-6">
        <div className="flex items-center gap-4">
          <Image
            src="/assets/token/hts.png"
            alt="HeadsTails official coin"
            width={80}
            height={80}
            className="h-20 w-20 object-contain"
          />
          <div>
            <h2 className="font-display text-2xl text-white">
              HeadsTails · HTS
            </h2>
            <p>Solana Devnet · 6 decimals</p>
            <p className="font-bold text-[var(--heads)]">
              1,000,000,000 HTS issued
            </p>
          </div>
        </div>
        <a
          className="mt-4 block break-all text-xs text-white/75 underline"
          href="https://explorer.solana.com/address/HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4?cluster=devnet"
          target="_blank"
          rel="noopener noreferrer"
        >
          HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4 ↗
        </a>
      </div>
      <section>
        <h2 className="font-display mb-4 text-2xl text-white">
          The proposed distribution
        </h2>
        <div className="grid items-center gap-7 sm:grid-cols-[220px_1fr]">
          <div
            role="img"
            aria-label="Proposed allocation: Founder 15%, Team 5%, Player Rewards 30%, Ecosystem 15%, Treasury 15%, Liquidity 15%, Initial Community 5%"
            className="relative mx-auto h-52 w-52 rounded-full"
            style={{
              background:
                "conic-gradient(#32f5c4 0 15%,#77ffe0 15% 20%,#ff7ebd 20% 50%,#d564ef 50% 65%,#75aaff 65% 80%,#f4c276 80% 95%,#d9e8ef 95% 100%)",
            }}
          >
            <div className="absolute inset-8 flex items-center justify-center rounded-full bg-[#080d12] font-display text-2xl text-white">
              HTS
            </div>
          </div>
          <ul className="space-y-2">
            {allocations.map(([label, percent, color]) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="flex-1">{label}</span>
                <strong className="text-white">{percent}%</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <p>
        These percentages are planning allocations, not completed distributions.
        No on-chain vesting or allocation locks are claimed. The owner retains
        mint and metadata update authority; there is no freeze authority.
      </p>
      <p>
        HTS supplies gameplay stakes and a bounded player-reward pool. Welcome
        grants transfer existing tokens. The broader ecosystem and future
        distributions remain subject to separate decisions.
      </p>
      <p className="rounded-2xl border border-white/10 p-4">
        Devnet HTS is a test resource. The reference{" "}
        <strong className="text-white">100 HTS = $1 simulated USD</strong> is
        not a market price, exchange promise or guaranteed value.
      </p>
    </InfoPage>
  );
}
