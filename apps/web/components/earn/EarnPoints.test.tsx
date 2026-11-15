import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useMemo } from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { Wallet } from "@wallet-standard/base";
import { WalletStandardProvider, useWalletState } from "../wallet/WalletProvider";
import { EarnPointsContent } from "./EarnPointsClient";
import { useRewardResource } from "../../lib/airdrop/useRewardResource";
import { notifySessionCleared } from "../../lib/auth/sessionEvents";

const address = "11111111111111111111111111111111";
const account = { address, publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"] };
const wallet = {
  version: "1.0.0", name: "Fixture Wallet", icon: "data:image/png;base64,", chains: ["solana:devnet"], accounts: [account],
  features: {
    "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
    "standard:disconnect": { version: "1.0.0", disconnect: async () => undefined },
    "solana:signTransaction": { version: "1.0.0", signTransaction: async () => { throw new Error("This UI must never sign a game transaction"); } },
    "solana:signMessage": { version: "1.0.0", signMessage: async () => [{ signature: new Uint8Array(64) }] },
  },
} as unknown as Wallet;
const fixture = {
  wallet: address,
  season: "DEVNET_BETA", verifiedTotal: 222, pendingTotal: 175, verified: { gameplay: 20 },
  today: { gameplay: 20, gameplayCap: 200, referral: 52, referralRecurring: 2, referralRecurringCap: 500 },
  activity: [{ id: "match", eventType: "gameplay_match", category: "gameplay", points: 2, status: "verified", date: "2026-11-14T12:00:00Z" }, { id: "social", eventType: "social_repost", category: "social", points: 75, status: "pending", date: "2026-11-14T11:00:00Z" }],
  campaignUrl: null, socialAvailable: true,
  social: { handle: "degen", handleStatus: "verified", connectStatus: "verified", replyUrl: null, replyStatus: null, repostStatus: null },
};
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.localStorage.clear(); });
function Harness() {
  const state = useWalletState();
  return <><button onClick={() => void state.connect(wallet)}>Connect fixture</button><EarnPointsContent onConnect={() => undefined} onPlay={() => undefined} /></>;
}
function mount() { return render(createElement(WalletStandardProvider, null, createElement(Harness))); }
function installFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (overrides[url]) return overrides[url]();
    if (url === "/api/auth/session") return Response.json({ wallet: address });
    if (url.startsWith("/api/profile")) return Response.json({ profile: null });
    if (url === "/api/airdrop/points") return Response.json(fixture);
    if (url === "/api/referrals/mine") return Response.json({ wallet: address, link: "https://headstails.fun/?ref=REALCODE", totalInvites: 4, qualified: 1, pendingInvites: 3, referralPoints: 52, myReferral: { status: "pending", eligibleGames: 2, gamesNeeded: 1 } });
    throw new Error(`Unexpected request ${url}`);
  };
  return calls;
}

test("disconnected popup content has earning instructions and wallet actions without private reads", async () => {
  const calls = installFetch(); mount();
  assert(screen.getByRole("button", { name: /Connect Wallet|Restoring wallet/ }));
  assert.equal(screen.getAllByRole("tab").length, 3);
  fireEvent.click(screen.getByRole("tab", { name: "QUESTS" }));
  assert.equal(screen.queryByRole("textbox", { name: "X reply URL" }), null);
  fireEvent.click(screen.getByText("X quests", { exact: true }));
  assert(screen.getByText("Connect X account"));
  assert(screen.getByText(/Opening X never awards Points/));
  assert(!calls.some(call => call.includes("/api/airdrop") || call.includes("/api/referrals")));
});

test("connected page separates pending from verified, renders true progress and opens existing referral actions", async () => {
  installFetch(); mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByText("222"); assert(screen.getByText("175"));
  fireEvent.click(screen.getByText("Today's progress", { exact: true }));
  assert.equal(screen.getByRole("progressbar", { name: "Today's Gameplay Points" }).getAttribute("aria-valuenow"), "20");
  assert.equal(screen.getByRole("progressbar", { name: "Today's recurring Referral Points" }).getAttribute("aria-valuenow"), "2");
  fireEvent.click(screen.getByRole("tab", { name: "INVITE" }));
  await screen.findByText("https://headstails.fun/?ref=REALCODE");
  assert(screen.getByRole("button", { name: "Copy Link" }));
  assert(screen.getByText(/2 \/ 3 eligible games/));
  fireEvent.keyDown(screen.getByRole("tab", { name: "INVITE" }), { key: "ArrowRight" });
  assert.equal(screen.getByRole("tab", { name: "QUESTS" }).getAttribute("aria-selected"), "true");
  fireEvent.click(screen.getByText("X quests", { exact: true }));
  await screen.findByText(/Unavailable — no active campaign/);
  assert.equal(screen.queryByRole("button", { name: /Claim Repost/ }), null);
});

test("quest with stored handle submits evidence through existing authenticated API and stays pending", async () => {
  let body: Record<string, string> | null = null;
  const calls = installFetch({
    "/api/auth/challenge": () => Response.json({ challenge: { wallet: address }, message: "Synthetic ownership challenge" }),
    "/api/auth/verify": () => Response.json({ wallet: address }),
    "/api/airdrop/social-claim": () => Response.json({ status: "pending-verification" }),
  });
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input) === "/api/airdrop/social-claim") body = JSON.parse(String(init?.body)); return fetcher(input, init); };
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" })); await screen.findByText("222");
  fireEvent.click(screen.getByRole("tab", { name: "QUESTS" }));
  fireEvent.click(screen.getByText("X quests", { exact: true }));
  const reply = await screen.findByRole("textbox", { name: "X reply URL" });
  fireEvent.change(reply, { target: { value: "https://x.com/degen/status/123" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Reply" }));
  await screen.findByText("Pending verification.");
  assert.deepEqual(body, { task: "reply", handle: "degen", evidenceUrl: "https://x.com/degen/status/123" });
  assert.equal(calls.filter(call => call.includes("social-claim")).length, 1);
  assert(screen.getByText("222"));
});

test("loading, service error/retry and a new user's empty state are honest", async () => {
  let answer: (response: Response) => void = () => undefined;
  let fail = true;
  installFetch({ "/api/airdrop/points": () => fail ? new Promise(resolve => { answer = resolve; }) : Response.json({ ...fixture, activity: [], verifiedTotal: 0, pendingTotal: 0 }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByRole("status", { name: "Loading Points" });
  await waitFor(() => assert.notEqual(answer.toString(), "() => undefined"));
  answer(Response.json({ error: "offline" }, { status: 503 }));
  await screen.findByRole("alert"); assert.equal(screen.queryByText("222"), null);
  fail = false; fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(screen.getByText("Points Activity", { exact: true }));
  await screen.findByText("No Points activity yet");
});

test("a session belonging to another connected wallet cannot show its data", async () => {
  const calls = installFetch({ "/api/auth/session": () => Response.json({ wallet: "another-wallet" }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByRole("button", { name: "Verify wallet" });
  assert(!calls.some(call => call.includes("/api/airdrop/points")));
});

test("a session changed in another tab between the check and API response cannot leak the other wallet's Points", async () => {
  installFetch({ "/api/airdrop/points": () => Response.json({ ...fixture, wallet: "different-owner" }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByRole("alert");
  assert(screen.getByText(/Your wallet session changed/));
  assert.equal(screen.queryByText("222"), null);
});

test("late responses from the previous account never overwrite the new account", async () => {
  let answer: (response: Response) => void = () => undefined;
  let current = "first";
  globalThis.fetch = async input => String(input) === "/api/auth/session" ? Response.json({ wallet: current })
    : current === "first" ? new Promise(resolve => { answer = resolve; }) : Response.json({ total: 8 });
  function Resource({ address }: { address: string }) {
    const selected = useMemo(() => ({ ...account, address }) as never, [address]);
    const resource = useRewardResource<{ total: number }>("/fixture", wallet, selected);
    return <p>{resource.data?.total ?? "empty"}</p>;
  }
  const view = render(<Resource address="first" />);
  await waitFor(() => assert.notEqual(answer.toString(), "() => undefined"));
  current = "second"; view.rerender(<Resource address="second" />);
  await screen.findByText("8"); answer(Response.json({ total: 999 }));
  await waitFor(() => assert.equal(screen.queryByText("999"), null));
});

test("clearing a session during an in-flight Points read stops loading and discards the late response", async () => {
  let answer: (response: Response) => void = () => undefined;
  installFetch({ "/api/airdrop/points": () => new Promise(resolve => { answer = resolve; }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByRole("status", { name: "Loading Points" });
  await waitFor(() => assert.notEqual(answer.toString(), "() => undefined"));
  act(() => notifySessionCleared());
  await screen.findByRole("button", { name: "Verify wallet" });
  await act(async () => { answer(Response.json(fixture)); });
  assert.equal(screen.queryByText("222"), null);
  assert.equal(screen.queryByRole("status", { name: "Loading Points" }), null);
});

test("new manual mode lets rejected repost evidence be corrected without creating a new claim", async () => {
  let body: Record<string, unknown> | null = null;
  installFetch({
    "/api/airdrop/points": () => Response.json({ ...fixture, manualOwnershipRequired: true, campaignUrl: "https://x.com/HeadsTailsFun/status/10", social: { ...fixture.social, repostStatus: "rejected", repostUrl: "https://x.com/degen/status/11" } }),
    "/api/earn/catalog": () => Response.json({}),
    "/api/earn/status": () => Response.json({ wallet: address, connections: { telegram: false, discord: false, x: true, xHandle: "degen" }, capabilities: { xManual: true }, quests: [], gameplayDays: 0, xChallenge: null }),
    "/api/auth/challenge": () => Response.json({ challenge: { wallet: address }, message: "Synthetic ownership challenge" }),
    "/api/auth/verify": () => Response.json({ wallet: address }),
    "/api/airdrop/social-edit": () => Response.json({ status: "pending-verification" }),
  });
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (input, init) => { if (String(input) === "/api/airdrop/social-edit") body = JSON.parse(String(init?.body)); return fetcher(input, init); };
  mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" })); await screen.findByText("222");
  fireEvent.click(screen.getByRole("tab", { name: "QUESTS" }));
  fireEvent.click(screen.getByText("X quests", { exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit repost evidence" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Updated X repost evidence URL" }), { target: { value: "https://x.com/degen/status/12" } });
  fireEvent.click(screen.getByRole("button", { name: "Save repost evidence" }));
  await screen.findByText("Updated — back to pending review.");
  assert.deepEqual(body, { task: "repost", handle: "degen", evidenceUrl: "https://x.com/degen/status/12" });
});

test("compact rules disclosure preserves all 12 approved rewards and their eligibility conditions", () => {
  installFetch(); mount();
  const disclosure = screen.getByText("Points table & important rules", { exact: true }).closest("details")!;
  assert.equal(disclosure.open, false);
  fireEvent.click(screen.getByText("Points table & important rules", { exact: true }));
  const table = screen.getByRole("table", { name: "Complete Points rewards" });
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.map(row => row.lastElementChild?.textContent), ["+5", "+2", "+50", "+25", "+2", "+100", "+75", "+50", "+20", "+5", "+15", "+20"]);
  const rules = table.closest("details")!.textContent!;
  for (const text of ["200 Points per wallet per UTC day", "00:00 UTC", "3 eligible settled matches", "From match 4 onward", "25 recurring match rewards", "500 recurring Points", "60 Points total", "do not require gameplay", "Days need not be consecutive", "No quiz or tutorial quest"]) assert(rules.includes(text), text);
});
