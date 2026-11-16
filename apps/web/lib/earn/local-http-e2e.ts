// Offline-only integration runner. Real HTTP -> handlers -> Supabase client -> PostgREST -> disposable PostgreSQL.
// No provider calls, real wallets, production credentials or production database access.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { earnAction, earnStatus } from "./actions";
import { telegramRoute } from "./telegram";
import { GET as adminRead, POST as adminWrite } from "../../app/api/admin/earn-verifications/route";
import { POST as socialClaim } from "../../app/api/airdrop/social-claim/route";
import { POST as socialEdit } from "../../app/api/airdrop/social-edit/route";
import { digest } from "./server";
import { SESSION_COOKIE } from "../auth/message";

async function main() {
const root = path.resolve(__dirname, "../../../..");
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
execFileSync(process.execPath, ["scripts/bootstrap-earn-sql.mjs"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
console.log("SETUP isolated database created");
const { container, db } = JSON.parse(fs.readFileSync(path.join(root, "artifacts/earn-points/verification-db.json"), "utf8")) as { container: string; db: string };
assert.equal(container, "headstails-earn-v510-qa"); assert.match(db, /^earn_bootstrap_\d+$/);
assert.equal(docker("inspect", "-f", '{{index .Config.Labels "headstails.purpose"}}', container), "earn-v510-isolated-tests");
const sql = (input: string) => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
const network = `headstails-earn-e2e-${process.pid}`, restName = `${network}-rest`;
const signing = randomBytes(32).toString("hex"), serviceKey = randomBytes(32).toString("hex");
const payload = Buffer.from(JSON.stringify({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
const unsigned = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." + payload;
const jwt = unsigned + "." + createHmac("sha256", signing).update(unsigned).digest("base64url");
const ownerSession = randomBytes(32).toString("hex"), reviewerSession = randomBytes(32).toString("hex");
sql(`create table public.auth_sessions(token_hash text primary key,wallet text not null,expires_at timestamptz not null);
grant select on public.auth_sessions to service_role;
insert into public.auth_sessions values(${literal(digest(ownerSession))},'offline-owner',now()+interval '1 hour'),(${literal(digest(reviewerSession))},'offline-reviewer',now()+interval '1 hour');
insert into public.admin_members values('offline-reviewer','FULL_ADMIN');
update public.airdrop_seasons set starts_at=now()-interval '1 day' where active;`);
sql(`create table public.profiles(wallet text primary key,username text);
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(),admin_wallet text,action text,target text,metadata jsonb,created_at timestamptz default now());
grant all on public.profiles,public.admin_audit_log to service_role;`);
sql(fs.readFileSync(path.join(root,"supabase/migrations/20261116005911_admin_earn_activity_report.sql"),"utf8"));
let origin = "", rest = "", passed = 0, networkCreated = false, attached = false, restStarted = false, noneDetached = false;
console.log("SETUP synthetic sessions inserted");
const originalFetch = globalThis.fetch;
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 65536) throw new Error("test request too large"); chunks.push(chunk); }
    const body = Buffer.concat(chunks).toString(), headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const url = new URL(incoming.url ?? "/", origin);
    let result: Response;
    if (url.pathname.startsWith("/rest/v1/")) {
      headers.delete("host"); headers.delete("connection");
      result = await fetch(rest + url.pathname.slice("/rest/v1".length) + url.search, { method: incoming.method, headers, ...(body ? { body } : {}) });
    } else {
      const req = new Request(url, { method: incoming.method, headers, ...(body ? { body } : {}) });
      if (url.pathname === "/api/earn/action") result = await earnAction(req);
      else if (url.pathname === "/api/earn/status") result = await earnStatus(req);
      else if (url.pathname === "/api/admin/earn-verifications") result = incoming.method === "POST" ? await adminWrite(req) : await adminRead(req);
      else if (url.pathname === "/api/airdrop/social-claim") result = await socialClaim(req);
      else if (url.pathname === "/api/airdrop/social-edit") result = await socialEdit(req);
      else {
        const operation = url.pathname.split("/").at(-1);
        result = ["link", "unlink", "health", "verification-jobs", "verification-results"].includes(operation ?? "")
          ? await telegramRoute(req, operation as Parameters<typeof telegramRoute>[1]) : new Response(null, { status: 404 });
      }
    }
    outgoing.statusCode = result.status;
    result.headers.forEach((value, key) => { if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(key)) outgoing.setHeader(key, value); });
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch { outgoing.writeHead(500, { "content-type": "application/json" }); outgoing.end('{"error":"local_test_failure"}'); }
});
async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log("PASS " + name); }
try {
  docker("network", "create", "--label", "headstails.purpose=earn-v510-isolated-tests", network); networkCreated = true;
  assert.deepEqual(Object.keys(JSON.parse(docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", container))), ["none"]);
  docker("network", "disconnect", "none", container); noneDetached = true;
  docker("network", "connect", "--alias", "earn-qa-db", network, container); attached = true;
  console.log("SETUP isolated network attached");
  docker("run", "-d", "--rm", "--name", restName, "--label", "headstails.purpose=earn-v510-isolated-tests", "--network", network,
    "-p", "127.0.0.1::3000", "-e", `PGRST_DB_URI=postgresql://postgres@earn-qa-db/${db}`, "-e", "PGRST_DB_SCHEMAS=public",
    "-e", "PGRST_SERVER_PORT=3000", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${signing}`, "public.ecr.aws/supabase/postgrest:v16.2"); restStarted = true;
  console.log("SETUP PostgREST started");
  const binding = docker("port", restName, "3000/tcp"); assert.match(binding, /^127\.0\.0\.1:\d+$/); rest = "http://" + binding;
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object"); origin = `http://127.0.0.1:${address.port}`;
  // Network allowlist: do not contact Solana, Telegram, Discord or production services.
  globalThis.fetch = (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert([origin, rest].includes(target.origin), "External networking is prohibited in offline integration tests");
    return originalFetch(input, init);
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin; process.env.SUPABASE_SERVICE_ROLE_KEY = jwt;
  process.env.HEADSTAILS_WEBSITE_API_KEY = serviceKey; process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
  process.env.EARN_TELEGRAM_ENABLED = "true"; process.env.EARN_TELEGRAM_LINKING_ENABLED = "true"; process.env.EARN_TELEGRAM_JOBS_ENABLED = "true";
  process.env.EARN_TELEGRAM_BOT_USERNAME = "HeadsTailsOfflineBot"; process.env.EARN_TELEGRAM_GROUP_ID = "-1001234567890"; process.env.EARN_TELEGRAM_CHANNEL_ID = "-1001234567891";
  process.env.EARN_NEW_REWARDS_ENABLED = "true"; process.env.EARN_X_MANUAL_VERIFICATION_ENABLED = "true"; process.env.VERCEL_ENV = "preview";
  process.env.AIRDROP_X_CAMPAIGN_URL = "https://x.com/HeadsTailsFun/status/123456"; delete process.env.NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL;
  delete process.env.MAINNET_REAL_VALUE_ENABLED;
  for (let i = 0; i < 30; i++) { try { const ready = await fetch(rest + "/"); if (ready.ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  async function call(route: string, body?: Record<string, unknown>, service = false, reviewer = false, idem?: string) {
    const response = await fetch(origin + route, { method: body ? "POST" : "GET", headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(service ? { Authorization: `Bearer ${serviceKey}`, "X-Request-Id": randomUUID(), ...(idem ? { "Idempotency-Key": idem } : {}) }
        : { cookie: `${SESSION_COOKIE}=${reviewer ? reviewerSession : ownerSession}`, Origin: origin }),
    }, body: body ? JSON.stringify(body) : undefined });
    return { response, data: await response.json() as Record<string, unknown> };
  }
  await check("real HTTP -> session -> PostgREST -> PostgreSQL respects inactive season flags", async () => {
    assert.equal((await call("/api/earn/action", { action: "telegram_token" })).response.status, 503);
    assert.equal(sql("select count(*) from public.earn_link_tokens"), "0");
    sql(`update public.earn_season_settings set telegram_linking=true,telegram_jobs=true,x_manual_enabled=true,new_rewards_enabled=true,quest_flags='{"telegram_group":true,"telegram_channel":true}';`);
  });
  let nonce = "";
  await check("HTTP wallet request issues a digest-only nonce and service linking commits once", async () => {
    const issued = await call("/api/earn/action", { action: "telegram_token", wallet: "attacker" }); assert.equal(issued.response.status, 200);
    nonce = new URL(String(issued.data.deepLink)).searchParams.get("start")!;
    assert.equal(sql("select wallet from public.earn_link_tokens"), "offline-owner");
    assert.equal(sql("select digest from public.earn_link_tokens"), digest(nonce));
    const request_id = randomUUID(), body = { token: nonce, telegram_user_id: 111222333, request_id };
    const linked = await call("/api/telegram/link", body, true, false, request_id);
    assert.equal(linked.data.status, "linked"); assert.equal(linked.data.ok, true); assert.equal(linked.data.wallet, undefined);
    assert.deepEqual((await call("/api/telegram/link", body, true, false, request_id)).data, linked.data);
    assert.equal(sql("select count(*) from public.earn_social_links"), "1");
  });
  let groupResult: Record<string, unknown> = {};
  await check("real leased membership job and result record exactly +20; duplicate ACK cannot duplicate Points", async () => {
    const queued = await call("/api/earn/action", { action: "telegram_group", chat_id: -999 }); assert.equal(queued.data.status, "pending");
    const polled = await call("/api/telegram/verification-jobs?limit=10", undefined, true);
    const jobs = polled.data.jobs as Array<Record<string, unknown>>; assert.equal(jobs.length, 1); assert.equal(jobs[0].chat_id, -1001234567890);
    groupResult = { ...jobs[0], status: "VERIFIED", checked_at: Date.now() / 1000, source: "telegram-getChatMember" };
    const idem = `verification:${jobs[0].job_id}`;
    assert.deepEqual((await call("/api/telegram/verification-results", groupResult, true, false, idem)).data, { ok: true });
    assert.deepEqual((await call("/api/telegram/verification-results", groupResult, true, false, idem)).data, { ok: true });
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "20");
    const status = await call("/api/earn/status"); assert.equal(status.data.wallet, "offline-owner");
    assert((status.data.quests as Array<{ id: string; claim: { status: string } | null }>).some(q => q.id === "telegram_group" && q.claim?.status === "verified"));
  });
  await check("changed result bodies return conflict and keep the committed reward unchanged", async () => {
    const altered = await call("/api/telegram/verification-results", { ...groupResult, status: "ERROR" }, true, false, `verification:${groupResult.job_id}`);
    assert.equal(altered.response.status, 409);
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "20");
  });
  await check("channel result records exactly +5 and both verified claims survive retries with total +25", async () => {
    const queued=await call("/api/earn/action",{action:"telegram_channel"});assert.equal(queued.data.status,"pending");
    sql("update public.earn_rate_windows set opened_at=now()-interval '31 seconds'");
    const polled=await call("/api/telegram/verification-jobs?limit=10",undefined,true);
    const jobs=polled.data.jobs as Array<Record<string,unknown>>;assert.equal(jobs.length,1);
    assert.equal(jobs[0].chat,"channel");assert.equal(jobs[0].chat_id,-1001234567891);
    const body={...jobs[0],status:"VERIFIED",checked_at:Date.now()/1000,source:"telegram-getChatMember"};
    const idem=`verification:${jobs[0].job_id}`;
    for(let i=0;i<3;i++)assert.deepEqual((await call("/api/telegram/verification-results",body,true,false,idem)).data,{ok:true});
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"),"25");
    assert.equal(sql("select count(*) from public.airdrop_points_ledger where wallet='offline-owner' and event_type in ('quest_telegram_group','quest_telegram_channel')"),"2");
    const status=await call("/api/earn/status");assert.equal(status.data.rewardBlockReason,null);
    const quests=status.data.quests as Array<{id:string;claim:{status:string}|null}>;
    for(const id of ["telegram_group","telegram_channel"])assert.equal(quests.find(q=>q.id===id)?.claim?.status,"verified");
  });
  await check("real administrator proof is accepted without credit and status exposes admin ineligibility", async()=>{
    sql("insert into public.earn_social_links(provider,wallet,external_id) values('telegram','offline-reviewer','444555666')");
    const queued=await call("/api/earn/action",{action:"telegram_group"},false,true);assert.equal(queued.data.status,"pending");
    sql("update public.earn_rate_windows set opened_at=now()-interval '31 seconds'");
    const polled=await call("/api/telegram/verification-jobs?limit=10",undefined,true);
    const jobs=polled.data.jobs as Array<Record<string,unknown>>;assert.equal(jobs.length,1);
    const body={...jobs[0],status:"VERIFIED",checked_at:Date.now()/1000,source:"telegram-getChatMember"};
    assert.deepEqual((await call("/api/telegram/verification-results",body,true,false,`verification:${jobs[0].job_id}`)).data,{ok:true});
    const status=await call("/api/earn/status",undefined,false,true);assert.equal(status.data.rewardBlockReason,"admin_account");
    assert.equal(sql("select count(*) from public.airdrop_points_ledger where wallet='offline-reviewer'"),"0");
    const quests=status.data.quests as Array<{id:string;job:{result_status:string}|null;claim:unknown}>;
    const group=quests.find(q=>q.id==="telegram_group")!;assert.equal(group.job?.result_status,"VERIFIED");assert.equal(group.claim,null);
  });
  await check("X challenge -> submitted claim -> authorized audited admin approval uses existing +100 ledger", async () => {
    const challenge = await call("/api/earn/action", { action: "x_challenge", profileUrl: "https://x.com/offlineplayer" });
    assert.equal(challenge.data.status, "created");
    const submitted = await call("/api/earn/action", { action: "x_submit", challengeId: challenge.data.challenge_id }); assert.equal(submitted.data.status, "pending");
    const claimId = sql("select id from public.airdrop_social_claims where wallet='offline-owner' and task_type='connect_x'");
    const review = { claimId, decision: "verified", reason: "OFFLINE fixture bio challenge manually attested", ownershipConfirmed: true };
    assert.equal((await call("/api/admin/earn-verifications", review)).response.status, 403);
    const accepted = await call("/api/admin/earn-verifications", review, false, true); assert.equal(accepted.response.status, 200); assert.equal(accepted.data.status, "verified");
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "125");
    const queue = await call("/api/admin/earn-verifications", undefined, false, true); assert.equal(queue.response.status, 200);
    const rows = queue.data.rows as Array<{ reviews: unknown[] }>; assert.equal(rows[0].reviews.length, 1);
    assert.equal(sql("select x_user_id is null from public.airdrop_x_identities where wallet='offline-owner'"), "t");
  });
  await check("website-owned unlink and bot resynchronization preserve all historical Points", async () => {
    const request_id = randomUUID(); const denied = await call("/api/telegram/unlink", { telegram_user_id: 111222333, request_id }, true, false, request_id);
    assert.equal(denied.data.ok, false);
    assert.equal((await call("/api/earn/action", { action: "unlink", provider: "telegram" })).data.status, "unlinked");
    const fresh = randomUUID(); const synced = await call("/api/telegram/unlink", { telegram_user_id: 111222333, request_id: fresh }, true, false, fresh);
    assert.equal(synced.data.status, "not_linked");
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "125");
  });
  await check("existing reply/repost APIs bind campaign proof atomically and retain +50/+75 manual review rules", async () => {
    const wrong = await call("/api/airdrop/social-claim", { task: "reply", handle: "offlineplayer", evidenceUrl: "https://x.com/another/status/111" });
    assert.equal(wrong.response.status, 409);
    const reply = await call("/api/airdrop/social-claim", { task: "reply", handle: "offlineplayer", evidenceUrl: "https://x.com/offlineplayer/status/111" });
    assert.equal(reply.data.status, "pending-verification");
    const edited = await call("/api/airdrop/social-edit", { task: "reply", handle: "offlineplayer", evidenceUrl: "https://x.com/offlineplayer/status/112" });
    assert.equal(edited.data.status, "pending-verification");
    const repost = await call("/api/airdrop/social-claim", { task: "repost", handle: "offlineplayer", evidenceUrl: "https://x.com/HeadsTailsFun/status/123456" });
    assert.equal(repost.data.status, "pending-verification");
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "125");
    for (const task of ["reply", "repost"]) {
      const claimId = sql("select id from public.airdrop_social_claims where wallet='offline-owner' and task_type=" + literal(task));
      const review = { claimId, decision: "verified", reason: "OFFLINE author and configured post evidence checked" };
      assert.equal((await call("/api/admin/earn-verifications", review, false, true)).response.status, 409);
      assert.equal((await call("/api/admin/earn-verifications", { ...review, evidenceConfirmed: true }, false, true)).response.status, 200);
      await call("/api/admin/earn-verifications", { ...review, evidenceConfirmed: true }, false, true);
    }
    assert.equal(sql("select sum(points) from public.airdrop_points_ledger where wallet='offline-owner' and status='verified'"), "250");
    assert.equal(sql("select count(*) from public.airdrop_social_claims where campaign_url='https://x.com/headstailsfun/status/123456'"), "2");
  });
  fs.writeFileSync(path.join(root, "artifacts/earn-points/http-e2e-summary.json"), JSON.stringify({ passed, failed: 0, transport: "HTTP + PostgREST v16.2", engine: "PostgreSQL 17", database: db, externalNetworking: false, productionModified: false }));
  console.log(JSON.stringify({ passed, failed: 0, externalNetworking: false, productionModified: false }));
} catch (error) {
  const value = error as { stderr?: unknown; message?: unknown };
  const detail = String(value.stderr ?? value.message ?? "local integration failed").replaceAll(signing, "[TEST_KEY]").replaceAll(jwt, "[TEST_JWT]").replaceAll(serviceKey, "[TEST_API_KEY]");
  console.error(detail.slice(0, 1500)); throw new Error("Local HTTP integration failed");
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (restStarted) docker("stop", restName);
  if (attached) docker("network", "disconnect", network, container);
  if (noneDetached) docker("network", "connect", "none", container);
  if (networkCreated) docker("network", "rm", network);
}
}
void main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error : new Error("Offline HTTP integration setup/transport failed"));
  process.exitCode = 1;
});
