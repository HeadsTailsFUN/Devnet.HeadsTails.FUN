import { validateReferenceQuote, type ReferenceQuote, type PriceAdapter, type PriceQuote } from "@heads-or-tails/game-sdk";

/** Authoritative server quote; the program independently enforces the same immutable test rate. */
export class DevnetUsdQuoteAdapter implements PriceAdapter {
  async getQuote(mint: string): Promise<PriceQuote> {
    const response = await fetch("/api/devnet/usd-quote", { cache: "no-store" });
    if (!response.ok) throw new Error("Devnet Test Rate unavailable; gameplay remains disabled");
    const quote = await response.json() as ReferenceQuote;
    validateReferenceQuote(quote, mint);
    return { ...quote, baseUnitsPerUsd: BigInt(quote.baseUnitsPerUsd) };
  }
}
