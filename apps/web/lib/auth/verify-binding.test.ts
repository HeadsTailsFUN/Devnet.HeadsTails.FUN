import { after, test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { buildAuthMessage, type Challenge } from "./message";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://wallet-auth-fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
after(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

const key = nacl.sign.keyPair();
const wallet = bs58.encode(key.publicKey);
const sign = (challenge: Challenge) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(buildAuthMessage(challenge)), key.secretKey));
const request = (body: unknown) => new Request("https://headstails.fun/api/auth/fixture", {
  method: "POST",
  body: JSON.stringify(body),
});

test("wallet verification binds displayed times to the stored challenge and rejects replay", async () => {
  let issued = 0;
  let stored: { wallet: string; expires_at: string; used_at: string | null } | null = null;
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    assert.equal(new URL(req.url).hostname, "wallet-auth-fixture.invalid");
    if (new URL(req.url).pathname.endsWith("/issue_wallet_session_atomic")) {
      assert(stored && !stored.used_at);
      stored.used_at = new Date().toISOString();
      issued += 1;
      return Response.json(true);
    }
    assert(new URL(req.url).pathname.endsWith("/auth_nonces"));
    if (req.method === "DELETE") return new Response(null, { status: 204 });
    if (req.method === "POST") {
      const row = await req.json();
      stored = { wallet: row.wallet, expires_at: row.expires_at.replace("Z", "+00:00"), used_at: null };
      return new Response(null, { status: 201 });
    }
    return Response.json(stored);
  };

  const { POST: challenge } = await import("@/app/api/auth/challenge/route");
  const { POST: verify } = await import("@/app/api/auth/verify/route");
  assert.equal((await challenge(request({ wallet, padding: "x".repeat(2000) }))).status, 413);
  const response = await challenge(request({ wallet }));
  assert.equal(response.status, 200);
  const body: { challenge: Challenge } = await response.json();
  const changed = { ...body.challenge, issuedAt: new Date(0).toISOString() };
  assert.equal((await verify(request({ wallet, challenge: changed, signature: sign(changed) }))).status, 401);
  assert.equal((await verify(request({ wallet, challenge: body.challenge, signature: "A".repeat(300) }))).status, 401);
  assert.equal(issued, 0);
  const verifyBody = { wallet, challenge: body.challenge, signature: sign(body.challenge) };
  const verified = await verify(request(verifyBody));
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get("set-cookie") ?? "", /ht_session=[0-9a-f]{64};/);
  assert.equal((await verify(request(verifyBody))).status, 401);
  assert.equal(issued, 1);
});
