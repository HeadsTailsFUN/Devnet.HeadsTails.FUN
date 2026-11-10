/**
 * Mobile wallet selector registry for direct wallet-browser connections.
 *
 * Normal mobile browser (Safari/Chrome, no injected provider):
 *   Devnet shows Phantom, Solflare, Backpack and Nightly.
 *   The registry retains capability labels for the other wallet options.
 *
 * Wallet in-app browser (e.g. Solflare/Phantom/Backpack in-app):
 *   inspect the actual Wallet Standard registry and show ONLY the
 *   injected compatible provider. Never rely on UA sniffing alone.
 *
 * Removed for now: Ronin, Kraken, OKX (do not render).
 */

import type { Wallet } from "@wallet-standard/base";
import { dedupeWallets, isWalletUsable, normalizeWalletName } from "./wallets";

export type MobilePlatform = "ios" | "android" | "other";

export function platformFromUserAgent(ua: string | null | undefined): MobilePlatform {
  if (!ua) return "other";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function isMobileUserAgent(ua: string | null | undefined): boolean {
  return platformFromUserAgent(ua) !== "other";
}

export type MobileWalletKind = "browse-verified" | "deeplink-official" | "official-site" | "inert";

/**
 * Honest Devnet capability per wallet. Limited wallets are NEVER presented
 * identically to verified playable rows: the modal renders the badge and
 * routes limited entries to information/official flows instead of a
 * misleading direct Connect.
 */
export type MobileWalletCapability =
  | "available"
  | "mainnet-only"
  | "setup-required"
  | "unverified-devnet"
  | "beta";

export const CAPABILITY_LABEL: Record<MobileWalletCapability, string> = {
  available: "Available",
  "mainnet-only": "Mainnet Only",
  "setup-required": "Setup required",
  "unverified-devnet": "Not verified on Devnet",
  beta: "Beta",
};

export interface MobileWalletAction {
  id:
    | "phantom"
    | "solflare"
    | "backpack"
    | "nightly"
    | "bitget"
    | "metamask"
    | "trust"
    | "coinbase";
  /** Button label. Never asserts the app is installed. */
  label: string;
  /** Deep-link href, or null when the row is inert (no navigation). */
  href: string | null;
  kind: MobileWalletKind;
  /** Local vendored logo asset (never a hotlinked remote URL). */
  logo: string;
  capability: MobileWalletCapability;
  /** True for visual disabled rows (button, aria-disabled, no href). */
  inert: boolean;
}

// Logo sources (vendored under public/assets/wallets):
// phantom/solflare/coinbase/trust/bitget: official artwork embedded in
//   anza-xyz/wallet-adapter adapter sources (shipped for wallet UIs).
// metamask: official MetaMask developer docs fox (docs.metamask.io).
// backpack: official backpack.app favicon.
// nightly: official docs.nightly.app/img/logo.png.

function enc(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Build curated open-in-app actions for the current page.
 * `pageUrl` should be window.location.href; `ref` the origin.
 * Nightly's explicit Devnet link is included only in the Devnet beta.
 */
export function mobileWalletActions(
  pageUrl: string,
  ref: string,
  platform: MobilePlatform,
  devnet = false,
): MobileWalletAction[] {
  const target = enc(pageUrl);
  const r = enc(ref);
  const phantomHref =
    platform === "android"
      ? `intent://ul/browse/${target}?ref=${r}#Intent;scheme=https;host=phantom.app;package=app.phantom;end`
      : `https://phantom.app/ul/browse/${target}?ref=${r}`;
  const logo = (f: string): string => `/assets/wallets/${f}`;
  return [
    { id: "phantom", label: "Phantom", href: phantomHref, kind: "browse-verified", logo: logo("phantom.svg"), capability: "available", inert: false },
    {
      id: "solflare",
      label: "Solflare",
      href: `https://solflare.com/ul/v1/browse/${target}?ref=${r}`,
      kind: "browse-verified",
      logo: logo("solflare.svg"),
      capability: "available",
      inert: false,
    },
    {
      id: "backpack",
      label: "Backpack",
      href: `https://backpack.app/ul/v1/browse/${target}?ref=${r}`,
      kind: "browse-verified",
      logo: logo("backpack.ico"),
      capability: "available",
      inert: false,
    },
    ...(devnet ? [{
      id: "nightly",
      label: "Nightly",
      href: `https://nightly.app/v1?network=solana&cluster=devnet&url=${target}`,
      kind: "deeplink-official",
      logo: logo("nightly.png"),
      capability: "available",
      inert: false,
    } satisfies MobileWalletAction] : []),
    {
      id: "bitget",
      label: "Bitget Wallet",
      href: `bitkeep://bkconnect?action=DApp&url=${target}&dappName=${enc("HeadsTails")}`,
      kind: "deeplink-official",
      logo: logo("bitget.svg"),
      // Physical Devnet verification unavailable: compact Beta only.
      capability: "beta",
      inert: false,
    },
    {
      id: "metamask",
      label: "MetaMask",
      href: null,
      kind: "inert",
      logo: logo("metamask.svg"),
      capability: "mainnet-only",
      inert: true,
    },
    {
      id: "trust",
      label: "Trust Wallet",
      href: null,
      kind: "inert",
      logo: logo("trust.svg"),
      capability: "mainnet-only",
      inert: true,
    },
    {
      id: "coinbase",
      label: "Coinbase Wallet",
      href: null,
      kind: "inert",
      logo: logo("coinbase.svg"),
      capability: "mainnet-only",
      inert: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// In-app wallet-browser detection (Wallet Standard registry, not UA sniffing)
// ---------------------------------------------------------------------------

export type InAppResolution =
  | { mode: "none" }
  | { mode: "single"; walletName: string; normalized: string }
  | { mode: "multiple"; walletNames: string[] };

/**
 * Compatible injected providers: Wallet Standard registrations exposing
 * standard:connect + solana:signTransaction for the expected chain.
 * Deduplicated by brand so Phantom EVM+Solana counts once.
 */
export function compatibleInjectedWallets(
  registry: readonly Wallet[],
  expectedChain: string
): Wallet[] {
  try {
    const deduped = dedupeWallets(registry, expectedChain);
    return deduped.filter((w) => {
      try {
        return isWalletUsable(w, expectedChain);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Resolve the mobile wallet view from the live registry:
 * - exactly one compatible provider -> in-app browser, show ONLY it
 * - several compatible providers -> ambiguous, show the injected choice
 *   list (never silently pick one)
 * - none -> normal mobile browser, show the curated external list
 */
export function resolveInAppWalletView(
  registry: readonly Wallet[],
  expectedChain: string
): InAppResolution {
  const compatible = compatibleInjectedWallets(registry, expectedChain);
  if (compatible.length === 0) return { mode: "none" };
  if (compatible.length === 1) {
    const name = (compatible[0] as { name?: unknown }).name;
    const label = typeof name === "string" ? name : "wallet";
    return { mode: "single", walletName: label, normalized: normalizeWalletName(label) };
  }
  const names = compatible.map((w) => {
    const n = (w as { name?: unknown }).name;
    return typeof n === "string" ? n : "wallet";
  });
  return { mode: "multiple", walletNames: names };
}
