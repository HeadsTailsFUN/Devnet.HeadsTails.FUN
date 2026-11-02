import { validateReferenceQuote, type ReferenceQuote, type PriceAdapter, type PriceQuote } from "@heads-or-tails/game-sdk";

/** Authoritative server quote; the program independently enforces the same immutable test rate. */
export class DevnetUsdQuoteAdapter implements PriceAdapter {
  async getQuote(mint: string): Promise<PriceQuote> {
    const started = performance.now();
    const response = await fetch("/api/devnet/usd-quote", { cache: "no-store" });
    if (!response.ok) throw new Error("Devnet Test Rate unavailable; gameplay remains disabled");
    const quote = await response.json() as ReferenceQuote;
    // The HTTPS server's Date is the quote's clock. A phone clock even one
    // second behind used to reject a newly issued quote as future-dated.
    // Round Date UP (its precision is one second), then add the ENTIRE
    // monotonic request duration: this overestimates age, never extends TTL.
    const serverDate = Date.parse(response.headers.get("date") ?? "");
    const elapsed = Math.ceil(performance.now() - started);
    if (!Number.isFinite(serverDate) || elapsed < 0 || elapsed >= 30_000 ||
        Number(response.headers.get("age") ?? "0") !== 0) {
      throw new Error("Devnet Test Rate freshness could not be verified");
    }
    const verifiedNow = serverDate + 1_000 + elapsed;
    validateReferenceQuote(quote, mint, verifiedNow);
    const age = verifiedNow - quote.updatedAtMs;
    return { ...quote, updatedAtMs: Date.now() - age, baseUnitsPerUsd: BigInt(quote.baseUnitsPerUsd) };
  }
}
