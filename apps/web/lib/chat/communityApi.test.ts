import { test, after } from "node:test";
import assert from "node:assert/strict";
// Import the real handlers after this fixture establishes its synthetic env.
const send = async (req: Request) =>
  (await import("@/app/api/chat/send/route")).POST(req);
const team = async (req: Request) =>
  (await import("@/app/api/profile/team/route")).POST(req);
const getTeam = async (req: Request) =>
  (await import("@/app/api/profile/team/route")).GET(req);
const reaction = async (req: Request) =>
  (await import("@/app/api/profile/reaction/route")).GET(req);
import { SESSION_COOKIE } from "@/lib/auth/message";
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
const wallet = "B3fHiXJANX8EVn9gLXHcrfQski1FAWCcrqyEKeb4thiq";
const clientId = "00000000-0000-4000-8000-000000000001";
const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let rpcResult: unknown = {
  status: "sent",
  message: { id: "fixture", body: "hi" },
};
let profileResult: unknown = {
  team_preference: null,
  team_prompt_completed: false,
};
process.env.SOLANA_SERVER_RPC_URL = "https://synthetic-rpc.invalid/";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "SYNTHETIC_TEST_KEY_NO_SERVICE_ACCESS";
process.env.HEADS_TAILS_PROGRAM_ID =
  "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
process.env.NEXT_PUBLIC_HTS_TOKEN_MINT =
  "DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy";
globalThis.fetch = async (input, init) => {
  const req =
    input instanceof Request ? input : new Request(String(input), init);
  const path = new URL(req.url).pathname;
  const body = req.method === "POST" ? await req.json() : {};
  calls.push({ path, body });
  if (new URL(req.url).hostname === "synthetic-rpc.invalid")
    return Response.json({ jsonrpc: "2.0", id: body.id, result: 12345 });
  if (path.endsWith("auth_sessions"))
    return Response.json({ wallet, expires_at: "2099-01-01T00:00:00Z" });
  if (path.endsWith("profiles")) return Response.json(profileResult);
  if (path.includes("/rpc/")) return Response.json(rpcResult);
  throw Error("Unexpected synthetic API request: " + path);
};
function request(path: string, body?: unknown, authed = true) {
  return new Request("https://local.invalid" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(authed
        ? { cookie: `${SESSION_COOKIE}=${"0".repeat(64)}` }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("unauthenticated send cannot reach the atomic write RPC", async () => {
  calls.length = 0;
  const r = await send(
    request("/api/chat/send", { body: "hi", clientId }, false),
  );
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});
test("server binds ownership, masks only explicit words, and passes retry identity", async () => {
  rpcResult = {
    status: "sent",
    message: { id: "fixture", body: "GG ***" },
    cooldownMs: 3000,
  };
  const r = await send(
    request("/api/chat/send", {
      body: "GG shit",
      clientId,
      wallet: "IMPERSONATED",
    }),
  );
  assert.equal(r.status, 200);
  const call = calls.findLast((x) =>
    x.path.endsWith("send_chat_message_atomic"),
  )!;
  assert.equal(call.body.p_wallet, wallet);
  assert.equal(call.body.p_body, "GG ***");
  assert.equal(call.body.p_client_id, clientId);
});
test("cooldown and moderation results retain server status and Retry-After", async () => {
  rpcResult = { status: "cooldown", retryAfterMs: 2345 };
  const r = await send(request("/api/chat/send", { body: "hi", clientId }));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "3");
  assert.equal((await r.json()).retryAfterMs, 2345);
  rpcResult = { status: "restricted" };
  assert.equal(
    (await send(request("/api/chat/send", { body: "hi", clientId }))).status,
    403,
  );
});
test("invalid retry identity fails without a write RPC", async () => {
  calls.length = 0;
  assert.equal(
    (await send(request("/api/chat/send", { body: "hi", clientId: "invalid" })))
      .status,
    400,
  );
  assert(!calls.some((x) => x.path.includes("/rpc/")));
});
test("team writes use authenticated wallet and only preference fields", async () => {
  assert.equal(
    (await team(request("/api/profile/team", { team: "TAILS" }, false))).status,
    401,
  );
  assert.equal(
    (
      await team(
        request("/api/profile/team", { team: null, wallet: "IMPERSONATED" }),
      )
    ).status,
    403,
  );
  rpcResult = true;
  const r = await team(
    request("/api/profile/team", { team: null, wallet, username: "replace", p_after_slot: 1 }),
  );
  assert.equal(r.status, 200);
  const body = calls.findLast((x) => x.path.endsWith("save_devnet_community_team"))!.body;
  assert.deepEqual(body, { p_wallet: wallet, p_team: null, p_after_slot: 12345 });
  profileResult = { team_preference: null, team_prompt_completed: true };
  const response = await getTeam(request("/api/profile/team"));
  assert.deepEqual(await response.json(), { team: null, completed: true });
});
test("reaction lookup requires ownership and binds current HTS generation", async () => {
  assert.equal(
    (
      await reaction(
        request("/api/profile/reaction?match=61", undefined, false),
      )
    ).status,
    401,
  );
  rpcResult = { side: "TAILS", win: true, ordinal: 2 };
  const response = await reaction(
    request("/api/profile/reaction?match=61&wallet=IMPERSONATED"),
  );
  assert.equal(response.status, 200);
  const call = calls.findLast((x) => x.path.endsWith("hts_result_reaction"))!;
  assert.equal(call.body.p_wallet, wallet);
  assert.equal(call.body.p_match, "61");
  assert.equal(call.body.p_mint, process.env.NEXT_PUBLIC_HTS_TOKEN_MINT);
  assert.equal(
    call.body.p_program,
    "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k",
  );
});
