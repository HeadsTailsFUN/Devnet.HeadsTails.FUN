import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Runs in its own process (separate file) so cluster env reads stay unset.
describe("browser supabase singleton (no env)", () => {
  it("returns null without backend config", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const { getBrowserSupabase, __resetBrowserSupabaseForTests } = await import(
      "./browserClient.js"
    );
    __resetBrowserSupabaseForTests();
    assert.equal(getBrowserSupabase(), null);
    assert.equal(getBrowserSupabase(), null);
    __resetBrowserSupabaseForTests();
  });
});
