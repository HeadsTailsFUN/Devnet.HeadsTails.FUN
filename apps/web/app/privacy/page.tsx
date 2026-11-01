import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col gap-4 px-6 py-16">
      <p className="inline-flex w-fit rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-[12px] font-bold tracking-widest text-amber-200">
        DEVNET BETA — NOT LEGAL ADVICE
      </p>
      <h1 className="font-display text-3xl font-bold">Privacy Notice (Devnet Beta)</h1>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        HeadsTails.fun is currently a Devnet Beta. This notice describes what the
        current application processes. It is product documentation, not a
        substitute for professional legal review.
      </p>
      <h2 className="font-display text-xl font-bold">What the app processes</h2>
      <ul className="list-disc pl-6 text-[15px] leading-relaxed text-[var(--text-secondary)]">
        <li>Wallet public addresses you connect with.</li>
        <li>Server-side wallet-auth sessions (signed ownership challenges).</li>
        <li>Usernames and avatar paths you set on your profile.</li>
        <li>Gameplay history (queues, matches, stakes, results, settlements).</li>
        <li>Chat messages you send in Global Chat.</li>
        <li>Referral relationships (inviter / invitee links).</li>
        <li>Airdrop Points earned from gameplay and social claims.</li>
        <li>Social / X claim information you submit for verification.</li>
        <li>Bug reports you file, including an optional Telegram handle when you voluntarily provide one.</li>
        <li>Admin and moderation metadata (reward exclusions, user moderation actions, bug-bounty review state).</li>
      </ul>
      <h2 className="font-display text-xl font-bold">Devnet vs Mainnet</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Devnet uses test tokens with no real-world value. A future Mainnet
        deployment with real value would operate under separate infrastructure,
        separate data stores, and updated notices. Nothing here describes
        Mainnet behavior.
      </p>
      <h2 className="font-display text-xl font-bold">Airdrop Points and bug bounty</h2>
      <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
        Airdrop Points are Devnet Beta engagement records only. They are not a
        promise of cash, tokens, conversion, or any guaranteed reward. Bug
        reports help improve the product; submitting one does not promise
        automatic payment.
      </p>
      <Link href="/" className="font-semibold text-[var(--heads)] hover:underline">
        ← Back to game
      </Link>
    </main>
  );
}
