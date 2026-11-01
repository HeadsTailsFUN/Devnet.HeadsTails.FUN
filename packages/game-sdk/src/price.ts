/**
 * Price-adapter architecture (B14).
 *
 * The project token will launch on Pump.fun. The adapter interface supports:
 * - bonding-curve phase, post-graduation (PumpSwap), SOL or USDC pairs.
 *
 * Rules enforced here and in the UI:
 * - sudden live price changes are allowed (no smoothing),
 * - stale/unavailable quotes FAIL CLOSED (throw, never use an old quote),
 * - joined amounts lock at join time (handled by the program escrow),
 * - all math is integer (BigInt); floats never reach token transfers.
 */

export interface PriceQuote {
  /** Project-token base units per 1 USD, integer. */
  baseUnitsPerUsd: bigint;
  tokenDecimals: number;
  /** Unix ms when the quote was observed. */
  updatedAtMs: number;
  /** Human-readable source, e.g. "jupiter:SOL/USDC". */
  source: string;
  /** Max age in ms before the quote is considered stale. */
  maxAgeMs: number;
}

export class StaleQuoteError extends Error {
  constructor(source: string) {
    super(`price quote from ${source} is stale or unavailable`);
    this.name = "StaleQuoteError";
  }
}

export interface PriceAdapter {
  getQuote(mint: string): Promise<PriceQuote>;
}

/**
 * Exact base-unit stake for a USD amount. Throws StaleQuoteError when the
 * quote is older than maxAgeMs (fail closed). Rounds DOWN so the player
 * never overpays vs the displayed $1.
 */
export function stakeForUsd(
  quote: PriceQuote,
  usdCents: number,
  nowMs = Date.now()
): bigint {
  if (nowMs - quote.updatedAtMs > quote.maxAgeMs) {
    throw new StaleQuoteError(quote.source);
  }
  return (quote.baseUnitsPerUsd * BigInt(usdCents)) / 100n;
}

/** Last-update display helper for the live entry notice. */
export function quoteAgeSeconds(quote: PriceQuote, nowMs = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - quote.updatedAtMs) / 1000));
}

/**
 * Deterministic fixed-price adapter for Devnet testing and offline UI work.
 * NOT for production: real Mainnet mode requires a live adapter below.
 */
export class FixedPriceAdapter implements PriceAdapter {
  constructor(
    private readonly baseUnitsPerUsd: bigint,
    private readonly tokenDecimals = 6,
    private readonly maxAgeMs = 30_000,
    private readonly source = "fixed-devnet"
  ) {}

  async getQuote(_mint: string): Promise<PriceQuote> {
    return {
      baseUnitsPerUsd: this.baseUnitsPerUsd,
      tokenDecimals: this.tokenDecimals,
      updatedAtMs: Date.now(),
      source: this.source,
      maxAgeMs: this.maxAgeMs,
    };
  }
}

/**
 * Jupiter Lite price adapter (Mainnet-ready interface).
 * Returns token base units per USD derived from a USD-denominated quote.
 * Only used when MAINNET_REAL_VALUE_ENABLED=true with a real mint.
 */
export class JupiterPriceAdapter implements PriceAdapter {
  constructor(
    private readonly tokenDecimals: number,
    private readonly maxAgeMs = 30_000,
    private readonly endpoint = "https://lite-api.jup.ag/price/v3"
  ) {}

  async getQuote(mint: string): Promise<PriceQuote> {
    const res = await fetch(
      `${this.endpoint}?ids=${encodeURIComponent(mint)}`
    );
    if (!res.ok) throw new StaleQuoteError(`jupiter:http-${res.status}`);
    const body = (await res.json()) as {
      data?: Record<string, { price?: string | number }>;
    };
    const raw = body.data?.[mint]?.price;
    const priceUsd = typeof raw === "string" ? Number(raw) : (raw as number);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      throw new StaleQuoteError("jupiter:bad-price");
    }
    // Fixed-point: price in nano-USD, then baseUnits = 10^dec * 1e9 / priceNano.
    const priceNanoUsd = BigInt(Math.floor(priceUsd * 1e9));
    if (priceNanoUsd <= 0n) throw new StaleQuoteError("jupiter:bad-price");
    const baseUnitsPerUsd =
      (BigInt(10) ** BigInt(this.tokenDecimals) * 1_000_000_000n) /
      priceNanoUsd;
    if (baseUnitsPerUsd <= 0n) throw new StaleQuoteError("jupiter:bad-price");
    return {
      baseUnitsPerUsd,
      tokenDecimals: this.tokenDecimals,
      updatedAtMs: Date.now(),
      source: "jupiter",
      maxAgeMs: this.maxAgeMs,
    };
  }
}
