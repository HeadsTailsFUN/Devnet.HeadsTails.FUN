/**
 * REAL video-scenario regression test (BUG.mp4 frames: select at ~3s,
 * unexpected Ready at ~4s, reselect at ~5s, reset again at ~6s).
 *
 * Renders the actual <LiveGameClient/> in jsdom against a stub Devnet RPC
 * with controllable room-probe behavior, drives the real connect/pick UI,
 * and asserts the selection + Confirm survive background refreshes.
 *
 * Phase A (rooms unconfirmed — the video condition): the room probe fails,
 * so the room gate cannot confirm liveness. Pre-fix, the first refresh
 * after the pick writes "ready" and clears the selection (~1s, matching the
 * video). Post-fix, HEADS then TAILS persist with Confirm visible.
 *
 * Phase B (rooms go live): the probe starts succeeding; the selection must
 * STILL hold and the $1 card must show OPEN.
 *
 * Requires: node --import tsx --import ./lib/test/jsdom-setup.ts
 * (sets the stub RPC URL + browser env before app modules evaluate).
 */
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import { referenceQuote } from "@heads-or-tails/game-sdk";
import { roomQueuePda } from "@/lib/solana/queueSnapshot";
import { matchPda as activeMatchPda } from "@/lib/solana/activeGame";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("/api/auth/session"))
    return Response.json({ wallet: FAKE_WALLET });
  if (String(input).startsWith("/api/profile/team"))
    return Response.json({ team: null, completed: true });
  if (String(input) === "/api/devnet/usd-quote") {
    return Response.json(
      referenceQuote(process.env.NEXT_PUBLIC_HTS_TOKEN_MINT!, Date.now()),
      { headers: { Date: new Date().toUTCString() } },
    );
  }
  return originalFetch(input, init);
};

const PROGRAM = "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
const FAKE_WALLET = "B3fHiXJANX8EVn9gLXHcrfQski1FAWCcrqyEKeb4thiq";

function disc(name: string): string {
  return createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8)
    .toString("hex");
}

function b64Config(): string {
  const b = Buffer.alloc(117);
  Buffer.from(disc("GameConfig"), "hex").copy(b, 0);
  new PublicKey("5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW")
    .toBuffer()
    .copy(b, 8);
  new PublicKey(process.env.NEXT_PUBLIC_HTS_TOKEN_MINT!).toBuffer().copy(b, 40);
  b[72] = 0;
  b[73] = 1;
  return b.toString("base64");
}

function b64Room(tier: number, queued = false): string {
  const b = Buffer.alloc(43);
  Buffer.from(disc("RoomState"), "hex").copy(b, 0);
  b[8] = tier;
  b[9] = 1;
  if(queued && tier===1)b.writeBigUInt64LE(BigInt(1),18);
  return b.toString("base64");
}

function acctInfo(dataB64: string | null, lamports = 1000000) {
  return {
    context: { slot: 1 },
    value: dataB64
      ? {
          data: [dataB64, "base64"],
          executable: false,
          lamports,
          owner: PROGRAM,
          rentEpoch: 0,
        }
      : null,
  };
}

function idlePlayerState(): string {
  // Exact 62-byte V2 IDLE PlayerState (queued=false, in_match=false), as
  // left behind after a settled match + Play Again.
  const b = Buffer.alloc(62);
  createHash("sha256")
    .update("account:PlayerState")
    .digest()
    .subarray(0, 8)
    .copy(b, 0);
  new PublicKey("B3fHiXJANX8EVn9gLXHcrfQski1FAWCcrqyEKeb4thiq")
    .toBuffer()
    .copy(b, 8);
  b[40] = 0;
  b[41] = 0;
  b[60] = 0;
  b[61] = 0;
  b[59] = 255;
  return b.toString("base64");
}

describe("video scenario: selection survives background refresh", () => {
  let server: Server;
  // "fail" reproduces the video condition (rooms unconfirmed);
  // "live" lets the probe succeed afterwards.
  let roomMode: "fail" | "live" = "fail";
  let failConfigOnce = false;
  // When true, the player account reads as an existing IDLE PlayerState
  // (the post-game shape) instead of missing.
  let idlePlayer = false;
  let queuedPlayer = false;
  let inMatchPlayer = false;
  let matchReads = 0;
  let signingRequests = 0;
  let submittedTransactions = 0;
  // When true, the next config read is delayed past the user pick (stale
  // refresh / config-subscription race).
  let slowConfigOnce = false;

  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("hts-config")],
    new PublicKey(PROGRAM),
  )[0].toBase58();
  const playerPda = PublicKey.findProgramAddressSync(
    [Buffer.from("hts-player"), new PublicKey(FAKE_WALLET).toBuffer()],
    new PublicKey(PROGRAM),
  )[0].toBase58();
  const fixtureMatchPda=activeMatchPda(new PublicKey(PROGRAM),BigInt(42))[0].toBase58();
  const roomPda = (t: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("hts-room"), Buffer.from([t])],
      new PublicKey(PROGRAM),
    )[0].toBase58();

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        void (async () => {
          const send = (payload: unknown) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(payload));
          };
          if (req.url?.startsWith("/api/")) {
            if (req.url.startsWith("/api/auth/session"))
              return send({ wallet: FAKE_WALLET });
            if (req.url.startsWith("/api/profile/team"))
              return send({ team: null, completed: true });
            if (req.url.startsWith("/api/profile"))
              return send({ profile: null });
            if (req.url.startsWith("/api/site-settings"))
              return send({ settings: {} });
            if (req.url.startsWith("/api/chat/messages"))
              return send({ messages: [] });
            if (req.url.startsWith("/api/leaderboard"))
              return send({ rows: [] });
            return send({});
          }
          const rpc = JSON.parse(body);
          const { id, method, params } = rpc;
          const reply = (result: unknown) =>
            send({ jsonrpc: "2.0", id, result });
          const rpcError = () => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32000, message: "flaky" },
              }),
            );
          };
          if(method==="sendTransaction"){submittedTransactions++;return rpcError();}
          if (method === "getAccountInfo") {
            const addr = params[0] as string;
            if (
              addr === configPda ||
              addr ===
                PublicKey.findProgramAddressSync(
                  [Buffer.from("config")],
                  new PublicKey(PROGRAM),
                )[0].toBase58()
            ) {
              if (failConfigOnce) {
                failConfigOnce = false;
                return rpcError();
              }
              if (slowConfigOnce) {
                slowConfigOnce = false;
                await new Promise((r) => setTimeout(r, 1500));
              }
              return reply(acctInfo(b64Config(), 2036414520));
            }
            if ((idlePlayer || queuedPlayer || inMatchPlayer) && addr === playerPda) {
              const data=Buffer.from(idlePlayerState(),"base64");
              if(queuedPlayer){data[40]=1;data[42]=0;data[60]=1;data[61]=1;}
              if(inMatchPlayer){data[40]=0;data[50]=1;data.writeBigUInt64LE(BigInt(42),51);data[61]=1;}
              return reply(acctInfo(data.toString("base64"), 5000000));
            }
            if(addr===fixtureMatchPda){
              // Synthetic settled match. The next PlayerState read is idle,
              // reproducing settlement winning the race with presentation.
              const b=Buffer.alloc(191);Buffer.from(disc("Match"),"hex").copy(b);
              b.writeBigUInt64LE(BigInt(42),8);new PublicKey(FAKE_WALLET).toBuffer().copy(b,16);
              new PublicKey("11111111111111111111111111111111").toBuffer().copy(b,48);
              b.writeBigUInt64LE(BigInt(100000000),80);b.writeBigUInt64LE(BigInt(100000000),88);b.writeBigUInt64LE(BigInt(200000000),96);
              b[104]=1;b.writeBigUInt64LE(BigInt(1),105);b[113]=1;b[146]=1;b[147]=0;b[148]=1;
              new PublicKey(FAKE_WALLET).toBuffer().copy(b,149);b[181]=1;b.writeBigUInt64LE(BigInt(2),182);b[190]=255;
              matchReads++;inMatchPlayer=false;idlePlayer=true;return reply(acctInfo(b.toString("base64")));
            }
            if (addr === roomPda(1) || addr === roomPda(10)) {
              if (roomMode === "fail") return rpcError();
              const tier = addr === roomPda(1) ? 1 : 10;
              return reply(acctInfo(b64Room(tier,queuedPlayer)));
            }
            return reply(acctInfo(null));
          }
          if (method === "getBalance")
            return reply({ context: { slot: 1 }, value: 10000000 });
          if (method === "getTokenAccountBalance")
            return reply({
              context: { slot: 1 },
              value: {
                amount: "200000000",
                decimals: 6,
                uiAmount: 200,
                uiAmountString: "200",
              },
            });
          if (method === "getLatestBlockhash")
            return reply({
              context: { slot: 1 },
              value: {
                blockhash: "11111111111111111111111111111111",
                lastValidBlockHeight: 1,
              },
            });
          if (
            method === "getMultipleAccountsInfo" ||
            method === "getMultipleAccounts"
          )
            return reply({ context: { slot: 1 }, value: (params[0] as string[]).map(addr=>{
              if(!queuedPlayer||addr!==roomQueuePda(new PublicKey(PROGRAM),1,0,BigInt(0)).toBase58())return null;
              const data=Buffer.alloc(67);Buffer.from(disc("QueueEntry"),"hex").copy(data);new PublicKey(FAKE_WALLET).toBuffer().copy(data,8);data.writeBigUInt64LE(BigInt(100000000),49);
              return acctInfo(data.toString("base64")).value;
            }) });
          return reply({ context: { slot: 1 }, value: null });
        })();
      });
    });
    server.on("error", () => undefined);
    server.listen(18789, "127.0.0.1");
    await once(server, "listening");
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    cleanup();
    try {
      (
        server as unknown as { closeAllConnections?: () => void }
      ).closeAllConnections?.();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function registerFakeWallet() {
    const account = {
      address: FAKE_WALLET,
      chains: ["solana:devnet"],
      features: ["solana:signTransaction"],
      publicKey: new Uint8Array(32).fill(7),
    };
    const wallet = {
      version: "1.0.0",
      name: "TestWallet",
      icon: "",
      chains: ["solana:devnet"],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "solana:signTransaction": { version:"1.0.0",supportedTransactionVersions:["legacy"],signTransaction:async()=>{signingRequests++;throw Error("No transaction signing permitted in this fixture");} },
      },
      accounts: [account],
    } as unknown as import("@wallet-standard/base").Wallet;
    return getWallets().register(wallet);
  }

  it(
    "HEADS then TAILS survive failing probes; selection holds when rooms go live",
    { timeout: 150000 },
    async () => {
      const { LiveGameClient } = await import("./LiveGameClient.js");
      const { WalletStandardProvider } = await import(
        "../wallet/WalletProvider.js"
      );
      const React = await import("react");
      const view = render(
        React.createElement(
          WalletStandardProvider,
          null,
          React.createElement(LiveGameClient, null),
        ),
      );
      registerFakeWallet();

      // Connect through the real modal flow (scoped to the header wallet
      // button: disconnected $1/$10 room cards render the same copy).
      const connectBtn = await within(screen.getByRole("banner")).findByRole(
        "button",
        { name: "Connect Wallet" },
        { timeout: 15000 },
      );
      fireEvent.click(connectBtn);
      const walletRow = await screen.findByText(
        "TestWallet",
        {},
        { timeout: 10000 },
      );
      fireEvent.click(walletRow);

      // All game assertions are scoped to the real game regions: the dev-only
      // state switcher renders the same words ("Pick a side", "You Selected HEADS") and
      // must never satisfy these queries.
      const statusRegion = () =>
        screen.getByRole("region", { name: "Game status" });
      const heroRegion = () =>
        screen.getByRole("region", { name: "Flip game" });

      // Game settles (room gate fails closed while rooms unconfirmed).
      await screen.findByText(
        "Pick your side to play",
        {},
        { timeout: 15000 },
      );
      await within(statusRegion()).findByText(
        "Pick a side",
        {},
        { timeout: 15000 },
      );

      // Phase A (~3s video equivalent): pick HEADS, Confirm must appear.
      fireEvent.click(within(heroRegion()).getByText("HEADS", { exact: true }));
      assert.ok(
        await within(statusRegion()).findByText(
          "You Selected HEADS",
          {},
          { timeout: 5000 },
        ),
      );
      assert.ok(
        await within(statusRegion()).findByText(
          "Confirm",
          {},
          { timeout: 5000 },
        ),
      );

      // ~4s video equivalent: past the observed reset window — must STILL hold
      // despite refreshes running against unconfirmed rooms.
      await new Promise((r) => setTimeout(r, 2500));
      assert.ok(
        within(statusRegion()).queryByText("You Selected HEADS"),
        "HEADS selection lost after background refresh",
      );
      assert.ok(
        within(statusRegion()).queryByText("Confirm"),
        "Confirm hidden after background refresh",
      );

      // ~5s video equivalent: intentional switch to TAILS works.
      fireEvent.click(within(heroRegion()).getByText("TAILS", { exact: true }));
      assert.ok(
        await within(statusRegion()).findByText(
          "You Selected TAILS",
          {},
          { timeout: 5000 },
        ),
      );
      assert.ok(
        await within(statusRegion()).findByText(
          "Confirm",
          {},
          { timeout: 5000 },
        ),
      );

      // ~6s video equivalent: must STILL hold.
      await new Promise((r) => setTimeout(r, 2500));
      assert.ok(
        within(statusRegion()).queryByText("You Selected TAILS"),
        "TAILS selection lost after background refresh",
      );
      assert.ok(
        within(statusRegion()).queryByText("Confirm"),
        "Confirm hidden after background refresh",
      );

      // Transient RPC failure mid-hold must also preserve the selection.
      failConfigOnce = true;
      await new Promise((r) => setTimeout(r, 11000));
      assert.ok(
        within(statusRegion()).queryByText("You Selected TAILS"),
        "TAILS selection lost on transient RPC failure",
      );
      assert.ok(
        within(statusRegion()).queryByText("Confirm"),
        "Confirm hidden on transient RPC failure",
      );

      // Rapid switching: the LAST explicit choice always wins; no stale
      // refresh may restore Ready, the previous side, or an error state.
      fireEvent.click(within(heroRegion()).getByText("HEADS", { exact: true }));
      fireEvent.click(within(heroRegion()).getByText("TAILS", { exact: true }));
      fireEvent.click(within(heroRegion()).getByText("HEADS", { exact: true }));
      fireEvent.click(within(heroRegion()).getByText("TAILS", { exact: true }));
      assert.ok(
        await within(statusRegion()).findByText(
          "You Selected TAILS",
          {},
          { timeout: 5000 },
        ),
      );
      assert.ok(
        await within(statusRegion()).findByText(
          "Confirm",
          {},
          { timeout: 5000 },
        ),
      );
      await new Promise((r) => setTimeout(r, 2500));
      assert.ok(
        within(statusRegion()).queryByText("You Selected TAILS"),
        "rapid switch did not stick",
      );
      fireEvent.click(within(heroRegion()).getByText("HEADS", { exact: true }));
      assert.ok(
        await within(statusRegion()).findByText(
          "You Selected HEADS",
          {},
          { timeout: 5000 },
        ),
      );

      // Phase C (post-game shape): an existing IDLE PlayerState must not clear
      // a fresh pick when a stale refresh resolves after it.
      idlePlayer = true;
      await new Promise((r) => setTimeout(r, 12000));
      assert.ok(
        within(statusRegion()).queryByText("You Selected HEADS"),
        "HEADS selection lost against idle PlayerState refreshes",
      );
      assert.ok(
        within(statusRegion()).queryByText("Confirm"),
        "Confirm hidden against idle PlayerState refreshes",
      );

      // Wallet disconnect intentionally resets to the connect prompt.
      fireEvent.click(screen.getByRole("button", { name: /Open profile/ }));
      const disconnectBtn = await screen.findByText(
        "Disconnect wallet",
        {},
        { timeout: 5000 },
      );
      fireEvent.click(disconnectBtn);
      assert.ok(
        await within(screen.getByRole("banner")).findByRole(
          "button",
          { name: "Connect Wallet" },
          { timeout: 10000 },
        ),
      );

      // Phase B: rooms go live on-chain. The selection must STILL hold and the
      // $1 card must show OPEN (probe cache is 30s, so allow a full cycle).
      // NOTE: disconnect cleared the selection above by design; re-pick first.
      roomMode = "live";
      fireEvent.click(
        await within(screen.getByRole("banner")).findByRole(
          "button",
          { name: "Connect Wallet" },
          { timeout: 10000 },
        ),
      );
      fireEvent.click(
        await screen.findByText("TestWallet", {}, { timeout: 10000 }),
      );
      await within(statusRegion()).findByText(
        "Pick a side",
        {},
        { timeout: 15000 },
      );
      fireEvent.click(within(heroRegion()).getByText("TAILS", { exact: true }));
      assert.ok(
        await within(statusRegion()).findByText(
          "You Selected TAILS",
          {},
          { timeout: 5000 },
        ),
      );
      await new Promise((r) => setTimeout(r, 33000));
      assert.ok(
        within(statusRegion()).queryByText("You Selected TAILS"),
        "TAILS selection lost when rooms went live",
      );
      assert.ok(
        within(statusRegion()).queryByText("Confirm"),
        "Confirm hidden when rooms went live",
      );
      view.unmount();
    },
  );
  it("real controller retains queue/result, replays and changes sides on mobile without signing",{timeout:90000},async(t)=>{
    cleanup();window.localStorage.clear();roomMode="live";idlePlayer=true;queuedPlayer=false;
    const originalMedia=window.matchMedia;
    Object.defineProperty(window,"matchMedia",{configurable:true,writable:true,value:(media:string)=>({media,matches:true,addEventListener(){},removeEventListener(){}})});
    t.after(()=>{Object.defineProperty(window,"matchMedia",{configurable:true,writable:true,value:originalMedia});queuedPlayer=false;inMatchPlayer=false;});
    window.history.replaceState(null,"","/");
    const {LiveGameClient}=await import("./LiveGameClient.js"),{WalletStandardProvider}=await import("../wallet/WalletProvider.js"),React=await import("react");
    const view=render(React.createElement(WalletStandardProvider,null,React.createElement(LiveGameClient)));
    t.after(registerFakeWallet());
    const header=()=>within(screen.getByRole("banner")),nav=()=>within(screen.getByRole("navigation",{name:"Mobile navigation"}));
    fireEvent.click(screen.getByRole("button",{name:"Choose room, $1 selected"}));
    const menu=within(screen.getByRole("group",{name:"Choose a room"}));
    await waitFor(()=>assert.equal((menu.getByRole("button",{name:"$10"}) as HTMLButtonElement).disabled,false),{timeout:10000});
    fireEvent.click(menu.getByRole("button",{name:"$10"}));assert(screen.getByRole("button",{name:"Choose room, $10 selected"}));
    fireEvent.click(screen.getByRole("button",{name:"Choose room, $10 selected"}));fireEvent.click(within(screen.getByRole("group",{name:"Choose a room"})).getByRole("button",{name:"$1"}));
    const game=()=>within(screen.getByRole("region",{name:"Flip game"}));
    const heads=await game().findByRole("button",{name:"HEADS"});await waitFor(()=>assert.equal((heads as HTMLButtonElement).disabled,false));
    fireEvent.click(heads);
    const progress=within(screen.getByRole("region",{name:"Game status"}));
    assert.equal(progress.queryByRole("button",{name:"Confirm"}),null,"Picking a side cannot stake before connection");
    fireEvent.click(progress.getByRole("button",{name:"Connect Wallet"}));fireEvent.click(await screen.findByText("TestWallet",{},{timeout:10000}));
    await screen.findByRole("heading",{name:"You Selected HEADS"});
    fireEvent.click(screen.getByRole("button",{name:"Back to sides"}));
    assert.equal(view.container.querySelector('.heads-app')?.getAttribute('data-mobile-progress'),'false');
    fireEvent.click(game().getByRole("button",{name:"TAILS"}));
    await screen.findByRole("heading",{name:"You Selected TAILS"});
    fireEvent.click(screen.getByRole("button",{name:"Back to sides"}));
    fireEvent.click(game().getByRole("button",{name:"HEADS"}));
    fireEvent.click(nav().getByRole("button",{name:"social"}));const draft=screen.getByRole("textbox",{name:"Chat message"});fireEvent.change(draft,{target:{value:"Local unsent draft"}});
    for(const tab of ["flips","profile"]){fireEvent.click(nav().getByRole("button",{name:tab}));assert(header().getByRole("button",{name:/Open profile/}));}
    fireEvent.click(within(screen.getByRole("region",{name:"Profile"})).getByRole("link",{name:"Terms"}));
    await screen.findByRole("heading",{name:"Terms (Devnet Beta)"});fireEvent.click(screen.getByRole("button",{name:"← Back to Profile"}));
    fireEvent.click(nav().getByRole("button",{name:"play"}));assert(screen.getByRole("heading",{name:"You Selected HEADS"}));
    queuedPlayer=true;
    await waitFor(()=>assert.equal(view.container.querySelector('.heads-app')?.getAttribute('data-game-state'),'queued-heads'),{timeout:16000});
    const chooser=screen.getByRole("button",{name:"Choose room, $1 selected"}) as HTMLButtonElement;assert.equal(chooser.disabled,true);
    assert.equal(screen.queryByRole("button",{name:"Back to sides"}),null);
    for(const tab of ["social","flips","profile"]){fireEvent.click(nav().getByRole("button",{name:tab}));assert(screen.getByRole("button",{name:"Queued · View game"}));}
    fireEvent.click(nav().getByRole("button",{name:"social"}));assert.equal((screen.getByRole("textbox",{name:"Chat message"}) as HTMLTextAreaElement).value,"Local unsent draft");
    fireEvent.click(nav().getByRole("button",{name:"play"}));assert(screen.getByRole("heading",{name:"You Selected HEADS"}));
    queuedPlayer=false;inMatchPlayer=true;matchReads=0;
    await screen.findByRole("heading",{name:"You won"},{timeout:20000});
    assert.equal((screen.getByRole("button",{name:"Choose room, $1 selected"}) as HTMLButtonElement).disabled,true);
    const playAgain = await screen.findByRole<HTMLButtonElement>("button", { name: "Play Again" }, { timeout: 20_000 });
    assert.equal(playAgain.disabled, false, "no extra countdown after settlement");
    assert(screen.getByRole("heading",{name:"You won"}),"idle settlement polls cannot dismiss the result");
    assert(matchReads>=1);
    fireEvent.click(playAgain);
    assert.equal(view.container.querySelector('.heads-app')?.getAttribute('data-mobile-progress'),'false');
    assert.equal((game().getByRole("button",{name:"TAILS"}) as HTMLButtonElement).disabled,false);
    fireEvent.click(game().getByRole("button",{name:"TAILS"}));
    await screen.findByRole("heading",{name:"You Selected TAILS"});
    inMatchPlayer=true; // A stale RPC response repeats the already-dismissed Match #42.
    await new Promise(r=>setTimeout(r,11_000));
    assert(screen.getByRole("heading",{name:"You Selected TAILS"}));
    assert(screen.getByRole("button",{name:"Back to sides"}));
    assert.equal(signingRequests,0);assert.equal(submittedTransactions,0);view.unmount();
  });
});
