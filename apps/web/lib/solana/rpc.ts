/**
 * Dedicated Devnet RPC resolution with fail-closed public-RPC policy.
 *
 * Browser uses NEXT_PUBLIC_RPC_URL (restricted, browser-safe key).
 * Server uses SOLANA_SERVER_RPC_URL (higher-trust, server-only), falling back
 * to INDEXER_RPC_URL, then NEXT_PUBLIC_RPC_URL only for local diagnostics.
 *
 * The public Solana Devnet endpoint must NOT be the normal RPC used by the
 * deployed QA application. It exists only as an explicitly documented local
 * development diagnostic fallback.
 */

export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export interface RpcResolution {
  url: string;
  /** True when a dedicated (non-public) RPC is configured. */
  isDedicated: boolean;
  /** True when we fell back to the public endpoint (dev diagnostic only). */
  isPublicFallback: boolean;
  /** True when no usable RPC is configured for deployed QA. */
  missing: boolean;
}

export function isPublicRpcUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const u = url.trim();
  return u === PUBLIC_DEVNET_RPC || u === PUBLIC_MAINNET_RPC;
}

function isProdDeploy(): boolean {
  // Vercel sets VERCEL_ENV=production for Production deploys; Next sets
  // NODE_ENV=production for `next start` / `next build`.
  // NOTE: keep every process.env access below a STRING LITERAL. Next.js only
  // inlines literal `process.env.NEXT_PUBLIC_*` into the browser bundle;
  // dynamic access (process.env[name]) stays undefined client-side and would
  // falsely fail-closed the deployed app.
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/** Browser key: literal access so Next.js inlines it into the client bundle. */
function browserEnvUrl(): string | undefined {
  const v = process.env.NEXT_PUBLIC_RPC_URL;
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Browser RPC: requires NEXT_PUBLIC_RPC_URL in deployed QA.
 * In local development (non-production) we allow the public endpoint as an
 * explicit diagnostic fallback with a console warning.
 */
export function resolveBrowserRpcUrl(): RpcResolution {
  const configured = browserEnvUrl();
  if (configured && !isPublicRpcUrl(configured)) {
    return { url: configured, isDedicated: true, isPublicFallback: false, missing: false };
  }
  if (configured && isPublicRpcUrl(configured)) {
    // An explicitly configured public URL is still a public fallback.
    // Allow it locally for diagnostics, fail closed in production deploys.
    if (isProdDeploy()) {
      return { url: configured, isDedicated: false, isPublicFallback: true, missing: true };
    }
    return { url: configured, isDedicated: false, isPublicFallback: true, missing: false };
  }
  // Nothing configured.
  if (isProdDeploy()) {
    return { url: PUBLIC_DEVNET_RPC, isDedicated: false, isPublicFallback: true, missing: true };
  }
  if (typeof console !== "undefined") {
    console.warn(
      "[rpc] NEXT_PUBLIC_RPC_URL is not set; using public Devnet RPC as a LOCAL diagnostic fallback only. Configure a dedicated Devnet RPC for QA."
    );
  }
  return { url: PUBLIC_DEVNET_RPC, isDedicated: false, isPublicFallback: true, missing: false };
}

/**
 * Server RPC: prefers SOLANA_SERVER_RPC_URL (server-only), then
 * INDEXER_RPC_URL, then NEXT_PUBLIC_RPC_URL for local diagnostics.
 * Never shares the browser credential unnecessarily; the server key should be
 * higher-trust and kept out of the client bundle.
 */
export function resolveServerRpcUrl(): RpcResolution {
  // Server-only: literal keys (works in Node; this module's browser entry
  // resolveBrowserRpcUrl never touches server keys).
  const trim = (v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  const serverKey = trim(process.env.SOLANA_SERVER_RPC_URL) ?? trim(process.env.INDEXER_RPC_URL);
  if (serverKey && !isPublicRpcUrl(serverKey)) {
    return { url: serverKey, isDedicated: true, isPublicFallback: false, missing: false };
  }
  if (serverKey && isPublicRpcUrl(serverKey)) {
    if (isProdDeploy()) {
      return { url: serverKey, isDedicated: false, isPublicFallback: true, missing: true };
    }
    return { url: serverKey, isDedicated: false, isPublicFallback: true, missing: false };
  }
  const browser = browserEnvUrl();
  if (browser && !isPublicRpcUrl(browser)) {
    // Usable for local diagnostics; deployed QA should set a server key.
    if (isProdDeploy()) {
      return { url: browser, isDedicated: false, isPublicFallback: false, missing: true };
    }
    return { url: browser, isDedicated: false, isPublicFallback: false, missing: false };
  }
  if (isProdDeploy()) {
    return { url: PUBLIC_DEVNET_RPC, isDedicated: false, isPublicFallback: true, missing: true };
  }
  return { url: PUBLIC_DEVNET_RPC, isDedicated: false, isPublicFallback: true, missing: false };
}

export interface RpcConfigStatus {
  browser: RpcResolution;
  server: RpcResolution;
  /** True when deployed QA may proceed with interactive RPC. */
  ok: boolean;
  reason: string | null;
}

export function getRpcConfigStatus(): RpcConfigStatus {
  const browser = resolveBrowserRpcUrl();
  const server = resolveServerRpcUrl();
  if (browser.missing) {
    return {
      browser,
      server,
      ok: false,
      reason:
        "Dedicated Devnet RPC is not configured (NEXT_PUBLIC_RPC_URL). Public api.devnet.solana.com must not be the primary QA RPC.",
    };
  }
  if (server.missing) {
    return {
      browser,
      server,
      ok: false,
      reason:
        "Server Devnet RPC is not configured (SOLANA_SERVER_RPC_URL). Backend must not share the public browser credential.",
    };
  }
  return { browser, server, ok: true, reason: null };
}

/**
 * Before/after RPC request-volume model for the final report.
 * Numbers are per-wallet, per-minute estimates derived from the refresh
 * architecture (see LiveGameClient).
 */
export interface RpcVolumeEstimate {
  label: string;
  requestsPerMinute: number;
  notes: string;
}

export function estimateRpcVolume(): { before: RpcVolumeEstimate[]; after: RpcVolumeEstimate[] } {
  // BEFORE: refresh every 4s does ~7 reads (config, playerState, SOL balance,
  // token balance, quote is offchain, match, randomness, ATA info) + history
  // every 20s (~1 read) + join path duplicates config/balance reads.
  // 15 refreshes/min * ~6 RPC calls + history ~3/min ≈ 90/min connected.
  // Disconnected still polled config-adjacent work via interval.
  const before: RpcVolumeEstimate[] = [
    { label: "disconnected", requestsPerMinute: 15, notes: "interval ran with early return but still woke + history poll" },
    { label: "connected idle (ready/selected)", requestsPerMinute: 93, notes: "4s refresh: config+player+2 balances+match/randomness when applicable + history" },
    { label: "active (queued/matched/flipping)", requestsPerMinute: 93, notes: "same 4s loop even when state is stable; no subscription reuse" },
    { label: "hidden tab", requestsPerMinute: 93, notes: "no visibility pause; background tabs burned quota" },
  ];
  // AFTER: state-aware intervals (idle 10s, active 4s, disconnected 30s slow,
  // final 15s), visibility pause, subscription-first for config/player with
  // polling fallback, deduplicated balance reads, history 30s.
  const after: RpcVolumeEstimate[] = [
    { label: "disconnected", requestsPerMinute: 2, notes: "30s slow poll for queue counts only; history 30s" },
    { label: "connected idle (ready/selected)", requestsPerMinute: 20, notes: "10s refresh, cached config/quote, balances deduped" },
    { label: "active (queued/matched/flipping)", requestsPerMinute: 45, notes: "4s refresh only while active + onAccountChange subscriptions replace most polls" },
    { label: "hidden tab", requestsPerMinute: 0, notes: "refresh paused when document.hidden; resumes on visible" },
  ];
  return { before, after };
}
