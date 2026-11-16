import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { Wallet } from "@wallet-standard/base";
import { WalletStandardProvider, useWalletState } from "../wallet/WalletProvider";
import { VerificationQuests, XOwnershipForm, type VerificationState } from "./VerificationQuests";
import { EarnVerificationQueue } from "../admin/EarnVerificationQueue";

const address = "11111111111111111111111111111111";
const account = { address, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signMessage", "solana:signTransaction"] };
const wallet = { version: "1.0.0", name: "Fixture Wallet", icon: "data:image/png;base64,", chains: ["solana:devnet"], accounts: [account],
  features: { "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
    "standard:disconnect": { version: "1.0.0", disconnect: async () => undefined },
    "solana:signMessage": { version: "1.0.0", signMessage: async () => { throw new Error("Read-only UI tests must never request a signature"); } },
    "solana:signTransaction": { version: "1.0.0", signTransaction: async () => { throw new Error("Earn Points must never sign a game transaction"); } } } } as unknown as Wallet;
const fixture: VerificationState = {
  wallet: address, connections: { telegram: true, discord: false, x: false, xHandle: null },
  capabilities: { telegramLink: true, telegramJobs: true, discord: true, xManual: true },
  quests: ["telegram_group", "telegram_channel", "discord_member", "three_days"].map(id => ({ id, active: true, claim: null, job: null })) as VerificationState["quests"],
  gameplayDays: 2, discordMembership: null, xChallenge: null,
};
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.localStorage.clear(); window.history.replaceState(null, "", "/"); });
function fetchFixture(current: () => VerificationState = () => fixture, mutate?: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url === "/api/auth/session") return Response.json({ wallet: address });
    if (url.startsWith("/api/profile")) return Response.json({ profile: null });
    if (url === "/api/earn/catalog") return Response.json({ rewardsEnabled: true, groupUrl: "https://t.me/fixturegroup", channelUrl: "https://t.me/fixturechannel", discordJoinUrl: "https://discord.gg/fixture" });
    if (url === "/api/earn/status") return Response.json(current());
    if (url === "/api/earn/action" && mutate) return mutate(JSON.parse(String(init?.body)));
    throw new Error(`Unexpected request ${url}`);
  };
  return calls;
}
function mount(x = false, changed = () => undefined) {
  function Harness() {
    const state = useWalletState();
    return <><button onClick={() => void state.connect(wallet)}>Connect fixture</button>{x ? <XOwnershipForm onChanged={changed} /> : <VerificationQuests onConnect={() => undefined} onChanged={changed} />}</>;
  }
  render(<WalletStandardProvider><Harness /></WalletStandardProvider>);
}
async function connect() { fireEvent.click(screen.getByRole("button", { name: "Connect fixture" })); await screen.findByRole("button", { name: "Refresh status ↻" }); }
function openQuest(name: string) {
  fireEvent.click(within(screen.getByRole("region", { name })).getByText(name, { exact: true }));
}
test("public quest cards preserve all four approved values and never request private data while disconnected", async () => {
  const calls = fetchFixture(); mount();
  await screen.findByText("Community & gameplay quests");
  assert.equal(screen.getAllByText("+20 Points").length, 2);
  for (const [name, points] of [["Join Telegram Group", 20], ["Join Announcement Channel", 5], ["Join Discord Server", 15], ["Play on Three Different Days", 20]] as const) {
    assert(within(screen.getByRole("region", { name })).getByText(`+${points} Points`));
  }
  assert(!calls.includes("/api/earn/status"));
  assert.equal(screen.queryByRole("button", { name: "Verify Membership" }), null);
  openQuest("Play on Three Different Days"); assert(screen.getByText("Connect to view progress"));
});
test("owner-scoped state displays real gameplay progress and suppresses completed submissions", async () => {
  fetchFixture(() => ({ ...fixture, quests: fixture.quests.map(q => q.id === "telegram_group" ? { ...q, claim: { status: "verified" } } : q) }));
  mount(); await connect(); await screen.findByText("2/3 days");
  const card = within(screen.getByRole("region", { name: "Join Telegram Group" }));
  openQuest("Join Telegram Group");
  assert(card.getByText("Completed")); assert.equal(card.queryByRole("button", { name: "Verify Membership" }), null);
  openQuest("Play on Three Different Days");
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "2");
});
test("pending job remains pending, disables repeated submissions and never appears completed", async () => {
  fetchFixture(() => ({ ...fixture, quests: fixture.quests.map(q => q.id === "telegram_group" ? { ...q, job: { result_status: null, completed_at: null, expires_at: new Date(Date.now() + 600000).toISOString() } } : q) }));
  mount(); await connect(); await screen.findByText("2/3 days");
  const card = within(screen.getByRole("region", { name: "Join Telegram Group" }));
  openQuest("Join Telegram Group");
  assert(card.getByText("Pending Verification")); assert((card.getByRole("button", { name: "Verify Membership" }) as HTMLButtonElement).disabled);
  assert.equal(card.queryByText("Completed"), null);
});

test("administrator membership is visibly verified with an explicit no-reward reason and no repeat Verify button", async () => {
  fetchFixture(() => ({ ...fixture, newRewardsEnabled: true, rewardBlockReason: "admin_account", quests: fixture.quests.map(q => q.id === "telegram_group" ? { ...q, job: {result_status:"VERIFIED",completed_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()} } : q) }));
  mount(); await connect(); await screen.findByText(/^Administrator wallets are not eligible/);
  openQuest("Join Telegram Group");
  const card = within(screen.getByRole("region", { name: "Join Telegram Group" }));
  assert(card.getByText("Membership verified")); assert(card.getByText(/Membership confirmed by the official bot/));
  assert.equal(card.queryByText("Completed"),null); assert.equal(card.queryByRole("button",{name:"Verify Membership"}),null);
});

test("membership failures and expiration explain the actual outcome and offer a retry", async () => {
  let result = "UNAVAILABLE", completed: string | null = new Date().toISOString();
  fetchFixture(() => ({ ...fixture, newRewardsEnabled:true, quests:fixture.quests.map(q => q.id === "telegram_group" ? {...q,job:{result_status:result,completed_at:completed,expires_at:new Date(Date.now()-60000).toISOString()}} :q) }));
  mount(); await connect(); await screen.findByText("Verification unavailable"); openQuest("Join Telegram Group");
  const card=within(screen.getByRole("region",{name:"Join Telegram Group"}));
  assert(card.getByText(/bot could not check membership/)); assert(!(card.getByRole("button",{name:"Verify Membership"}) as HTMLButtonElement).disabled);
  result="NOT_MEMBER";fireEvent.click(screen.getByRole("button",{name:"Refresh status ↻"}));await screen.findByText("Membership not found");
  assert(card.getByText(/linked Telegram account/));
  completed=null;fireEvent.click(screen.getByRole("button",{name:"Refresh status ↻"}));await screen.findByText("Verification expired");
  assert(card.getByText(/did not return a result before this request expired/));
});

test("an eligible verified job without a ledger claim reports missing reward instead of returning silently to Available", async () => {
  fetchFixture(() => ({ ...fixture,newRewardsEnabled:true,quests:fixture.quests.map(q=>q.id==="telegram_group"?{...q,job:{result_status:"VERIFIED",completed_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString()}}:q)}));
  mount();await connect();await screen.findByText("Reward not recorded");openQuest("Join Telegram Group");
  assert(screen.getByText(/Points record is missing/));
});

test("a membership result arriving after pending refresh updates Completed and refreshes Points", async () => {
  let claimed=false,changes=0;
  fetchFixture(()=>({...fixture,quests:fixture.quests.map(q=>q.id==="telegram_group"?{...q,claim:claimed?{status:"verified"}:null,job:{result_status:claimed?"VERIFIED":null,completed_at:claimed?new Date().toISOString():null,expires_at:new Date(Date.now()+600000).toISOString()}}:q)}));
  mount(false,()=>{changes++;});await connect();await screen.findByText("Pending Verification");
  claimed=true;fireEvent.click(screen.getByRole("button",{name:"Refresh status ↻"}));await screen.findByText("Completed");
  await waitFor(()=>assert.equal(changes,1));
});
test("Telegram verification creates one pending request and refreshes owner data without changing earned status", async () => {
  let submissions = 0, pending = false;
  fetchFixture(() => ({ ...fixture, quests: fixture.quests.map(q => q.id === "telegram_group" && pending ? { ...q, job: { result_status: null, completed_at: null, expires_at: new Date(Date.now() + 600000).toISOString() } } : q) }), async body => {
    assert.deepEqual(body, { action: "telegram_group" }); submissions++; pending = true; return Response.json({ wallet: address, status: "pending" });
  });
  mount(); await connect(); await screen.findByText("2/3 days");
  openQuest("Join Telegram Group");
  fireEvent.click(within(screen.getByRole("region", { name: "Join Telegram Group" })).getByRole("button", { name: "Verify Membership" }));
  await screen.findByText("Pending Verification"); assert.equal(submissions, 1); assert.equal(screen.queryByText("Completed"), null);
});
test("newly disabled rewards show unavailable and preserve historical completed claims", async () => {
  fetchFixture(() => ({ ...fixture, quests: fixture.quests.map(q => ({ ...q, active: false, claim: q.id === "telegram_channel" ? { status: "verified" } : null })) }));
  mount(); await connect(); await screen.findByText("2/3 days");
  assert(within(screen.getByRole("region", { name: "Join Announcement Channel" })).getByText("Completed"));
  const group = within(screen.getByRole("region", { name: "Join Telegram Group" }));
  openQuest("Join Telegram Group");
  assert(group.getByText("Unavailable")); assert((group.getByRole("button", { name: "Verify Membership" }) as HTMLButtonElement).disabled);
});

test("a release with integrations off shows inactive quests when verification storage is unavailable, without invented progress", async () => {
  fetchFixture();
  const fixtureFetch = globalThis.fetch; let statusRead = false;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/earn/catalog") return Response.json({ rewardsEnabled: false, telegramEnabled: false, discordEnabled: false, xManualEnabled: false });
    if (String(input) === "/api/earn/status") { statusRead = true; return Response.json({ error: "verification_not_installed" }, { status: 503 }); }
    return fixtureFetch(input, init);
  };
  mount(); await connect();
  await waitFor(() => { assert(statusRead); assert.equal((screen.getByRole("button", { name: "Refresh status ↻" }) as HTMLButtonElement).disabled, false); });
  openQuest("Play on Three Different Days");
  assert(screen.getByText("Progress unavailable"));
  assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), null);
  assert.equal(!!screen.queryByRole("alert"), false);
  assert(screen.getByText(/New quest rewards are inactive/));
});
test("a swapped session response cannot disclose another wallet's social connections or challenge", async () => {
  fetchFixture(() => ({ ...fixture, wallet: "other-owner", gameplayDays: 3 }));
  mount(); await connect(); await screen.findByRole("alert");
  assert(screen.getByText(/Your wallet session changed/)); assert.equal(screen.queryByText("3/3 days"), null);
});
test("Discord return notice explains pending membership and removes the consumed notice parameter", async () => {
  window.history.replaceState(null, "", "/?earn_notice=discord_not_member&ref=KEEPME");
  fetchFixture(); mount(); await screen.findByText(/server membership was not found/);
  assert.equal(new URL(window.location.href).searchParams.get("earn_notice"), null);
  assert.equal(new URL(window.location.href).searchParams.get("ref"), "KEEPME");
});
test("X bio ownership challenge must be submitted and stays under review without a completed reward", async () => {
  let submitted = false;
  const challenge = { id: "12345678-1234-4234-8234-123456789abc", code: "HTS-SYNTHETIC-PUBLIC-BIO", profile_url: "https://x.com/fixture", expires_at: new Date(Date.now() + 600000).toISOString(), status: "available", review_reason: null };
  fetchFixture(() => ({ ...fixture, xChallenge: { ...challenge, status: submitted ? "submitted" : "available" } }), async body => {
    assert.deepEqual(body, { action: "x_submit", challengeId: challenge.id }); submitted = true; return Response.json({ wallet: address, status: "pending" });
  });
  mount(true); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" })); await screen.findByText(challenge.code);
  fireEvent.click(screen.getByRole("button", { name: "Submit X Profile for review" }));
  await waitFor(() => assert((screen.getByRole("button", { name: "Submit X Profile for review" }) as HTMLButtonElement).disabled));
  assert.equal(screen.queryByText(/Manually verified/), null);
});
test("review interface requires a reason and evidence confirmation before approval and uses existing admin API", async () => {
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") { body = JSON.parse(String(init.body)); return Response.json({ status: "verified" }); }
    return Response.json({ active: true, rows: [{ id: "claim-1", wallet: "fixture-owner", task_type: "connect_x", x_handle: "fixture", x_profile_url: "https://x.com/fixture",
      evidence_url: null, campaign_url: null, reviewState: "pending", created_at: "2026-11-15", review_note: null,
      challenge: { code: "HTS-PUBLIC-BIO", expires_at: "2026-11-16", status: "submitted" }, rewards: [], history: [], reviews: [] }] });
  };
  render(<EarnVerificationQueue canReview />);
  fireEvent.click(await screen.findByRole("button", { name: /Review X account ownership/ }));
  const approve = await screen.findByRole("button", { name: "Approve" });
  assert((approve as HTMLButtonElement).disabled);
  fireEvent.change(screen.getByRole("textbox", { name: "Verification review reason" }), { target: { value: "Bio code matched during manual review" } });
  assert((approve as HTMLButtonElement).disabled);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(approve); await waitFor(() => assert(body));
  assert.deepEqual(body, { claimId: "claim-1", decision: "verified", reason: "Bio code matched during manual review", ownershipConfirmed: true, evidenceConfirmed: false });
});
