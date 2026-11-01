/**
 * Entry funding adapters (GAMEPLAY V3 §28-33).
 *
 * Non-custodial Mainnet architecture: USER WALLET SOL -> decentralized
 * swap/aggregator -> PROJECT TOKEN -> USER'S OWN ATA -> program vault via
 * normal Join. The site wallet NEVER custodies swap principal.
 *
 * Current Devnet task: UI/state-machine/API abstraction as a clearly
 * identified DEVNET MOCK. Never pretend a fake swap is real on-chain.
 */

export type FundingMethod = "token" | "sol";

export interface FundingQuote {
  method: FundingMethod;
  /** Room tier this quote is for. */
  tierUsd: number;
  /** Project-token base units the room requires. */
  requiredTokenBaseUnits: bigint;
  /** Estimated SOL cost (mock on Devnet, real quote on Mainnet). */
  solLamports: bigint | null;
  /** Maximum slippage in basis points (e.g. 100 = 1%). */
  maxSlippageBps: number;
  /** Unix ms when the quote expires. */
  expiresAtMs: number;
  /** Human-readable source label. */
  source: string;
  /** True only for the Devnet mock path. */
  isMock: boolean;
}

export interface EntryFundingAdapter {
  readonly id: string;
  /** Quote exact-output style: enough token for the room's stake. */
  quote(tierUsd: number, requiredTokenBaseUnits: bigint): Promise<FundingQuote>;
  /** True when the quote is expired (fail closed, never use stale). */
  isExpired(q: FundingQuote, nowMs?: number): boolean;
}

export function quoteExpired(q: FundingQuote, nowMs = Date.now()): boolean {
  return nowMs >= q.expiresAtMs;
}

/** Existing token balance path (default when sufficient). */
export class ExistingTokenAdapter implements EntryFundingAdapter {
  readonly id = "existing-token";
  async quote(tierUsd: number, requiredTokenBaseUnits: bigint): Promise<FundingQuote> {
    return {
      method: "token",
      tierUsd,
      requiredTokenBaseUnits,
      solLamports: null,
      maxSlippageBps: 0,
      expiresAtMs: Date.now() + 60_000,
      source: "wallet-balance",
      isMock: false,
    };
  }
  isExpired(q: FundingQuote, nowMs = Date.now()): boolean {
    return quoteExpired(q, nowMs);
  }
}

export interface MockSolSwapConfig {
  /** Lamports per $1 of stake (mock rate, Devnet only). */
  lamportsPerUsd?: bigint;
  maxSlippageBps?: number;
  quoteTtlMs?: number;
}

/**
 * DEVNET MOCK SOL->token path. Moves NO real value and routes through NO
 * custodial website wallet. Exists to exercise quote/insufficient/slippage/
 * expiry/transition states; the real Mainnet adapter (e.g. Jupiter exact-
 * output) plugs into EntryFundingAdapter later.
 */
export class MockSolSwapAdapter implements EntryFundingAdapter {
  readonly id = "mock-sol-swap";
  constructor(private readonly config: MockSolSwapConfig = {}) {}
  async quote(tierUsd: number, requiredTokenBaseUnits: bigint): Promise<FundingQuote> {
    const perUsd = this.config.lamportsPerUsd ?? BigInt(2000000); // mock: 0.002 SOL per $1
    const usd = tierUsd;
    return {
      method: "sol",
      tierUsd,
      requiredTokenBaseUnits,
      solLamports: perUsd * BigInt(usd),
      maxSlippageBps: this.config.maxSlippageBps ?? 100,
      expiresAtMs: Date.now() + (this.config.quoteTtlMs ?? 30_000),
      source: "DEVNET MOCK — no real swap",
      isMock: true,
    };
  }
  isExpired(q: FundingQuote, nowMs = Date.now()): boolean {
    return quoteExpired(q, nowMs);
  }
}

/** Future Mainnet adapter slot (exact-output, bounded slippage, verified routing). */
export interface RealSwapAdapterConfig {
  maxSlippageBps: number;
  quoteTtlMs: number;
  provider: string;
}

export function describeQuote(q: FundingQuote): string {
  const sol = q.solLamports !== null ? `${(Number(q.solLamports) / 1e9).toFixed(4)} SOL` : "—";
  return `${q.method === "sol" ? "Pay with SOL" : "Pay with Game Token"} • ${q.requiredTokenBaseUnits.toLocaleString("en-US")} base units • est. ${sol} • max slippage ${(q.maxSlippageBps / 100).toFixed(2)}%`;
}
