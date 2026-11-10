import { test, after } from "node:test";
import assert from "node:assert/strict";
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "SYNTHETIC_PUBLIC_KEY";
process.env.SUPABASE_SERVICE_ROLE_KEY = "SYNTHETIC_SERVER_KEY";
const queries: URL[] = [];
globalThis.fetch = async (input, init) => {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  assert.equal(
    req.method,
    "GET",
    "display windows must never delete or mutate history",
  );
  const url = new URL(req.url);
  queries.push(url);
  return Response.json([]);
};
test("chat query caps oversized requests at 50 with deterministic database ordering", async () => {
  const { GET } = await import("@/app/api/chat/messages/route");
  const response = await GET(
    new Request("https://local.invalid/api/chat/messages?limit=100000"),
  );
  assert.equal(response.status, 200);
  const query = queries.findLast((q) => q.pathname.endsWith("chat_messages"))!;
  assert.equal(query.searchParams.get("limit"), "50");
  assert.equal(query.searchParams.get("order"), "created_at.desc,id.desc");
  assert.equal(query.searchParams.get("deleted_at"), "is.null");
});
test("settled history defaults and clamps to 50 at database, preserving older records", async () => {
  const { fetchRecentFlips } = await import("@/lib/solana/history");
  assert.equal((await fetchRecentFlips()).status, "empty");
  assert.equal((await fetchRecentFlips(100000, 10)).status, "empty");
  const history = queries.filter((q) => q.pathname.endsWith("matches"));
  assert.equal(history.length, 2);
  for (const query of history) {
    assert.equal(query.searchParams.get("limit"), "50");
    assert.equal(
      query.searchParams.get("order"),
      "settled_at.desc.nullslast,settled_slot.desc.nullslast,id.desc",
    );
    assert.equal(query.searchParams.get("settled_at"), "not.is.null");
  }
  assert.equal(history[1].searchParams.get("tier_usd"), "eq.10");
});
