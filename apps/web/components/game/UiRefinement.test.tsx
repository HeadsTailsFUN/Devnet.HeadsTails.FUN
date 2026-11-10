import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { GameStatePanel } from "./GameStatePanel";
import { WalletModal } from "../wallet/WalletModal";
import { WalletStandardProvider } from "../wallet/WalletProvider";
import { AppHeader } from "../brand/AppHeader";
afterEach(cleanup);
const base = {
  selectedSide: null,
  result: null,
  onConfirm() {},
  onLeave() {},
  onRetry() {},
};
test("mobile wallet list explains Devnet and the ownership-verified welcome grant", (t) => {
  const ua = Object.getOwnPropertyDescriptor(navigator,"userAgent");
  Object.defineProperty(navigator,"userAgent",{configurable:true,value:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"});
  t.after(() => {
    if(ua) Object.defineProperty(navigator,"userAgent",ua);
    else Reflect.deleteProperty(navigator,"userAgent");
  });
  render(createElement(WalletStandardProvider,null,createElement(WalletModal,{open:true,onClose(){}})));
  const dialog = screen.getByRole("dialog",{name:"Connect a Solana wallet"});
  assert.match(dialog.textContent ?? "",/Set your wallet network to Devnet/);
  assert.match(dialog.textContent ?? "",/10,000 test HTS by connecting new wallet/);
  assert(screen.getByText("Open in your wallet browser to play"));
  assert.doesNotMatch(dialog.textContent ?? "", /WalletConnect|Or open your wallet browser/);
  assert.deepEqual(
    screen.getAllByRole("link").map((link) => link.textContent),
    ["Phantom", "Solflare", "Backpack", "Nightly"],
  );
  assert.doesNotMatch(dialog.textContent ?? "", /Trust Wallet|MetaMask|Coinbase Wallet|Bitget/);
});
test("desktop without an extension directs users to Solana wallet extensions",()=>{
  render(createElement(WalletStandardProvider,null,createElement(WalletModal,{open:true,onClose(){}})));
  assert(screen.getByText("No wallet extension detected. Install a Solana wallet extension to connect."));
  assert.equal(screen.queryByRole("button",{name:"WalletConnect"}),null);
});
test("verification stays in game panel and never triggers an HTS transfer", () => {
  let verify = 0,
    stakes = 0;
  render(
    createElement(GameStatePanel, {
      ...base,
      state: "heads-selected",
      selectedSide: "HEADS",
      needsVerification: true,
      onVerify() {
        verify++;
      },
      onConfirm() {
        stakes++;
      },
    }),
  );
  assert.equal(screen.queryByRole("button", { name: "Confirm" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Verify Wallet" }));
  assert.equal(verify, 1);
  assert.equal(stakes, 0);
});
test("GG has a real 10-second countdown, pauses off-screen and never auto-dismisses", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval","Date"] });
  t.mock.method(performance,"now",()=>Date.now());
  let replay = 0;
  const props={
      ...base,
      state: "win" as const,
      result: "HEADS" as const,
      completedMatchId: "42",
      playAgainReady: true,
      onPlayAgain() {
        replay++;
      },
    };
  const view=render(createElement(GameStatePanel,props));
  assert.equal(screen.queryByText(/^Play again in /),null,"the visible countdown is only inside the replay button");
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Play Again (10s)",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  await act(async () => {
    t.mock.timers.tick(1000);
  });
  assert.equal(screen.getByRole("timer").textContent,"9 seconds remaining");
  view.rerender(createElement(GameStatePanel,{...props,resultVisible:false}));
  await act(async()=>{t.mock.timers.tick(30_000);});
  assert.equal(screen.getByRole("timer").textContent,"9 seconds remaining");
  view.rerender(createElement(GameStatePanel,{...props,resultVisible:true}));
  await act(async()=>{t.mock.timers.tick(8999);});
  assert.equal(replay, 0);
  assert.equal((screen.getByRole("button", { name: "Play Again (1s)" }) as HTMLButtonElement).disabled,true);
  await act(async () => {
    t.mock.timers.tick(1);
  });
  assert(screen.getByRole("heading", { name: "You won" }));
  assert.equal(replay, 0);
  await act(async () => { t.mock.timers.tick(60_000); });
  assert(screen.getByRole("heading", { name: "You won" }));
  fireEvent.click(screen.getByRole("button", { name: "Play Again" }));
  assert.equal(replay, 1);
  view.rerender(createElement(GameStatePanel,{...props,state:"loss",result:"TAILS",completedMatchId:"43"}));
  assert(screen.getByRole("heading",{name:"You lost"}));
  assert.equal(screen.getByRole("timer").textContent,"10 seconds remaining");
});
test("connected header exposes the actual token balance and Devnet label",()=>{
  render(createElement(AppHeader,{state:"ready",onConnect(){},onDisconnect(){},addressLabel:"EWM…U1qt",profileName:"Player A",balanceLabel:"1,400 HTS"}));
  assert(screen.getByLabelText("Available tokens 1,400 HTS"));
  assert(screen.getByText("Devnet"));
});
test("the ready panel uses both supplied characters and no funding selection", () => {
  const view = render(
    createElement(GameStatePanel, { ...base, state: "ready" }),
  );
  assert.equal(
    view.container.querySelectorAll("img[data-character]").length,
    2,
  );
  assert(!view.container.textContent?.includes("Entry funding"));
  assert(!view.container.textContent?.includes("Pay with"));
});
