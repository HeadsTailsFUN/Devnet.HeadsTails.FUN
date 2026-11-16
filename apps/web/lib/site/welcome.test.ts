import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { claimWelcomeIp, normalizeWelcomeIp, welcomeEntry, welcomeIpDigest, WELCOME_COOKIE } from "./welcome-entry";
import { welcomeAppHref } from "./welcome-links";

const original = { ...process.env }, originalFetch = globalThis.fetch;
beforeEach(() => { process.env = { ...original }; delete process.env.VERCEL; delete process.env.WELCOME_ENABLED; globalThis.fetch = originalFetch; });
after(() => { process.env = original; globalThis.fetch = originalFetch; });
const req = (path = "/", headers: Record<string, string> = {}) => new NextRequest(`https://headstails.fun${path}`, { headers });
function deployed() {
  process.env.VERCEL = "1"; process.env.WELCOME_IP_HASH_SECRET = "test-only-not-a-real-secret-123456789";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://welcome-fixture.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service";
}

test("first browser visit temporarily redirects; its next visit serves the unchanged root game", async () => {
  const first = await welcomeEntry(req()); assert.equal(first.status, 307);
  assert.equal(first.headers.get("location"), "https://headstails.fun/welcome");
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.match(first.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(first.headers.get("set-cookie")!, /SameSite=lax/i);
  const returning = await welcomeEntry(req("/", { cookie: `${WELCOME_COOKIE}=1` }));
  assert.equal(returning.headers.get("x-middleware-next"), "1"); assert.equal(returning.headers.get("location"), null);
});
test("direct welcome entry can always render and Launch App cannot redirect-loop", async () => {
  const welcome = await welcomeEntry(req("/welcome?ref=FRIEND"));
  assert.equal(welcome.headers.get("x-middleware-next"), "1"); assert.equal(welcome.cookies.get(WELCOME_COOKIE)?.value, "1");
  assert.equal(welcomeAppHref({ ref: "FRIEND" }), "/?ref=FRIEND");
  const launch = await welcomeEntry(req("/?ref=FRIEND")); assert.equal(launch.headers.get("location"), null);
});
test("legacy referrals, Earn Points, Discord notices, mobile tabs and wallet callbacks bypass the welcome gate", async () => {
  for (const query of ["ref=CODE", "earn=1", "earn=1&earn_notice=discord_verified", "tab=profile&info=privacy&ref=OWNER", "data=wallet-return&nonce=state"]) {
    const r = await welcomeEntry(req(`/?${query}`)); assert.equal(r.headers.get("x-middleware-next"), "1", query);
    assert.equal(r.headers.get("location"), null);
  }
});
test("ordinary campaign parameters retain the first-visit introduction and survive Launch App", async () => {
  const first=await welcomeEntry(req("/?utm_source=community"));
  assert.equal(first.status,307);assert.equal(new URL(first.headers.get("location")!).pathname,"/welcome");
  assert.equal(new URL(first.headers.get("location")!).searchParams.get("utm_source"),"community");
  assert.equal(welcomeAppHref({utm_source:"community"}),"/?utm_source=community");
});
test("prefetch and non-GET requests never consume a first visit", async () => {
  globalThis.fetch = async () => { throw new Error("must not call storage"); };
  const headerCases: Record<string,string>[] = [{ rsc: "1" }, { "next-router-prefetch": "1" }, { purpose: "prefetch" }];
  for (const headers of headerCases) {
    assert.equal((await welcomeEntry(req("/", headers))).headers.get("x-middleware-next"), "1");
  }
  for (const method of ["HEAD", "POST"]) {
    const r = await welcomeEntry(new NextRequest("https://headstails.fun/", { method }));
    assert.equal(r.headers.get("location"), null); assert.equal(r.headers.get("set-cookie"), null);
  }
});
test("same trusted IP skips the intro in a second browser, with atomic digest-only claims", async () => {
  deployed(); const seen = new Set<string>();
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://welcome-fixture.invalid/rest/v1/rpc/claim_site_welcome_visit");
    const body = JSON.parse(String(init?.body)); assert.match(body.p_ip_digest, /^[a-f0-9]{64}$/);
    assert.equal(String(init?.body).includes("203.0.113.9"), false); assert.deepEqual(Object.keys(body), ["p_ip_digest"]);
    const isNew = !seen.has(body.p_ip_digest); seen.add(body.p_ip_digest); return Response.json(isNew);
  };
  const first = await middleware(req("/", { "x-vercel-forwarded-for": "203.0.113.9" }));
  assert.equal(first.status, 307);
  const second = await middleware(req("/", { "x-vercel-forwarded-for": "203.0.113.9" }));
  assert.equal(second.headers.get("location"), null); assert.equal(second.headers.get("x-middleware-next"), "1");
  assert.equal((await middleware(req("/", { "x-vercel-forwarded-for": "203.0.113.10" }))).status, 307);
  assert.equal(seen.size, 2);
});
test("malformed / untrusted ingress values cannot be stored as IP fingerprints", async () => {
  assert.equal(normalizeWelcomeIp("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeWelcomeIp("2001:0DB8:0000::1"), "2001:db8::1");
  for (const v of [null, "", "999.1.1.1", "1.2.3.04", "203.0.113.1, 1.2.3.4", "attacker", "http://evil.invalid", "::ffff:1.2.3.4%zone"]) assert.equal(normalizeWelcomeIp(v), null);
  let calls = 0; const forbidden = (async () => { calls++; throw new Error(); }) as typeof fetch;
  await claimWelcomeIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.9" }), forbidden);
  deployed(); await claimWelcomeIp(new Headers({ "x-forwarded-for": "203.0.113.9, 1.2.3.4" }), forbidden);
  assert.equal(calls, 0);
});
test("Vercel's overwritten standard forwarded header is supported when its alias is absent", async () => {
  deployed(); let calls=0;
  const result=await claimWelcomeIp(new Headers({"x-forwarded-for":"203.0.113.19"}),async()=>{calls++;return Response.json(true);});
  assert.equal(result,true);assert.equal(calls,1);
});
test("an existing browser and wallet session cannot hide a genuinely new IP", async () => {
  deployed(); const seen = new Set<string>(); let calls = 0;
  globalThis.fetch = async (_input, init) => { calls++; const key=JSON.parse(String(init?.body)).p_ip_digest; const first=!seen.has(key);seen.add(key);return Response.json(first); };
  const first=await welcomeEntry(req("/", {"x-vercel-forwarded-for":"203.0.113.20"}));
  assert.equal(first.status,307); const old=first.cookies.get(WELCOME_COOKIE)!.value;assert.match(old,/^[a-f0-9]{64}$/);
  const same=await welcomeEntry(req("/", {"x-vercel-forwarded-for":"203.0.113.20",cookie:`${WELCOME_COOKIE}=${old}; ht_session=unchanged-owner-session`}));
  assert.equal(same.headers.get("location"),null);assert.equal(calls,1);
  const changed=await welcomeEntry(req("/", {"x-vercel-forwarded-for":"203.0.113.21",cookie:`${WELCOME_COOKIE}=${old}; ht_session=unchanged-owner-session`}));
  assert.equal(changed.status,307);assert.notEqual(changed.cookies.get(WELCOME_COOKIE)!.value,old);
  assert.equal(changed.cookies.get("ht_session"),undefined);
  const knownAgain=await welcomeEntry(req("/", {"x-vercel-forwarded-for":"203.0.113.20",cookie:`${WELCOME_COOKIE}=${changed.cookies.get(WELCOME_COOKIE)!.value}`}));
  assert.equal(knownAgain.headers.get("location"),null);assert.equal(knownAgain.cookies.get(WELCOME_COOKIE)!.value,old);
});
test("a direct welcome visit on the new IP permits Launch App without looping", async () => {
  deployed(); globalThis.fetch=async()=>Response.json(true);
  const welcome=await welcomeEntry(req("/welcome",{"x-vercel-forwarded-for":"203.0.113.22",cookie:`${WELCOME_COOKIE}=1`}));
  const value=welcome.cookies.get(WELCOME_COOKIE)!.value;assert.match(value,/^[a-f0-9]{64}$/);
  globalThis.fetch=async()=>{throw new Error("matching IP cookie must not need storage");};
  assert.equal((await welcomeEntry(req("/",{"x-vercel-forwarded-for":"203.0.113.22",cookie:`${WELCOME_COOKIE}=${value}`}))).headers.get("location"),null);
});
test("staged deployment visits cannot consume the canonical production IP introduction", async () => {
  assert.notEqual(await welcomeIpDigest("203.0.113.9","test-key","preview.vercel.app"),await welcomeIpDigest("203.0.113.9","test-key","headstails.fun"));
});
test("HMAC is stable for the same normalized IP and separates keys and IPs", async () => {
  const a = await welcomeIpDigest("203.0.113.9", "test-key-a"); assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, await welcomeIpDigest("203.0.113.9", "test-key-a"));
  assert.notEqual(a, await welcomeIpDigest("203.0.113.9", "test-key-b"));
  assert.notEqual(a, await welcomeIpDigest("203.0.113.10", "test-key-a"));
});
test("storage failure, missing configuration and malformed RPC responses cannot block the live game", async () => {
  deployed();
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => Response.json({ error: "unavailable" }, { status: 503 }), async () => Response.json({ first: true })]) {
    globalThis.fetch = fetcher;
    const r = await welcomeEntry(req("/", { "x-vercel-forwarded-for": "203.0.113.9" }));
    assert.equal(r.headers.get("x-middleware-next"), "1"); assert.equal(r.headers.get("location"), null);
  }
  delete process.env.WELCOME_IP_HASH_SECRET;
  assert.equal((await welcomeEntry(req())).headers.get("location"), null);
});
test("rollback flag only disables the introduction; existing API origin protection stays active", async () => {
  process.env.WELCOME_ENABLED = "false";
  assert.equal((await middleware(req())).headers.get("x-middleware-next"), "1");
  const api = await middleware(req("/api/auth/session", { origin: "https://other.invalid" }));
  assert.equal(api.status, 403); assert.equal(api.headers.get("access-control-allow-origin"), null);
});
test("welcome CTA links retain repeated parameters and cannot become external redirects", () => {
  const launch = new URL(welcomeAppHref({ ref: "A&B", tag: ["one", "two"], returnTo: "https://evil.invalid" }), "https://headstails.fun");
  assert.equal(launch.origin, "https://headstails.fun"); assert.equal(launch.pathname, "/");
  assert.equal(launch.searchParams.get("ref"), "A&B"); assert.deepEqual(launch.searchParams.getAll("tag"), ["one", "two"]);
  assert.equal(new URL(welcomeAppHref({ ref: "KEEP", earn: "0" }, true), launch.origin).searchParams.get("earn"), "1");
});
