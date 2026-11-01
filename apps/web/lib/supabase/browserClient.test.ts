import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

describe("browser supabase singleton", () => {
  it("returns the identical client instance across calls", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    const { getBrowserSupabase, __resetBrowserSupabaseForTests } = await import(
      "./browserClient.js"
    );
    __resetBrowserSupabaseForTests();
    const a = getBrowserSupabase();
    const b = getBrowserSupabase();
    const c = getBrowserSupabase();
    // Real client construction performs no network I/O; identity across
    // calls is what prevents duplicate GoTrueClient instances.
    assert.ok(a !== null);
    assert.equal(a, b);
    assert.equal(b, c);
    __resetBrowserSupabaseForTests();
    // After reset a fresh (but again singular) instance is created.
    const d = getBrowserSupabase();
    const e = getBrowserSupabase();
    assert.ok(d !== null);
    assert.equal(d, e);
    __resetBrowserSupabaseForTests();
  });
});
