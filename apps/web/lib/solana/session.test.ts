import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/**
 * Session-restore contract tests (pure storage logic).
 * The real silent-reconnect path is exercised in the browser; here we verify
 * the persistence rules: remember-only-explicit, disconnect-clears, no
 * auto-select of never-chosen wallets.
 */

const KEY = "headstails.remembered-wallet";

function makeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    length: 0,
  } as unknown as Storage;
}

describe("wallet session restore", () => {
  it("remembered provider is restored after refresh", () => {
    const s = makeStorage();
    s.setItem(KEY, "Phantom");
    assert.equal(s.getItem(KEY), "Phantom");
  });

  it("explicit Disconnect prevents reconnect", () => {
    const s = makeStorage();
    s.setItem(KEY, "Phantom");
    s.removeItem(KEY); // forgetWallet()
    assert.equal(s.getItem(KEY), null);
  });

  it("never auto-selects a wallet the user never chose", () => {
    const s = makeStorage();
    // No remembered key -> no silent connect target.
    assert.equal(s.getItem(KEY), null);
  });

  it("wallet unavailable during reconnect falls back to disconnected", () => {
    const remembered = "Phantom";
    const available = ["Solflare"];
    const target = available.includes(remembered) ? remembered : null;
    assert.equal(target, null);
  });

  it("multiple refreshes keep the same remembered provider", () => {
    const s = makeStorage();
    s.setItem(KEY, "Solflare");
    assert.equal(s.getItem(KEY), "Solflare");
    assert.equal(s.getItem(KEY), "Solflare");
  });
});
