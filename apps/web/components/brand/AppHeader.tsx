import type { ReactNode } from "react";
import { LogoLockup } from "@/components/brand/Logo";
import { WalletButton } from "@/components/wallet/WalletButton";
import {
  DiscordIcon,
  GitHubIcon,
  TelegramIcon,
  XIcon,
} from "@/components/ui/icons";
import { HeartIcon } from "@/components/ui/icons";
import { SOCIAL_LINKS } from "@/lib/site/socialLinks";
import type { GameStateId } from "@/lib/mockGameData";

export function AppHeader({
  state,
  onConnect,
  addressLabel,
  live,
  faucet,
  balanceLabel,
  profileName,
  profileAvatarUrl,
  notificationCount,
  onProfileClick,
}: {
  state: GameStateId;
  onConnect: () => void;
  onDisconnect: () => void;
  addressLabel?: string;
  live?: boolean;
  faucet?: ReactNode;
  balanceLabel?: string | null;
  profileName?: string | null;
  profileAvatarUrl?: string | null;
  notificationCount?: number;
  onProfileClick?: () => void;
}) {
  return (
    <header className="safe-top relative z-20 mx-auto flex w-full min-w-0 max-w-[1440px] flex-wrap items-center justify-between gap-3 overflow-x-clip px-4 pt-5 sm:flex-nowrap sm:gap-4 sm:px-6">
      <span className="flex items-center gap-2">
        <LogoLockup />
      </span>
      <p className="hidden items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)] lg:flex">
        <span>Fair</span>
        <span aria-hidden="true" className="text-[10px]">
          •
        </span>
        <span>Simple</span>
        <span aria-hidden="true" className="text-[10px]">
          •
        </span>
        <span>On-Chain</span>
        <span aria-hidden="true" className="text-[10px]">
          •
        </span>
        <span>For the Degens</span>
        <HeartIcon className="h-3.5 w-3.5 text-[var(--heads)]" />
      </p>
      <span className="order-2 flex w-full min-w-0 items-center justify-between gap-1.5 sm:ml-auto sm:w-auto sm:justify-end sm:gap-2">
        <span className="hidden sm:inline-flex sm:items-center sm:gap-2">
          {faucet}
        </span>
        <nav
          aria-label="Social links"
          className="mr-auto flex shrink-0 items-center gap-0.5 sm:mr-0 sm:gap-1"
        >
          <a
            href={SOCIAL_LINKS.x}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X"
            className="inline-flex min-h-[44px] min-w-[36px] items-center justify-center rounded-xl text-white/60 transition hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </a>
          <a
            href={SOCIAL_LINKS.discord}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Discord"
            className="inline-flex min-h-[44px] min-w-[36px] items-center justify-center rounded-xl text-white/60 transition hover:text-white"
          >
            <DiscordIcon className="h-5 w-5" />
          </a>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram"
            className="inline-flex min-h-[44px] min-w-[36px] items-center justify-center rounded-xl text-white/60 transition hover:text-white"
          >
            <TelegramIcon className="h-4 w-4" />
          </a>
          <a
            href={SOCIAL_LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="hidden min-h-[44px] min-w-[36px] items-center justify-center rounded-xl text-white/60 transition hover:text-white sm:inline-flex"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
        </nav>
        {addressLabel ? (
          <button
            type="button"
            onClick={onProfileClick}
            aria-label={`Open profile for ${profileName ?? addressLabel}`}
            className="header-account glass relative inline-flex min-h-[44px] min-w-0 items-center gap-2 rounded-2xl px-3 text-sm font-semibold text-white transition hover:bg-[var(--bg-panel-hover)]"
          >
            {profileAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileAvatarUrl}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold text-white"
              >
                {(profileName ?? addressLabel).slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 max-w-[110px] truncate">
              {profileName ?? addressLabel}
            </span>
            {balanceLabel ? (
              <span aria-label={`Available tokens ${balanceLabel}`} className="header-token-balance shrink-0 whitespace-nowrap text-[12px] font-bold text-[var(--heads)]">
                {balanceLabel}
              </span>
            ) : null}
            {(notificationCount ?? 0) > 0 && (
              <span
                aria-label={`${notificationCount} pending notifications`}
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff5d7a] px-1 text-[10px] font-bold text-white"
              >
                {notificationCount}
              </span>
            )}
          </button>
        ) : (
          <>
            {balanceLabel ? (
              <span
                role="status"
                aria-label={`Project token balance ${balanceLabel}`}
                title="Project token balance (exact on-chain)"
                className="glass hidden min-h-[44px] items-center rounded-2xl px-3 text-[13px] font-bold text-[var(--heads)] sm:inline-flex"
              >
                {balanceLabel}
              </span>
            ) : null}
            <WalletButton
              state={state}
              onConnect={onConnect}
              onDisconnect={() => undefined}
              addressLabel={addressLabel}
              live={live}
            />
          </>
        )}
      </span>
      {faucet && (
        <span className="order-3 flex w-full justify-end sm:hidden">
          {faucet}
        </span>
      )}
    </header>
  );
}
