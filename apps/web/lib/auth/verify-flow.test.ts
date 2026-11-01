import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import nacl from "tweetnacl";
import bs58 from "bs58";

// Full challenge -> verify loop against the real backend (service role).
// Skipped in CI without Supabase credentials; run locally with
// SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL set.
const HAS_DB =
  typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
  typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string";

describe("auth challenge/verify loop", { skip: !HAS_DB } as { skip?: boolean }, () => {
  it("challenge, real signature, verify, replay rejected", async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { POST: challenge } = await import("../../app/api/auth/challenge/route.js");
    const { POST: verify } = await import("../../app/api/auth/verify/route.js");

    const chRes = await challenge(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      })
    );
    assert.equal(chRes.status, 200);
    const chBody = (await chRes.json()) as { challenge: never; message: string };
    const sig = nacl.sign.detached(new TextEncoder().encode(chBody.message), kp.secretKey);

    const vRes = await verify(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, signature: bs58.encode(sig), challenge: chBody.challenge }),
      })
    );
    assert.equal(vRes.status, 200);
    const setCookie = vRes.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("ht_session="));
    assert.ok(setCookie.includes("HttpOnly"));

    // Replay of the consumed challenge must fail.
    const replay = await verify(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, signature: bs58.encode(sig), challenge: chBody.challenge }),
      })
    );
    assert.equal(replay.status, 401);
  });

  it("wrong-wallet signature rejected", async () => {
    const a = nacl.sign.keyPair();
    const b = nacl.sign.keyPair();
    const wa = bs58.encode(a.publicKey);
    const { POST: challenge } = await import("../../app/api/auth/challenge/route.js");
    const { POST: verify } = await import("../../app/api/auth/verify/route.js");
    const chRes = await challenge(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wa }),
      })
    );
    const chBody = (await chRes.json()) as { challenge: never; message: string };
    const wrongSig = nacl.sign.detached(new TextEncoder().encode(chBody.message), b.secretKey);
    const vRes = await verify(
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wa, signature: bs58.encode(wrongSig), challenge: chBody.challenge }),
      })
    );
    assert.equal(vRes.status, 401);
  });
});
