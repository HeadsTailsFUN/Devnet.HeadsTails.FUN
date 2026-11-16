import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { earnConfig, publicEarnConfig } from "./config";
import { nonce, digest, readBody, serviceIdentity, EarnError, xProfile, xPost } from "./server";
import { telegramRoute } from "./telegram";
import { earnAction, earnStatus } from "./actions";
import { discordCallback, discordMembership } from "./discord";
import { GET as adminRead, POST as adminWrite } from "../../app/api/admin/earn-verifications/route";
import { SESSION_COOKIE } from "../auth/message";
import { telegramFeedback } from "./telegram-feedback";

const initialEnv = { ...process.env }, initialFetch = globalThis.fetch;
const base = "https://earn-fixture.invalid", secret = "synthetic-service-credential-not-a-real-secret";
const tg = 123456789, group = -1001234567890, channel = -1001234567891;
const state = "S".repeat(43), token = "T".repeat(43), discordId = "123456789012345678";
const cookie = `${SESSION_COOKIE}=${"a".repeat(64)}`;

test("every terminal membership outcome is explicit, while completed claims remain authoritative", () => {
  const options={blocked:null,rewardsEnabled:true,active:true} as const;
  const job={result_status:"VERIFIED",completed_at:"2026-11-16T00:00:00Z",expires_at:"2099-01-01"};
  for(const status of ["NOT_MEMBER","PENDING","UNAVAILABLE","ERROR"]){
    const feedback=telegramFeedback({...job,result_status:status},false,options)!;
    assert(feedback.message.length>20);assert.equal(feedback.pending,false);assert.equal(feedback.retry,true);
    assert.notEqual(feedback.label,"Available");
  }
  assert.match(telegramFeedback(job,false,{...options,blocked:"admin_account"})!.message,/Administrator wallets/);
  assert.match(telegramFeedback(job,false,{...options,rewardsEnabled:false})!.message,/rewards are disabled/);
  assert.match(telegramFeedback(job,false,{...options,active:false})!.message,/quest is inactive/);
  assert.equal(telegramFeedback(job,true,options),null);
  assert.equal(telegramFeedback({...job,completed_at:null},false,options)!.pending,true);
});
type Call = { url: URL; body: Record<string, unknown> | null; init?: RequestInit };
afterEach(() => {
  globalThis.fetch = initialFetch;
  for (const k of Object.keys(process.env)) if (!(k in initialEnv)) delete process.env[k];
  Object.assign(process.env, initialEnv);
});
function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = base; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-db-key";
  process.env.HEADSTAILS_WEBSITE_API_KEY = secret;
  process.env.EARN_TELEGRAM_ENABLED = "true"; process.env.EARN_TELEGRAM_LINKING_ENABLED = "true"; process.env.EARN_TELEGRAM_JOBS_ENABLED = "true";
  process.env.EARN_TELEGRAM_GROUP_ID = String(group); process.env.EARN_TELEGRAM_CHANNEL_ID = String(channel); process.env.EARN_TELEGRAM_BOT_USERNAME = "HeadsTailsFixtureBot";
  process.env.EARN_DISCORD_ENABLED = "true"; process.env.EARN_DISCORD_CLIENT_ID = discordId;
  process.env.EARN_DISCORD_CLIENT_SECRET = "synthetic-discord-secret"; process.env.EARN_DISCORD_GUILD_ID = "223456789012345678";
  process.env.EARN_DISCORD_REDIRECT_URI = `${base}/api/earn/discord/callback`;
  process.env.EARN_NEW_REWARDS_ENABLED = "true"; process.env.EARN_X_MANUAL_VERIFICATION_ENABLED = "true";
  delete process.env.SOLANA_SERVER_RPC_URL; delete process.env.NEXT_PUBLIC_RPC_URL;
}
function backend(override?: (c: Call) => Response | undefined) {
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    const call = { url, body, init }; calls.push(call);
    const custom = override?.(call); if (custom) return custom;
    const table = url.pathname.split("/").at(-1);
    if (table === "auth_sessions") return Response.json({ wallet: "session-owner", expires_at: "2099-01-01T00:00:00Z" });
    if (table === "airdrop_seasons") return Response.json({ id: "active-season", key: "DEVNET_BETA" });
    if (table === "earn_season_settings") return Response.json({ telegram_linking: true, telegram_jobs: true, discord_enabled: true,
      x_manual_enabled: true, new_rewards_enabled: true, quest_flags: { three_days: true } });
    if (table === "earn_request_receipts") return Response.json(null);
    if (table === "earn_dispatch") {
      const action = body?.p_action;
      return Response.json(action === "rate" ? { allowed: true } : action === "token" ? { status: "created", expires_at: Date.now() / 1000 + 600 } :
        action === "telegram_poll" ? { ok: true, jobs: [] } : action === "telegram_link" ? { ok: true, status: "linked", account_ref: randomUUID() } :
        action === "discord_consume" ? { status: "consumed" } : action === "discord_link" ? { status: "linked" } : { ok: true });
    }
    if (table === "earn_three_day_progress") return Response.json(0);
    if (["earn_social_links", "earn_quest_claims", "earn_verification_jobs", "earn_x_challenges"].includes(table ?? "")) return Response.json([]);
    if (["airdrop_x_identities", "earn_social_disconnects", "admin_members", "reward_exclusions"].includes(table ?? "")) return Response.json(null);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  return calls;
}
function request(path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${base}${path}`, { method: body ? "POST" : "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
}
function service(path: string, body?: Record<string, unknown>, idem?: string) {
  return request(`/api/telegram/${path}`, body, { Authorization: `Bearer ${secret}`, "X-Request-Id": randomUUID(), ...(idem ? { "Idempotency-Key": idem } : {}) });
}
function linkBody() { const request_id = randomUUID(); return { token, telegram_user_id: tg, request_id }; }
function resultBody() { const job_id = randomUUID(); return { job_id, telegram_user_id: tg, chat: "group", chat_id: group, status: "VERIFIED", checked_at: Date.now() / 1000, source: "telegram-getChatMember" }; }

test("all server switches fail closed and public configuration contains no credentials", () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("EARN_")) delete process.env[k];
  assert.equal(earnConfig().enabled, false); assert.equal(earnConfig().rewards, false); assert.equal(earnConfig().discord, false);
  configure(); assert.equal(earnConfig().groupId, group);
  process.env.EARN_TELEGRAM_CHANNEL_ID = String(group); assert.equal(earnConfig().groupId, null);
  process.env.EARN_TELEGRAM_CHANNEL_ID = "-9999999999999999"; assert.equal(earnConfig().channelId, null);
  const exposed = JSON.stringify(publicEarnConfig()); assert(!exposed.includes(secret)); assert(!exposed.includes("synthetic-discord-secret")); assert(!exposed.includes("synthetic-db-key"));
});
test("link nonces are unpredictable URL-safe 32-byte values and stored digests are distinct", () => {
  const a = nonce(), b = nonce(); assert.match(a, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a, b); assert.notEqual(digest(a), a); assert.equal(digest(a).length, 64);
});
test("X profile and post validation rejects spoofed origins, credentials, reserved paths and malformed evidence", () => {
  assert.deepEqual(xProfile("https://twitter.com/FlipViper/"), { handle: "flipviper", profileUrl: "https://x.com/flipviper" });
  for (const url of ["http://x.com/test", "https://x.com.evil.invalid/test", "https://x.com@evil.invalid/test", "https://u:p@x.com/test", "https://x.com/home", "https://x.com/a/status/1", "https://x.com/test?ref=1"]) assert.throws(() => xProfile(url), EarnError);
  assert.equal(xPost("https://x.com/alice/status/123?s=20")?.url, "https://x.com/alice/status/123");
  assert.equal(xPost("javascript:alert(1)"), null); assert.equal(xPost("https://x.com/alice"), null);
});
test("JSON parser rejects non-object, invalid media type and oversized streams", async () => {
  for (const body of ["[]", "null", "{"]) await assert.rejects(readBody(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body })), EarnError);
  await assert.rejects(readBody(new Request(base, { method: "POST", body: "{}" })), (e: unknown) => e instanceof EarnError && e.status === 415);
  await assert.rejects(readBody(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(65536) }) })), (e: unknown) => e instanceof EarnError && e.status === 413);
});
test("service authentication rejects missing/incorrect credentials and invalid request IDs before database access", async () => {
  configure(); const calls = backend();
  assert.equal((await telegramRoute(request("/api/telegram/health"), "health")).status, 401);
  assert.throws(() => serviceIdentity(request("/api/telegram/health", undefined, { Authorization: "Bearer incorrect", "X-Request-Id": randomUUID() })), EarnError);
  assert.throws(() => serviceIdentity(request("/api/telegram/health", undefined, { Authorization: `Bearer ${secret}`, "X-Request-Id": "not-an-id" })), EarnError);
  assert.equal(calls.length, 0);
});
test("service endpoint rejects plaintext HTTP in production", () => {
  configure(); Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });
  assert.throws(() => serviceIdentity(new Request("http://example.invalid/api/telegram/health")), (e: unknown) => e instanceof EarnError && e.code === "https_required");
});
test("disabled integration and absent database fail closed without operational health claims", async () => {
  configure(); backend(); process.env.EARN_TELEGRAM_ENABLED = "false";
  assert.equal((await telegramRoute(service("health"), "health")).status, 503);
  process.env.EARN_TELEGRAM_ENABLED = "true"; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await telegramRoute(service("health"), "health")).status, 503);
});
test("authenticated health confirms installed storage and sends no-store privacy headers", async () => {
  configure(); backend(); const r = await telegramRoute(service("health"), "health");
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, status: "operational" });
  assert.equal(r.headers.get("cache-control"), "private, no-store");
});
test("link handler hashes the nonce, never passes raw secrets to SQL and returns only an opaque account reference", async () => {
  configure(); const calls = backend(), body = linkBody();
  const r = await telegramRoute(service("link", body, body.request_id), "link"); assert.equal(r.status, 200);
  const b = await r.json(); assert.equal(b.ok, true); assert.equal(b.status, "linked"); assert.equal(b.wallet, undefined);
  const rpc = calls.find(c => c.body?.p_action === "telegram_link")!;
  assert.equal((rpc.body?.p_data as Record<string, unknown>).token_digest, digest(token));
  assert(!JSON.stringify(rpc.body).includes(token)); assert(!JSON.stringify(rpc.body).includes(secret));
});
test("link receipt replay bypasses rate counters and rejects changed request bodies", async () => {
  configure(); const body = linkBody(), response = { ok: true, status: "already_linked", account_ref: randomUUID() };
  const calls = backend(c => c.url.pathname.endsWith("earn_request_receipts") ? Response.json({ body_digest: digest(JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))))), response }) : undefined);
  const r = await telegramRoute(service("link", body, body.request_id), "link"); assert.deepEqual(await r.json(), response);
  assert(!calls.some(c => c.body?.p_action === "rate"));
  assert.equal((await telegramRoute(service("link", { ...body, telegram_user_id: tg + 1 }, body.request_id), "link")).status, 409);
});
test("link validation rejects typed/unsafe IDs, wrong idempotency keys and invalid token lengths", async () => {
  configure(); const calls = backend(), body = linkBody();
  assert.equal((await telegramRoute(service("link", { ...body, telegram_user_id: String(tg) }, body.request_id), "link")).status, 400);
  assert.equal((await telegramRoute(service("link", { ...body, telegram_user_id: Number.MAX_SAFE_INTEGER + 1 }, body.request_id), "link")).status, 400);
  assert.equal((await telegramRoute(service("link", body, randomUUID()), "link")).status, 400);
  const r = await telegramRoute(service("link", { ...body, token: "short" }, body.request_id), "link"); assert.deepEqual(await r.json(), { ok: false, status: "invalid" });
  assert(!calls.some(c => c.body?.p_action === "telegram_link"));
});
test("job polls are bounded, rate limited and do not accept arbitrary chat scopes", async () => {
  configure(); backend();
  for (const limit of ["0", "51", "-1", "1.5", "abc"]) assert.equal((await telegramRoute(service(`verification-jobs?limit=${limit}`), "verification-jobs")).status, 400);
  const r = await telegramRoute(service("verification-jobs?limit=20"), "verification-jobs"); assert.deepEqual(await r.json(), { ok: true, jobs: [] });
  backend(c => c.body?.p_action === "rate" ? Response.json({ allowed: false, retry_after: 30 }) : undefined);
  const limited = await telegramRoute(service("verification-jobs"), "verification-jobs"); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "30");
});
test("membership result validates job scope, source, freshness, result enum and idempotency key", async () => {
  configure(); const calls = backend(), b = resultBody(), key = `verification:${b.job_id}`;
  for (const patch of [{ chat_id: channel }, { chat: "other" }, { source: "browser" }, { status: "probably" }, { checked_at: Date.now() / 1000 + 1000 }, { detail: "x".repeat(251) }]) {
    assert.equal((await telegramRoute(service("verification-results", { ...b, ...patch }, key), "verification-results")).status, 400);
  }
  assert.equal((await telegramRoute(service("verification-results", b, "wrong-key"), "verification-results")).status, 400);
  assert(!calls.some(c => c.body?.p_action === "telegram_result"));
});
test("result ACK is returned only after storage succeeds, never on durable-storage failure", async () => {
  configure(); const b = resultBody(), key = `verification:${b.job_id}`; backend();
  assert.deepEqual(await (await telegramRoute(service("verification-results", b, key), "verification-results")).json(), { ok: true });
  backend(c => c.body?.p_action === "telegram_result" ? Response.json({ message: "synthetic database failure" }, { status: 400 }) : undefined);
  const r = await telegramRoute(service("verification-results", b, key), "verification-results"); assert.equal(r.status, 503);
  const text = await r.text(); assert(!text.includes('"ok":true')); assert(!text.includes("synthetic database failure"));
});
test("wallet mutations ignore supplied wallet fields and issue private owner-bound Telegram deep links", async () => {
  configure(); const calls = backend();
  const r = await earnAction(request("/api/earn/action", { action: "telegram_token", wallet: "attacker-wallet" }, { cookie, origin: base }));
  assert.equal(r.status, 200); const b = await r.json(); assert.equal(b.wallet, "session-owner");
  assert.match(b.deepLink, /^https:\/\/t.me\/HeadsTailsFixtureBot\?start=[A-Za-z0-9_-]{43}$/);
  const rpc = calls.find(c => c.body?.p_action === "token")!; assert.equal(rpc.body?.p_wallet, "session-owner"); assert(!JSON.stringify(rpc.body).includes(b.deepLink.split("=")[1]));
});
test("wallet routes reject unauthenticated and cross-origin mutations; admin endpoints never accept an address alone", async () => {
  configure(); backend();
  assert.equal((await earnAction(request("/api/earn/action", { action: "unlink", wallet: "owner" }))).status, 401);
  assert.equal((await earnAction(request("/api/earn/action", { action: "unlink", provider: "telegram" }, { cookie, origin: "https://attacker.invalid" }))).status, 403);
  assert.equal((await adminRead(request("/api/admin/earn-verifications?wallet=owner"))).status, 401);
  assert.equal((await adminWrite(request("/api/admin/earn-verifications", { wallet: "owner", decision: "verified" }))).status, 401);
});
test("private quest status is scoped to the authenticated wallet, not query parameters", async () => {
  configure(); const calls = backend();
  const r = await earnStatus(request("/api/earn/status?wallet=attacker", undefined, { cookie })); assert.equal(r.status, 200);
  const b = await r.json(); assert.equal(b.wallet, "session-owner"); assert.equal(b.gameplayDays, 0);
  for (const c of calls.filter(c => ["earn_social_links", "earn_quest_claims", "earn_verification_jobs", "earn_x_challenges", "admin_members", "reward_exclusions"].some(t => c.url.pathname.endsWith(t)))) assert.equal(c.url.searchParams.get("wallet"), "eq.session-owner");
  assert.equal(b.rewardBlockReason, null);
});

test("verified Telegram jobs for administrators retain evidence and expose the actual no-reward reason", async () => {
  configure(); const calls = backend(c => c.url.pathname.endsWith("admin_members") ? Response.json({ wallet: "session-owner" })
    : c.url.pathname.endsWith("earn_verification_jobs") ? Response.json([{ job_id: "job-fixture", chat: "group", result_status: "VERIFIED", completed_at: new Date().toISOString(), expires_at: new Date(Date.now()+600000).toISOString() }]) : undefined);
  const r = await earnStatus(request("/api/earn/status", undefined, { cookie })); assert.equal(r.status, 200);
  const b = await r.json(); assert.equal(b.rewardBlockReason, "admin_account"); assert.equal(b.newRewardsEnabled, true);
  const quest = b.quests.find((q: { id: string }) => q.id === "telegram_group");
  assert.equal(quest.job.result_status, "VERIFIED"); assert.equal(quest.claim, null);
  assert.equal(calls.filter(c => c.body?.p_action === "three_days").length, 0);
});

test("exclusion and season timing are explicit and eligibility lookup errors never imply eligibility", async () => {
  configure(); backend(c => c.url.pathname.endsWith("reward_exclusions") ? Response.json({ wallet: "session-owner" }) : undefined);
  assert.equal((await (await earnStatus(request("/api/earn/status", undefined, { cookie }))).json()).rewardBlockReason, "reward_excluded");
  backend(c => c.url.pathname.endsWith("airdrop_seasons") ? Response.json({id:"active-season", key:"DEVNET_BETA", starts_at:"2099-01-01"}) : undefined);
  assert.equal((await (await earnStatus(request("/api/earn/status", undefined, { cookie }))).json()).rewardBlockReason, "season_inactive");
  backend(c => c.url.pathname.endsWith("reward_exclusions") ? Response.json({ message: "fixture storage error" }, { status: 500 }) : undefined);
  assert.equal((await earnStatus(request("/api/earn/status", undefined, { cookie }))).status, 503);
});
test("retroactive three-day progress automatically evaluates a reward only with both activation gates", async () => {
  configure(); const calls = backend(c => c.url.pathname.endsWith("earn_three_day_progress") ? Response.json(3) : undefined);
  assert.equal((await earnStatus(request("/api/earn/status", undefined, { cookie }))).status, 200);
  assert.equal(calls.filter(c => c.body?.p_action === "three_days").length, 1);
  process.env.EARN_NEW_REWARDS_ENABLED = "false";
  const off = backend(c => c.url.pathname.endsWith("earn_three_day_progress") ? Response.json(3) : undefined);
  const status = await earnStatus(request("/api/earn/status", undefined, { cookie }));
  const body = await status.json(); assert.equal(body.newRewardsEnabled, false);
  assert.equal(body.quests.find((q: { id: string }) => q.id === "three_days").active, true);
  assert.equal(off.filter(c => c.body?.p_action === "three_days").length, 0);
});
test("Discord screening, unavailable metadata and rate limits fail closed", () => {
  assert.equal(discordMembership(200, { user: { id: discordId }, joined_at: "2026-11-01", pending: false }, discordId), "VERIFIED");
  assert.equal(discordMembership(200, { user: { id: discordId }, joined_at: "2026-11-01", pending: true }, discordId), "PENDING");
  assert.equal(discordMembership(200, { user: { id: discordId }, joined_at: "2026-11-01" }, discordId), "UNAVAILABLE");
  assert.equal(discordMembership(200, { user: { id: "another-user" }, joined_at: "2026-11-01", pending: false }, discordId), "UNAVAILABLE");
  assert.equal(discordMembership(404, null, discordId), "NOT_MEMBER"); assert.equal(discordMembership(429, null, discordId), "PENDING"); assert.equal(discordMembership(503, {}, discordId), "UNAVAILABLE");
});
test("Discord authorization uses only official endpoints, required scopes and a private expiring state cookie", async () => {
  configure(); backend(); const r = await earnAction(request("/api/earn/action", { action: "discord_connect" }, { cookie }));
  assert.equal(r.status, 200); const b = await r.json(), u = new URL(b.authorizeUrl);
  assert.equal(u.origin, "https://discord.com"); assert.equal(u.searchParams.get("scope"), "identify guilds.members.read");
  assert.match(u.searchParams.get("state")!, /^[A-Za-z0-9_-]{43}$/);
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/i); assert.match(r.headers.get("set-cookie")!, /Secure/i); assert.match(r.headers.get("set-cookie")!, /Max-Age=600/i);
});
test("Discord callback rejects missing/mismatched state or issuer before token exchange", async () => {
  configure(); const calls = backend();
  for (const query of [`state=wrong&code=code`, `state=${state}&code=code&iss=https://attacker.invalid`]) {
    const r = await discordCallback(request(`/api/earn/discord/callback?${query}`, undefined, { cookie: `${cookie}; ht_earn_discord_state=${state}` }));
    assert.match(r.headers.get("location")!, /discord_invalid_state/);
  }
  assert(!calls.some(c => c.url.hostname === "discord.com"));
});
test("cancelled Discord authorization consumes state and never requests identity or awards Points", async () => {
  configure(); const calls = backend(); const r = await discordCallback(request(`/api/earn/discord/callback?state=${state}&error=access_denied`, undefined, { cookie: `${cookie}; ht_earn_discord_state=${state}` }));
  assert.match(r.headers.get("location")!, /discord_denied/); assert(calls.some(c => c.body?.p_action === "discord_consume")); assert(!calls.some(c => c.body?.p_action === "discord_link"));
});
test("Discord callback checks real identity and membership, records only proof metadata and revokes its in-memory token", async () => {
  configure(); const calls: string[] = [], db = backend(); const dbFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://discord.com/")) return dbFetch(input, init);
    calls.push(url);
    if (url.endsWith("/token")) return Response.json({ access_token: "synthetic-oauth-access", token_type: "Bearer", scope: "identify guilds.members.read" });
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    if (url.endsWith("/@me")) return Response.json({ id: discordId, username: "fixture" });
    return Response.json({ user: { id: discordId }, pending: false, joined_at: "2026-11-01T00:00:00Z" });
  };
  const r = await discordCallback(request(`/api/earn/discord/callback?state=${state}&code=synthetic-code`, undefined, { cookie: `${cookie}; ht_earn_discord_state=${state}` }));
  assert.equal(r.status, 303); assert.match(r.headers.get("location")!, /discord_verified/); assert(calls.some(c => c.endsWith("/revoke")));
  const link = db.find(c => c.body?.p_action === "discord_link")!; assert.equal((link.body?.p_data as Record<string, unknown>).membership, "VERIFIED");
  const stored = JSON.stringify(db.map(c => c.body)); assert(!stored.includes("synthetic-oauth-access")); assert(!stored.includes("synthetic-code")); assert(!stored.includes("synthetic-discord-secret"));
});
test("Discord unavailable membership cannot become VERIFIED or leak an access token", async () => {
  configure(); const db = backend(), dbFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input); if (!url.startsWith("https://discord.com/")) return dbFetch(input, init);
    if (url.endsWith("/token")) return Response.json({ access_token: "synthetic-access", token_type: "Bearer", scope: "identify guilds.members.read" });
    if (url.endsWith("/revoke")) return new Response(null);
    if (url.endsWith("/@me")) return Response.json({ id: discordId });
    return Response.json({ error: "unavailable" }, { status: 503 });
  };
  const r = await discordCallback(request(`/api/earn/discord/callback?state=${state}&code=code`, undefined, { cookie: `${cookie}; ht_earn_discord_state=${state}` }));
  assert.match(r.headers.get("location")!, /discord_unavailable/);
  assert.equal((db.find(c => c.body?.p_action === "discord_link")?.body?.p_data as Record<string, unknown>).membership, "UNAVAILABLE");
  assert(!(await r.text()).includes("synthetic-access"));
});
