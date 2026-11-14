import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useMemo } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Wallet } from "@wallet-standard/base";
import { WalletStandardProvider, useWalletState } from "../wallet/WalletProvider";
import { EarnPointsContent } from "./EarnPointsClient";
import { useRewardResource } from "../../lib/airdrop/useRewardResource";

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
  assert(screen.getByText("Connect X account"));
  assert(screen.getByText(/Opening X never awards Points/));
  assert(!calls.some(call => call.includes("/api/airdrop") || call.includes("/api/referrals")));
});

test("connected page separates pending from verified, renders true progress and opens existing referral actions", async () => {
  installFetch(); mount(); fireEvent.click(screen.getByRole("button", { name: "Connect fixture" }));
  await screen.findByText("222"); assert(screen.getByText("175"));
  assert.equal(screen.getByRole("progressbar", { name: "Today's Gameplay Points" }).getAttribute("aria-valuenow"), "20");
  assert.equal(screen.getByRole("progressbar", { name: "Today's recurring Referral Points" }).getAttribute("aria-valuenow"), "2");
  fireEvent.click(screen.getByRole("tab", { name: "INVITE" }));
  await screen.findByText("https://headstails.fun/?ref=REALCODE");
  assert(screen.getByRole("button", { name: "Copy Link" }));
  assert(screen.getByText(/2 \/ 3 eligible games/));
  fireEvent.keyDown(screen.getByRole("tab", { name: "INVITE" }), { key: "ArrowRight" });
  assert.equal(screen.getByRole("tab", { name: "QUESTS" }).getAttribute("aria-selected"), "true");
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
