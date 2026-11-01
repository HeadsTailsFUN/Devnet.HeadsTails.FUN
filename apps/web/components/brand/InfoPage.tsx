import Link from "next/link";
import type { ReactNode } from "react";
import { LogoLockup } from "./Logo";
import { AppFooter } from "./AppFooter";
import { GitHubIcon } from "@/components/ui/icons";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";
export function InfoPage({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-6">
        <LogoLockup />
        <a
          href={SOCIAL_LINKS.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="hidden min-h-[44px] min-w-[44px] items-center justify-center text-white/60 hover:text-white md:inline-flex"
        >
          <GitHubIcon className="h-5 w-5" />
        </a>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-xs font-bold tracking-[.2em] text-[var(--heads)]">
          {eyebrow}
        </p>
        <h1 className="font-display mb-7 mt-3 text-4xl font-bold sm:text-5xl">
          {title}
        </h1>
        <div className="space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          {children}
        </div>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center font-bold text-[var(--heads)]"
        >
          ← Back to the flip
        </Link>
      </main>
      <AppFooter />
    </div>
  );
}
