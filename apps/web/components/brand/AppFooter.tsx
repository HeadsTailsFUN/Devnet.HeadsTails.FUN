import Link from "next/link";
import {
  DiscordIcon,
  GitHubIcon,
  HeartIcon,
  TelegramIcon,
  XIcon,
} from "@/components/ui/icons";
import { SolanaIcon } from "@/components/ui/icons";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";

export function AppFooter() {
  return (
    <footer className="safe-bottom relative z-20 mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
      <div className="glass flex flex-col items-center gap-3 rounded-[28px] px-5 py-3 text-[12.5px] text-[var(--text-secondary)] lg:flex-row lg:justify-between lg:rounded-full">
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="font-display text-[15px] font-bold">
            <span className="text-[var(--heads)]">Heads</span>
            <span className="text-[var(--tails)]">Tails</span>
            <span className="text-white">.fun</span>
          </span>
          <span
            className="hidden h-4 w-px bg-white/15 sm:block"
            aria-hidden="true"
          />
          <span>A fairer way to degen.</span>
          <span className="inline-flex items-center gap-1.5">
            <SolanaIcon className="h-4 w-4 text-[#a06bff]" />
            Built on Solana.
          </span>
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:flex-wrap sm:gap-x-2"
        >
          <div className="flex flex-wrap items-center justify-center gap-x-2">
            <Link href="/how-to" className="inline-flex min-h-[44px] items-center px-2 hover:text-white">How To</Link>
            <Link
              href="/tokenomics"
              className="inline-flex min-h-[44px] items-center px-2 hover:text-white"
            >
              Tokenomics
            </Link>
            <Link
              href="/roadmap"
              className="inline-flex min-h-[44px] items-center px-2 hover:text-white"
            >
              Roadmap
            </Link>
            <Link
              href="/terms"
              className="inline-flex min-h-[44px] min-w-[44px] items-center rounded px-2 transition hover:text-white"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-[44px] min-w-[44px] items-center rounded px-2 transition hover:text-white"
            >
              Privacy
            </Link>
          </div>
          <div
            role="group"
            aria-label="Footer social links"
            className="flex shrink-0 items-center justify-center gap-x-2"
          >
            <a
              href={SOCIAL_LINKS.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded transition hover:text-white"
            >
              <GitHubIcon className="h-4 w-4" />
            </a>
            <a
              href={SOCIAL_LINKS.x}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded transition hover:text-white"
            >
              <XIcon className="h-4 w-4" />
            </a>
            <a
              href={SOCIAL_LINKS.discord}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded transition hover:text-white"
            >
              <DiscordIcon className="h-5 w-5" />
            </a>
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded transition hover:text-white"
            >
              <TelegramIcon className="h-4 w-4" />
            </a>
          </div>
          <span className="hidden items-center gap-1.5 md:inline-flex">
            Good flips. Better people.
            <HeartIcon className="h-3.5 w-3.5 text-[var(--heads)]" />
          </span>
        </nav>
      </div>
    </footer>
  );
}
