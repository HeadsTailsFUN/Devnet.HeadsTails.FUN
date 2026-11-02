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
  assert.match(dialog.textContent ?? "",/set your wallet to Solana Devnet/);
  assert.match(dialog.textContent ?? "",/200 test HTS.*verifying wallet ownership/);
  const trust = screen.getByRole("button",{name:/^Trust Wallet\s*Mainnet Only$/});
  const icon = trust.querySelector("img");
  assert.equal(icon?.getAttribute("width"),"28");
  assert.equal(icon?.getAttribute("height"),"28");
  assert.equal(icon?.getAttribute("src"),"/assets/wallets/trust.svg");
  assert.equal(trust.getAttribute("aria-disabled"),"true");
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
test("GG result stays for 12 seconds before manual replay, and never auto-dismisses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let replay = 0;
  render(
    createElement(GameStatePanel, {
      ...base,
      state: "win",
      result: "HEADS",
      completedMatchId: "42",
      playAgainReady: true,
      onPlayAgain() {
        replay++;
      },
    }),
  );
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Enjoy the result…",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  await act(async () => {
    t.mock.timers.tick(11999);
  });
  assert.equal(replay, 0);
  assert.equal((screen.getByRole("button", { name: "Enjoy the result…" }) as HTMLButtonElement).disabled,true);
  await act(async () => {
    t.mock.timers.tick(1);
  });
  assert(screen.getByRole("heading", { name: "You won" }));
  assert.equal(replay, 0);
  await act(async () => { t.mock.timers.tick(60_000); });
  assert(screen.getByRole("heading", { name: "You won" }));
  fireEvent.click(screen.getByRole("button", { name: "Play Again" }));
  assert.equal(replay, 1);
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
