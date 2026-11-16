import type { Metadata } from "next";
import Image from "next/image";
import { WelcomeIcon, type WelcomeIconName } from "@/components/welcome/WelcomeIcon";
import { WelcomeReferral } from "@/components/welcome/WelcomeReferral";
import { DiscordIcon, GitHubIcon, TelegramIcon, XIcon } from "@/components/ui/icons";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";
import { welcomeAppHref, type WelcomeSearch } from "@/lib/site/welcome-links";
import "./welcome.css";

export const metadata: Metadata = {
  title: "HeadsTails.fun — Two Idiots. One Coin.",
  description: "Real players. One unpredictable flip. Pick HEADS or TAILS in a 1v1 Solana Devnet game, verify the randomness and earn HeadsTails Points.",
  alternates: { canonical: "https://headstails.fun/welcome" },
  openGraph: {
    title: "HeadsTails.fun — Two Idiots. One Coin.",
    description: "Real players. One unpredictable flip. Try the Solana Devnet Beta with test HTS.",
    url: "https://headstails.fun/welcome", type: "website", siteName: "HeadsTails.fun",
    images: [{ url: "https://headstails.fun/welcome/coin-fire.png", width: 512, height: 512, alt: "The official HeadsTails coin, lit in HEADS green and TAILS pink" }],
  },
  twitter: { card: "summary", title: "HeadsTails.fun — Two Idiots. One Coin.", description: "Real players. One unpredictable flip.", images: ["https://headstails.fun/welcome/coin-fire.png"] },
};

const socials = [
  { name: "X", href: SOCIAL_LINKS.x, Icon: XIcon },
  { name: "Telegram", href: SOCIAL_LINKS.telegram, Icon: TelegramIcon },
  { name: "Discord", href: SOCIAL_LINKS.discord, Icon: DiscordIcon },
  { name: "GitHub", href: SOCIAL_LINKS.github, Icon: GitHubIcon },
];
const steps: { title: string; text: string; icon: WelcomeIconName }[] = [
  { title: "Connect Wallet", text: "Bring your Solana wallet. Phantom, Backpack and more.", icon: "wallet" },
  { title: "Pick a Side", text: "Team HEADS or team TAILS. Same room. Same stake.", icon: "coin" },
  { title: "Match a Player", text: "Join the queue and face another player. No house opponent.", icon: "people" },
  { title: "Verify the Flip", text: "ORAO randomness. A result you can check on-chain.", icon: "bolt" },
];
const reasons: { title: string; text: string; icon: WelcomeIconName }[] = [
  { title: "Real players. Real PvP.", text: "Your side meets another player's side. Just players vs. players.", icon: "people" },
  { title: "ORAO VRF", text: "The flip uses independently verifiable randomness powered by ORAO.", icon: "cube" },
  { title: "On-chain Settlement", text: "Check the match, winning side and token payout on Solana.", icon: "link" },
  { title: "0% Protocol Fee", text: "The full game pot goes to the winner. Network costs can still apply.", icon: "coins" },
];
const faqs = [
  ["What is HeadsTails.fun?", "A 1v1 coin-flip game on Solana. Choose HEADS or TAILS, enter a room and match with another player on the opposite side. The current release runs on Devnet."],
  ["Which wallet do I need?", "Use a compatible Solana wallet such as Phantom or Backpack. Launch the app to see supported wallet options. On mobile, you can open the app in a supported wallet's browser."],
  ["How do I know the flip is fair?", "The match uses ORAO randomness recorded on Solana. The verification guide shows how to read that randomness, calculate the winning side and check the payout. Open-source code is available for independent review; it is not a claim of a security audit."],
  ["Am I playing with real money?", "No. This is the Devnet Beta. The 100 HTS and 1,000 HTS rooms use test tokens. Their $1 and $10 labels are simulated USD references, not redeemable dollar balances."],
  ["How do I get test tokens?", "Connect and authenticate your wallet in the app. Eligible new wallets can receive the site's one-time test-token grant. Availability and funding requirements are shown in the app; test HTS has no promised monetary value."],
  ["What are HeadsTails Points?", "Seasonal activity points: +5 for an eligible win, +2 for an eligible loss, +50 for a qualified referral, and additional points for verified community tasks. Gameplay caps and anti-abuse rules apply. Points do not guarantee future tokens, allocations or financial value."],
  ["Does my friend have to play for a referral to count?", "Yes. Your invited friend must complete three eligible games. A qualified referral gives the inviter 50 Points and the invited friend 25 Points. Later eligible games add 2 Points for the inviter, subject to the current rules."],
];

function Brand({ hero = false }: { hero?: boolean }) {
  return <span className={`w-brand${hero ? " w-brand-hero" : ""}`}>
    <Image src="/welcome/coin.png" alt="" width={hero ? 66 : 42} height={hero ? 66 : 42} sizes={hero ? "66px" : "42px"} className="w-brand-coin" />
    <span>HeadsTails<span className="w-dotfun">.fun</span></span>
  </span>;
}
function SectionTitle({ id, children, note }: { id: string; children: React.ReactNode; note?: string }) {
  return <div className="w-section-heading"><h2 id={id}><span aria-hidden="true">{"//"}</span> {children}</h2>{note ? <p>{note}</p> : null}</div>;
}
function Launch({ href, children = "Launch App", secondary = false }: { href: string; children?: React.ReactNode; secondary?: boolean }) {
  // Plain links deliberately avoid prefetching the wallet/game bundle on the landing page.
  return <a href={href} className={`w-button${secondary ? " w-button-outline" : ""}`}><WelcomeIcon name={secondary ? "flask" : "rocket"} />{children}</a>;
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<WelcomeSearch> }) {
  const search = await searchParams, app = welcomeAppHref(search), earn = welcomeAppHref(search, true), welcome = `/welcome${app.slice(1)}`;
  return <div className="welcome-page">
    <WelcomeReferral />
    <a className="w-skip" href="#welcome-content">Skip to content</a>
    <header className="w-header w-container">
      <a href={welcome} aria-label="HeadsTails.fun welcome"><Brand /></a>
      <nav className="w-desktop-nav" aria-label="Main navigation">
        <a href="#how-it-works">How It Works</a><a href="#fairness">Fairness</a><a href="#earn-points">Earn Points</a><a href="#faq">FAQ</a>
        <details className="w-community-menu"><summary>Community <span aria-hidden="true">⌄</span></summary><div>{socials.map(({ name, href, Icon }) => <a key={name} href={href} target="_blank" rel="noopener noreferrer"><Icon />{name}</a>)}</div></details>
      </nav>
      <div className="w-header-actions"><Launch href={app} /><details className="w-mobile-menu"><summary aria-label="Navigation menu"><span aria-hidden="true">☰</span></summary><nav aria-label="Mobile navigation"><a href="#how-it-works">How It Works</a><a href="#fairness">Fairness</a><a href="#earn-points">Earn Points</a><a href="#faq">FAQ</a><a href="#community">Community</a></nav></details></div>
    </header>

    <main id="welcome-content">
      <section className="w-hero" aria-labelledby="hero-heading">
        <div className="w-hero-grid" aria-hidden="true" /><div className="w-hero-haze w-haze-heads" aria-hidden="true" /><div className="w-hero-haze w-haze-tails" aria-hidden="true" />
        <div className="w-hero-copy"><span className="w-beta-pill"><span /> SOLANA DEVNET BETA</span><Brand hero />
          <h1 id="hero-heading">TWO IDIOTS.{" "}<br /><span>ONE COIN.</span></h1>
          <p className="w-hero-subtitle">Real players. One unpredictable flip.</p>
          <p className="w-hero-description">Pick a side. Find your rival.<br className="w-mobile-break" /> Let the chain decide.</p>
        </div>
        <div className="w-hero-art" aria-hidden="true">
          <Image src="/welcome/heads.png" alt="" width={512} height={512} sizes="(max-width: 600px) 45vw, (max-width: 1000px) 35vw, 440px" quality={90} priority className="w-character w-character-heads" />
          <div className="w-hero-coin"><Image src="/welcome/coin.png" alt="" width={950} height={950} sizes="(max-width: 600px) 43vw, (max-width: 1000px) 30vw, 350px" quality={90} priority /><div className="w-coin-platform" /></div>
          <Image src="/welcome/tails.png" alt="" width={918} height={918} sizes="(max-width: 600px) 45vw, (max-width: 1000px) 35vw, 440px" quality={90} priority className="w-character w-character-tails" />
        </div>
        <div className="w-hero-bottom"><div className="w-hero-ctas"><Launch href={app} /><a className="w-button w-button-ghost" href="#how-it-works"><WelcomeIcon name="play" />How It Works</a></div><p>1v1 PvP <span>·</span> On-chain flips <span>·</span> Test tokens only</p></div>
      </section>

      <div className="w-container w-content">
        <section className="w-section" aria-labelledby="how-it-works"><SectionTitle id="how-it-works">HOW IT WORKS</SectionTitle><div className="w-steps w-glass">{steps.map((step, i) => <article className="w-step" key={step.title}><span className={`w-icon-tile ${i === 3 ? "w-pink" : ""}`}><WelcomeIcon name={step.icon} /></span><h3><span>{i + 1}.</span> {step.title}</h3><p>{step.text}</p>{i < steps.length - 1 ? <span className="w-step-arrow" aria-hidden="true">›</span> : null}</article>)}</div></section>

        <section className="w-section" aria-labelledby="why-headstails"><SectionTitle id="why-headstails" note="Built for players. Open for anyone to verify.">WHY HEADSTAILS</SectionTitle><div className="w-four-grid">{reasons.map((reason, i) => <article key={reason.title} className={`w-feature w-glass ${i % 2 ? "w-pink" : ""}`}><WelcomeIcon name={reason.icon} /><h3>{reason.title}</h3><p>{reason.text}</p></article>)}</div></section>

        <section className="w-section w-rooms-section" aria-labelledby="game-rooms"><div><span className="w-eyebrow">SAME COIN. YOUR CALL.</span><h2 id="game-rooms">Two rooms.<br />One simple game.</h2><p>Choose your test-token stake.<br />The flip works the same in either room.</p><a className="w-text-link" href={app}>Find your room <WelcomeIcon name="arrow" /></a></div><div className="w-room-cards">{[{ stake: "100", usd: "$1", name: "The warm-up", icon: "bolt" as const }, { stake: "1,000", usd: "$10", name: "Turn it up", icon: "cube" as const }].map((room, i) => <a key={room.stake} href={app} className={`w-room w-glass ${i ? "w-pink" : ""}`}><div className="w-room-top"><WelcomeIcon name={room.icon} /><span>1v1 PvP</span></div><h3>{room.name}</h3><strong>{room.stake} <span>HTS</span></strong><p>{room.usd} simulated USD</p><div className="w-room-bottom">Devnet test tokens <WelcomeIcon name="arrow" /></div></a>)}</div></section>

        <section className="w-section" aria-labelledby="earn-points"><SectionTitle id="earn-points" note="Play, invite and be part of the community.">EARN POINTS</SectionTitle><div className="w-four-grid w-points-grid">{[
          { title: "Win Matches", points: "+5", icon: "trophy" as const, text: "Every eligible win counts." },
          { title: "Take Losses", points: "+2", icon: "cross" as const, text: "Lost the flip? Still earn Points." },
          { title: "Refer Friends", points: "+50", icon: "invite" as const, text: "For each qualified referral." },
          { title: "Community Tasks", points: "MORE", icon: "check" as const, text: "Connect. Join. Get verified." },
        ].map((item, i) => <a href={earn} key={item.title} className={`w-feature w-glass ${i % 2 ? "w-pink" : ""}`}><div className="w-points-top"><WelcomeIcon name={item.icon} /><strong>{item.points}</strong></div><h3>{item.title}</h3><p>{item.text}</p></a>)}</div><div className="w-section-footnote"><p>Eligible settled games only. Daily gameplay cap and verification rules apply.</p><a href={earn}>Explore Earn Points <span aria-hidden="true">↗</span></a></div></section>

        <section className="w-devnet-banner w-glass" aria-labelledby="devnet-beta"><div className="w-solana-mark" aria-hidden="true"><i /><i /><i /></div><div className="w-devnet-title"><h2 id="devnet-beta">Devnet Beta</h2><p>All the flips. Test tokens only.</p></div><ul><li>Try the game, no real money</li><li>Test features and share feedback</li><li>Help shape what comes next</li></ul><Launch href={app} secondary>Play on Devnet</Launch></section>

        <section className="w-section w-fairness" aria-labelledby="fairness"><div className="w-fairness-art"><Image src="/welcome/coin-fire.png" alt="Official HeadsTails coin with green and pink energy" width={512} height={512} sizes="(max-width: 767px) 270px, 380px" /><span className="w-fairness-stamp"><WelcomeIcon name="shield" />VERIFIABLE ON SOLANA</span></div><div><span className="w-eyebrow">FAIRNESS & TRANSPARENCY</span><h2 id="fairness">Don&apos;t trust the flip.<br /><span>Verify it.</span></h2><p>Every round leaves a trail. Read the ORAO randomness, calculate the winning side and check the on-chain payout yourself.</p><div className="w-fairness-links"><a className="w-button w-button-ghost" href="/how-to"><WelcomeIcon name="shield" />Verification Guide</a><a className="w-text-link" href={SOCIAL_LINKS.github} target="_blank" rel="noopener noreferrer"><GitHubIcon />Read the Code <span aria-hidden="true">↗</span></a></div><p className="w-small">Independent checks, not a promise of an audit. The guide explains what each check can verify.</p></div></section>

        <section className="w-section w-preview-section" aria-labelledby="app-preview"><SectionTitle id="app-preview" note="Your next flip is one click away.">MEET THE ARENA</SectionTitle><a href={app} className="w-app-preview w-glass" aria-label="Launch the HeadsTails Devnet app"><div className="w-preview-top"><Brand /><span className="w-preview-tab"><WelcomeIcon name="coin" /> Play</span><span className="w-preview-rewards"><WelcomeIcon name="trophy" /> Earn Points</span><span className="w-preview-wallet"><WelcomeIcon name="wallet" /> Connect Wallet</span></div><div className="w-preview-body"><div className="w-preview-room"><span className="w-eyebrow">PICK YOUR SIDE</span><h3>One flip.<br />Your call.</h3><p>100 HTS <span>·</span> Devnet room</p><div className="w-preview-sides"><span className="w-heads-label">HEADS</span><span>vs</span><span className="w-tails-label">TAILS</span></div><div className="w-preview-images"><Image src="/welcome/heads.png" alt="" width={512} height={512} sizes="(max-width: 600px) 32vw, 180px" /><Image src="/welcome/tails.png" alt="" width={918} height={918} sizes="(max-width: 600px) 32vw, 180px" /></div></div><div className="w-preview-side"><div><WelcomeIcon name="people" /><h4>Find your opposite</h4><p>Choose a room, join the queue and wait for your match.</p></div><div><WelcomeIcon name="shield" /><h4>See the result. Check the proof.</h4><p>Follow your completed flips and verify the on-chain result.</p></div></div></div><div className="w-preview-caption"><span>App illustration · not live queue or match data</span><strong>Enter the arena <WelcomeIcon name="arrow" /></strong></div></a></section>

        <section className="w-section w-faq-section" aria-labelledby="faq"><div><span className="w-eyebrow">A FEW THINGS BEFORE YOU FLIP</span><h2 id="faq">Good questions.<br />Straight answers.</h2><p>Still curious?<br />Come say hi to the community.</p><a className="w-text-link" href={SOCIAL_LINKS.telegram} target="_blank" rel="noopener noreferrer"><TelegramIcon />Join us on Telegram <span aria-hidden="true">↗</span></a></div><div className="w-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

        <section className="w-final-cta w-glass" aria-labelledby="final-cta"><span className="w-beta-pill"><span /> THE DEVNET ARENA IS WAITING</span><h2 id="final-cta">Heads? Tails?<br /><span>Your move.</span></h2><p>Two sides. One community. Come flip with us.</p><Launch href={app}>Launch Devnet Beta</Launch><small>Test HTS only. Points do not guarantee future token allocations.</small></section>
      </div>
    </main>

    <footer id="community" className="w-footer w-container"><div className="w-footer-top"><a href={welcome} aria-label="HeadsTails.fun welcome"><Brand /></a><p>A 1v1, on-chain coin-flip game on Solana.</p><nav aria-label="Official community">{socials.map(({ name, href, Icon }) => <a key={name} href={href} target="_blank" rel="noopener noreferrer"><Icon /><span>{name}</span></a>)}</nav></div><div className="w-footer-bottom"><p>HeadsTails.fun · Devnet Beta · Built for the flip.</p><nav aria-label="Legal and project information"><a href="/how-to">How to Verify</a><a href="/tokenomics">Tokenomics</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></div></footer>
  </div>;
}
