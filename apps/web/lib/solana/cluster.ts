import { resolveBrowserRpcUrl } from "./rpc";

export const SOLANA_CLUSTER =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
    ? "mainnet-beta"
    : "devnet";

export const IS_DEVNET = SOLANA_CLUSTER !== "mainnet-beta";

const browserRpc = resolveBrowserRpcUrl();

export const RPC_URL = browserRpc.url;

/** True when the browser RPC is a dedicated provider (not public fallback). */
export const RPC_IS_DEDICATED = browserRpc.isDedicated;
/** True when the browser is on the public diagnostic fallback. */
export const RPC_IS_PUBLIC_FALLBACK = browserRpc.isPublicFallback;
/** True when deployed QA has no usable dedicated RPC (fail-closed). */
export const RPC_MISSING = browserRpc.missing;

export const PROGRAM_ID =
  process.env.NEXT_PUBLIC_HEADS_TAILS_PROGRAM_ID ??
  "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";

export const PROJECT_TOKEN_MINT =
  process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ?? "";

/** Project token display label (Devnet QA default TOK). */
export const TOKEN_SYMBOL = "HTS";

/** Project token decimals (Devnet test mint uses 6). */
export const TOKEN_DECIMALS = 6;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Real Mainnet value stays off until full production approval. */
export const MAINNET_REAL_VALUE_ENABLED =
  process.env.MAINNET_REAL_VALUE_ENABLED === "true" ||
  process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED === "true";

/** QA-only Devnet faucet UI. Triple-gated: devnet + enabled + mainnet off. */
export const DEVNET_FAUCET_UI_ENABLED =
  IS_DEVNET &&
  (process.env.NEXT_PUBLIC_DEVNET_FAUCET_ENABLED === "true" ||
    process.env.DEVNET_FAUCET_ENABLED === "true") &&
  !MAINNET_REAL_VALUE_ENABLED;

/** QA-only Devnet SOL sponsor UI. Triple-gated: devnet + enabled + mainnet off. */
export const DEVNET_SPONSOR_UI_ENABLED =
  IS_DEVNET &&
  (process.env.NEXT_PUBLIC_DEVNET_SPONSOR_ENABLED === "true" ||
    process.env.DEVNET_SOL_SPONSOR_ENABLED === "true") &&
  !MAINNET_REAL_VALUE_ENABLED;

/** Hard startup assertion: sponsor must never be enabled with Mainnet value. */
export function assertSponsorMainnetSafety(): void {
  const sponsorOn =
    process.env.DEVNET_SOL_SPONSOR_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_DEVNET_SPONSOR_ENABLED === "true";
  if (sponsorOn && (SOLANA_CLUSTER === "mainnet-beta" || MAINNET_REAL_VALUE_ENABLED)) {
    throw new Error(
      "FATAL: DEVNET_SOL_SPONSOR_ENABLED must never be true with mainnet cluster or MAINNET_REAL_VALUE_ENABLED."
    );
  }
}

export const isChainConfigured = PROGRAM_ID.length > 0 && RPC_URL.length > 0 && !RPC_MISSING;
export const isTokenConfigured = PROJECT_TOKEN_MINT.length > 0;
