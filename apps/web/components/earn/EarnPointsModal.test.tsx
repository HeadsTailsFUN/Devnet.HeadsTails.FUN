import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { EarnPointsProvider } from "./EarnPointsProvider";
import { EarnPointsLink } from "./EarnPointsLink";
import { WalletStandardProvider } from "../wallet/WalletProvider";

// jsdom has no top-layer implementation. Browser behavior is verified separately.
before(() => {
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); document.body.style.overflow = ""; });

function mount() {
  let mounts = 0;
  function Game() {
    const [count, setCount] = useState(0);
    useEffect(() => { mounts++; }, []);
    return <><EarnPointsLink /><button onClick={() => setCount(count + 1)}>Game counter {count}</button></>;
  }
  const view = render(<WalletStandardProvider><EarnPointsProvider><Game /></EarnPointsProvider></WalletStandardProvider>);
  return { ...view, mounts: () => mounts };
}

test("header opens a popup without navigating or remounting the game; close restores focus and scroll", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Game counter 0" }));
  const trigger = screen.getByRole("button", { name: "Earn Points" }); trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Earn Points" });
  assert.equal(window.location.pathname, "/");
  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(document.documentElement.style.overflow, "hidden");
  assert.equal(dialog.parentElement, document.body, "portal escapes the clipped mobile game shell");
  assert.equal(view.mounts(), 1);
  fireEvent.click(screen.getByRole("button", { name: "Close Earn Points" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: "Earn Points" }), null));
  assert.equal(document.body.style.overflow, ""); assert.equal(document.activeElement, trigger);
  assert.equal(document.documentElement.style.overflow, "");
  assert(screen.getByRole("button", { name: "Game counter 1" }));
});

test("Escape cancellation and backdrop close the popup without resetting the game", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Earn Points" }));
  const first = await screen.findByRole("dialog", { name: "Earn Points" });
  fireEvent(first, new Event("cancel", { cancelable: true }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: "Earn Points" }), null));
  fireEvent.click(screen.getByRole("button", { name: "Earn Points" }));
  fireEvent.click(await screen.findByRole("dialog", { name: "Earn Points" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: "Earn Points" }), null));
  assert.equal(view.mounts(), 1);
});

test("wallet handoff suspends the top layer and restores the same earning tab after cancel", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Earn Points" }));
  await screen.findByRole("dialog", { name: "Earn Points" });
  fireEvent.click(screen.getByRole("tab", { name: "QUESTS" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Connect Wallet" })[0]);
  await screen.findByRole("dialog", { name: "Connect a Solana wallet" });
  assert.equal(screen.queryByRole("dialog", { name: "Earn Points" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByRole("dialog", { name: "Earn Points" });
  assert.equal(screen.getByRole("tab", { name: "QUESTS" }).getAttribute("aria-selected"), "true");
});

test("Play Now switches the existing mobile tab without replacing the game controller", async () => {
  window.history.replaceState(null, "", "/?tab=profile&ref=keep-me");
  const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Earn Points" }));
  await screen.findByRole("dialog", { name: "Earn Points" });
  fireEvent.click(screen.getByRole("button", { name: "Play Now" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: "Earn Points" }), null));
  assert.equal(new URLSearchParams(window.location.search).get("tab"), "play");
  assert.equal(new URLSearchParams(window.location.search).get("ref"), "keep-me");
  assert.equal(view.mounts(), 1);
});

test("legacy deep link opens the popup on the game and consumes only the earn query parameter", async () => {
  window.history.replaceState(null, "", "/?earn=1&ref=keep-me"); mount();
  await screen.findByRole("dialog", { name: "Earn Points" });
  assert.equal(new URLSearchParams(window.location.search).get("earn"), null);
  assert.equal(new URLSearchParams(window.location.search).get("ref"), "keep-me");
});
