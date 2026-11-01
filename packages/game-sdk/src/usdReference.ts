/** Devnet simulation only. No market price, exchange liquidity or real oracle is asserted. */
export const HTS_USD_POLICY = "hts-devnet-usd-v1";
export const HTS_DECIMALS = 6;
export const HTS_TEST_PRICE_MICRO_USD = 10_000n; // $0.01 per HTS
export const HTS_QUOTE_TTL_MS = 30_000;
export const HTS_BASE_UNITS_PER_USD = 100_000_000n;
export const HTS_WELCOME_BASE_UNITS = 200_000_000n;
export const HTS_QA_SUPPLEMENT_BASE_UNITS = 1_200_000_000n;

export function referenceStake(usdCents: number): bigint {
  if (!Number.isSafeInteger(usdCents) || usdCents <= 0) throw new Error("Invalid USD amount");
  // ceil(USD cents * 10,000 microUSD/cent * token base units / microUSD/token).
  const numerator = BigInt(usdCents) * 10_000n * 1_000_000n;
  return (numerator + HTS_TEST_PRICE_MICRO_USD - 1n) / HTS_TEST_PRICE_MICRO_USD;
}

export function assertHtsRoomStake(tier: number, amount: bigint): void {
  if ((tier !== 1 && tier !== 10) || amount !== referenceStake(tier * 100)) {
    throw new Error("HTS USD room stake mismatch");
  }
}

export interface ReferenceQuote {
  version: typeof HTS_USD_POLICY;
  source: "owner-approved-devnet-test-rate";
  simulated: true;
  mint: string;
  priceMicroUsd: string;
  baseUnitsPerUsd: string;
  tokenDecimals: 6;
  updatedAtMs: number;
  expiresAtMs: number;
  maxAgeMs: number;
  rounding: "ceil-base-unit";
}

export function referenceQuote(mint: string, now: number): ReferenceQuote {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid quote time");
  return { version: HTS_USD_POLICY, source: "owner-approved-devnet-test-rate", simulated: true,
    mint, priceMicroUsd: String(HTS_TEST_PRICE_MICRO_USD), baseUnitsPerUsd: String(HTS_BASE_UNITS_PER_USD),
    tokenDecimals: 6, updatedAtMs: now, expiresAtMs: now + HTS_QUOTE_TTL_MS,
    maxAgeMs: HTS_QUOTE_TTL_MS, rounding: "ceil-base-unit" };
}

export function validateReferenceQuote(value: ReferenceQuote, mint: string, now = Date.now()): void {
  if (value.version !== HTS_USD_POLICY || value.source !== "owner-approved-devnet-test-rate" ||
      value.simulated !== true || value.mint !== mint || value.tokenDecimals !== 6 ||
      value.priceMicroUsd !== String(HTS_TEST_PRICE_MICRO_USD) ||
      value.baseUnitsPerUsd !== String(HTS_BASE_UNITS_PER_USD) || value.rounding !== "ceil-base-unit" ||
      value.maxAgeMs !== HTS_QUOTE_TTL_MS || !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs > now || value.expiresAtMs !== value.updatedAtMs + HTS_QUOTE_TTL_MS ||
      now >= value.expiresAtMs) throw new Error("Invalid or expired Devnet quote");
}

/** Replaceable real-provider boundary; no live provider is wired or enabled here. */
export interface MarketObservation {
  source: string; mint: string; observedAtMs: number;
  priceMicroUsd: bigint; executableLiquidityMicroUsd: bigint;
}
export interface VerifiedMarketAdapter { observe(mint: string): Promise<MarketObservation>; }
export function validateMarketObservation(q: MarketObservation, policy: {
  mint: string; allowedSources: ReadonlySet<string>; now: number; maxAgeMs: number;
  minLiquidityMicroUsd: bigint; lastVerifiedPriceMicroUsd: bigint; maxDeviationBps: bigint;
}): void {
  if (!policy.allowedSources.has(q.source) || q.mint !== policy.mint ||
      !Number.isSafeInteger(policy.now) ||
      !Number.isSafeInteger(q.observedAtMs) || !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs <= 0 ||
      q.observedAtMs > policy.now || policy.now - q.observedAtMs > policy.maxAgeMs ||
      q.priceMicroUsd <= 0n || policy.minLiquidityMicroUsd <= 0n ||
      q.executableLiquidityMicroUsd < policy.minLiquidityMicroUsd || policy.lastVerifiedPriceMicroUsd <= 0n ||
      policy.maxDeviationBps < 0n || policy.maxDeviationBps > 10_000n) throw new Error("Untrusted market quote");
  const difference = q.priceMicroUsd > policy.lastVerifiedPriceMicroUsd
    ? q.priceMicroUsd - policy.lastVerifiedPriceMicroUsd : policy.lastVerifiedPriceMicroUsd - q.priceMicroUsd;
  if (difference * 10_000n > policy.lastVerifiedPriceMicroUsd * policy.maxDeviationBps) {
    throw new Error("Market deviation limit exceeded");
  }
}
