import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { TeamWelcome, TeamPreference } from "./TeamPreference";
import { ProfileModal } from "./ProfileModal";
import { ResultReaction } from "../game/ResultReaction";
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
test("Choose Later is saved once and stays dismissed after reopening", async () => {
  let completed = false,
    writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.team, null);
      assert.equal(body.wallet, "SYNTHETIC");
      writes++;
      completed = true;
    }
    return Response.json({ completed, team: null });
  };
  const first = render(
    createElement(TeamWelcome, { wallet: "SYNTHETIC", onSaved() {} }),
  );
  await screen.findByRole("dialog", { name: "Choose your team" });
  fireEvent.click(screen.getByRole("button", { name: "Choose Later" }));
  await waitFor(() => assert(!screen.queryByRole("dialog")));
  assert.equal(writes, 1);
  first.unmount();
  render(createElement(TeamWelcome, { wallet: "SYNTHETIC", onSaved() {} }));
  await waitFor(() => assert(!screen.queryByRole("dialog")));
  assert.equal(writes, 1);
});
test("an expired session cannot open the preference prompt or write", async () => {
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") writes++;
    return Response.json({ error: "authentication required" }, { status: 401 });
  };
  render(createElement(TeamWelcome, { wallet: "SYNTHETIC", onSaved() {} }));
  await waitFor(() => assert(!screen.queryByRole("dialog")));
  assert.equal(writes, 0);
});
test("profile team preference offers only HEADS and TAILS, without selecting a gameplay side", () => {
  const changes: Array<string | null> = [];
  render(
    createElement(TeamPreference, {
      value: "HEADS",
      onSave(team) {
        changes.push(team);
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "TEAM TAILS" }));
  assert.equal(screen.queryByRole("button", { name: "Choose Later" }), null);
  fireEvent.click(screen.getByRole("button", { name: "TEAM HEADS" }));
  assert.deepEqual(changes, ["TAILS", "HEADS"]);
});
test("avatar Change stays directly under the avatar; existing validated input is reused", () => {
  globalThis.fetch = async () => Response.json({ team: null, completed: true });
  const view = render(
    createElement(ProfileModal, {
      wallet: null,
      account: null,
      address: "SYNTHETIC",
      profile: null,
      onClose() {},
      onChanged() {},
      onLogout() {},
    }),
  );
  const change = screen.getByRole("button", { name: "Change avatar" });
  assert(change.parentElement?.querySelector('span[aria-hidden="true"]'));
  assert.equal(screen.queryByRole("button", { name: /Upload avatar/ }), null);
  assert.equal(
    view.container.querySelector('input[type="file"]')?.getAttribute("accept"),
    "image/jpeg,image/png,image/webp",
  );
});
test("a confirmed reaction and phrase remain fixed after repeated polls and reopening", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    configurable: true,
  });
  localStorage.clear();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ side: "TAILS", win: true, ordinal: 2 });
  };
  const first = render(
    createElement(ResultReaction, {
      wallet: "SYNTHETIC",
      matchId: "61",
      win: true,
    }),
  );
  const image = await screen.findByRole("img", { name: "TAILS win reaction" });
  assert(
    decodeURIComponent(image.getAttribute("src") ?? "").includes(
      "TailSecondWin.png",
    ),
  );
  const text = first.container.textContent;
  first.rerender(
    createElement(ResultReaction, {
      wallet: "SYNTHETIC",
      matchId: "61",
      win: true,
    }),
  );
  assert.equal(first.container.textContent, text);
  first.unmount();
  render(
    createElement(ResultReaction, {
      wallet: "SYNTHETIC",
      matchId: "61",
      win: true,
    }),
  );
  await screen.findByRole("img", { name: "TAILS win reaction" });
  assert.equal(requests, 1);
  assert.equal(
    document.querySelector('[aria-label="You won"]')?.textContent,
    text,
  );
});
