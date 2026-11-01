import Link from "next/link";

export default function TermsPage() {
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
        winner receives the full pot through permissionless settlement. $100
        and $1000 rooms are Opening Soon. Stakes use Devnet test tokens with no
        real-world value.
      </p>
      <h2 className="font-display text-xl font-bold">Devnet vs Mainnet</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Devnet gameplay uses test tokens and test infrastructure only. Nothing
        on this page offers real-money gaming, investment returns, or token
        value. A future Mainnet deployment — if any — would ship separate
        terms, eligibility rules, and risk disclosures after review.
      </p>
      <h2 className="font-display text-xl font-bold">Points, referrals, and reports</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Airdrop Points track Beta participation and are not a promise of cash,
        tokens, or conversion. Referral records track invitations only. Bug
        reports and social claims are reviewed by the team; submission does not
        guarantee payment or approval. Moderation (including reward exclusions)
        may apply to abuse.
      </p>
      <h2 className="font-display text-xl font-bold">Acceptable use</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Do not exploit, automate abuse, impersonate others, post harmful chat
        content, or interfere with other players. The team may moderate chat,
        restrict accounts from rewards, or pause Beta features to protect fair
        play.
      </p>
      <Link href="/" className="font-semibold text-[var(--heads)] hover:underline">
        ← Back to game
      </Link>
    </main>
  );
}
