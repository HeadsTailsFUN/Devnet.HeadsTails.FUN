import Image from "next/image";
import Link from "next/link";
import { InfoPage } from "./InfoPage";

const allocations = [
  ["Founder", 15, "#32f5c4"],
  ["Team", 5, "#77ffe0"],
  ["Player Rewards", 30, "#ff7ebd"],
  ["Ecosystem", 15, "#d564ef"],
  ["Treasury", 15, "#75aaff"],
  ["Liquidity", 15, "#f4c276"],
  ["Initial Community", 5, "#d9e8ef"],
] as const;
export function TokenomicsContent() {
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

const stages = [
  {
    name: "DEVNET BETA",
    tag: "Live · improving",
    items: [
      "HTS gameplay",
      "Real matchmaking and settlement",
      "Community testing",
      "Reliability improvements",
    ],
  },
  {
    name: "COMMUNITY & GROWTH",
    tag: "Building on existing features",
    items: [
      "Points and referrals",
      "Leaderboards",
      "Community competition",
      "Gameplay improvements",
    ],
  },
  {
    name: "EXPANSION",
    tag: "Planned",
    items: [
      "Additional rooms",
      "Better UX and infrastructure",
      "Community campaigns",
      "Future product opportunities",
    ],
  },
];
export function RoadmapContent() {
  return (
    <InfoPage title="The next flips." eyebrow="HEADSTAILS / ROADMAP">
      <div className="grid gap-4 md:grid-cols-3">
        {stages.map((stage, i) => (
          <section key={stage.name} className="glass rounded-3xl p-5">
            <span className="font-display text-4xl text-white/15">
              0{i + 1}
            </span>
            <h2 className="font-display mt-3 text-xl text-white">
              {stage.name}
            </h2>
            <p
              className={`my-3 text-xs font-bold ${i === 1 ? "text-[var(--tails)]" : "text-[var(--heads)]"}`}
            >
              {stage.tag}
            </p>
            <ul className="space-y-2">
              {stage.items.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p>
        HTS matches and payouts have been verified on Devnet. Points, referrals
        and leaderboards are implemented; community programs and further
        expansion remain plans. No dates, listings, financial returns or future
        airdrops are guaranteed.
      </p>
    </InfoPage>
  );
}


export function TermsPageContent() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col gap-4 px-6 py-16">
      <p className="inline-flex w-fit rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[12px] font-bold tracking-widest text-amber-200">
        DEVNET BETA — NOT LEGAL ADVICE
      </p>
      <h1 className="font-display text-3xl font-bold">Terms (Devnet Beta)</h1>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        HeadsTails.fun is currently a Devnet Beta 1v1 heads-or-tails game on
        Solana. This page describes the current test deployment. It is product
        documentation, not a substitute for professional legal review.
      </p>
      <h2 className="font-display text-xl font-bold">How the game works</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Connect a wallet, choose HEADS or TAILS, join a FIFO queue in the $1 or
        $10 Devnet room, get matched, resolve via ORAO randomness, and the
        winner receives the full pot through permissionless settlement. $100 and
        $1000 rooms are Opening Soon. Stakes use Devnet test tokens with no
        guaranteed real-world value. The reference 100 HTS = $1 is simulated,
        not a market price. Connecting or verifying a wallet does not authorize
        a stake; you explicitly initiate a game and approve its transaction.
        On-chain transactions are public and cannot be reversed by this website.
      </p>
      <h2 className="font-display text-xl font-bold">Devnet vs Mainnet</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Devnet gameplay uses test tokens and test infrastructure only. Nothing
        on this page offers real-money gaming, investment returns, or token
        value. A future Mainnet deployment — if any — would ship separate terms,
        eligibility rules, and risk disclosures after review.
      </p>
      <h2 className="font-display text-xl font-bold">
        Points, referrals, and reports
      </h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Airdrop Points track Beta participation and are not a promise of cash,
        tokens, or conversion. Referral records track invitations only. Bug
        reports and social claims are reviewed by the team; submission does not
        guarantee payment or approval. Moderation (including reward exclusions)
        may apply to abuse. Welcome grants and Devnet fee assistance transfer
        test resources subject to eligibility, budgets and availability; they
        are not guaranteed. Team preference is optional and never sets your game
        side.
      </p>
      <h2 className="font-display text-xl font-bold">Acceptable use</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Do not exploit, automate abuse, impersonate others, post harmful chat
        content, or interfere with other players. The team may moderate chat,
        restrict accounts from rewards, or pause Beta features to protect fair
        play. Usernames, avatars and chat are public-facing content; do not
        share sensitive information or content you lack permission to use.
        Provider outages, network delays and software defects can interrupt
        matchmaking or settlement. Automatic recovery is bounded, not an uptime
        guarantee.
      </p>
      <Link
        href="/"
        className="font-semibold text-[var(--heads)] hover:underline"
      >
        ← Back to game
      </Link>
    </main>
  );
}


export function PrivacyPageContent() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col gap-4 px-6 py-16">
      <p className="inline-flex w-fit rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[12px] font-bold tracking-widest text-amber-200">
        DEVNET BETA — NOT LEGAL ADVICE
      </p>
      <h1 className="font-display text-3xl font-bold">
        Privacy Notice (Devnet Beta)
      </h1>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        HeadsTails.fun is currently a Devnet Beta. This notice describes what
        the current application processes. It is product documentation, not a
        substitute for professional legal review.
      </p>
      <h2 className="font-display text-xl font-bold">What the app processes</h2>
      <ul className="list-disc pl-6 text-[15px] leading-relaxed text-[var(--text-secondary)]">
        <li>Wallet public addresses you connect with.</li>
        <li>Server-side wallet-auth sessions (signed ownership challenges).</li>
        <li>
          Usernames, uploaded avatars, optional team preference and whether you
          dismissed the team prompt.
        </li>
        <li>
          Gameplay history (queues, matches, stakes, results, settlements).
        </li>
        <li>Chat messages you send in Global Chat.</li>
        <li>Referral relationships (inviter / invitee links).</li>
        <li>Airdrop Points earned from gameplay and social claims.</li>
        <li>Social / X claim information you submit for verification.</li>
        <li>
          Bug reports you file, including an optional Telegram handle when you
          voluntarily provide one.
        </li>
        <li>
          Admin and moderation metadata (reward exclusions, user moderation
          actions, bug-bounty review state).
        </li>
        <li>
          Technical request information such as IP addresses used for
          authentication/abuse controls, session cookies, message retry
          identifiers and service logs.
        </li>
      </ul>
      <h2 className="font-display text-xl font-bold">
        Visibility and services
      </h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Blockchain addresses, transfers and game results are public on Solana.
        Profiles, avatars and Global Chat are visible to other visitors. The
        normal chat view shows the last 100 messages and recent history the last
        50 settled games; older records are not deleted by those limits. The
        application uses Vercel hosting, Supabase data/storage and wallet
        sessions, Solana RPC services and ORAO randomness. Your wallet provider
        controls its own signing interface. The website never needs your seed
        phrase or private key. Local browser storage supports reconnects and
        stable result presentation. Do not post secrets in chat or profiles.
      </p>
      <h2 className="font-display text-xl font-bold">Devnet vs Mainnet</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Devnet uses test tokens with no real-world value. A future Mainnet
        deployment with real value would operate under separate infrastructure,
        separate data stores, and updated notices. Nothing here describes
        Mainnet behavior.
      </p>
      <h2 className="font-display text-xl font-bold">
        Airdrop Points and bug bounty
      </h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Airdrop Points are Devnet Beta engagement records only. They are not a
        promise of cash, tokens, conversion, or any guaranteed reward. Bug
        reports help improve the product; submitting one does not promise
        automatic payment.
      </p>
      <Link
        href="/"
        className="font-semibold text-[var(--heads)] hover:underline"
      >
        ← Back to game
      </Link>
    </main>
  );
}
