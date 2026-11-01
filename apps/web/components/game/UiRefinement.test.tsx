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
afterEach(cleanup);
const base = {
  selectedSide: null,
  result: null,
  onConfirm() {},
  onLeave() {},
  onRetry() {},
};
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
test("a completed result persists past 4.5s and replay requires the user", async (t) => {
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
    t.mock.timers.tick(4499);
  });
  assert.equal(replay, 0);
  await act(async () => {
    t.mock.timers.tick(1);
  });
  assert(screen.getByRole("heading", { name: "You won" }));
  assert.equal(replay, 0);
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
