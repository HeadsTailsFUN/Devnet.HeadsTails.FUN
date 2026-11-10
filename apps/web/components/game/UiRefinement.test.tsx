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
  assert(screen.getByText("Continue in your wallet to play"));
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
test("settled win and loss can replay immediately, and the result stays until the player acts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  let replays = 0;
  const props = { ...base, onPlayAgain: () => { replays++; } };
  const view = render(createElement(GameStatePanel, {
    ...props, state: "win", result: "HEADS", playAgainReady: false,
  }));
  assert.equal(screen.queryByRole("button", { name: "Play Again" }), null);
  view.rerender(createElement(GameStatePanel, {
    ...props, state: "win", result: "HEADS", playAgainReady: true,
  }));
  const replay = () => screen.getByRole<HTMLButtonElement>("button", { name: "Play Again" });
  assert.equal(replay().disabled, false);
  fireEvent.click(replay());
  assert.equal(replays, 1);

  view.rerender(createElement(GameStatePanel, {
    ...props, state: "loss", result: "TAILS", playAgainReady: true,
  }));
  assert.equal(replay().disabled, false);
  await act(async () => { t.mock.timers.tick(60_000); });
  assert(screen.getByRole("heading", { name: "You lost" }));
  assert.equal(replays, 1);
  fireEvent.click(replay());
  assert.equal(replays, 2);
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
