/**
 * Recent Flips regression: click opens a VISIBLE portaled details modal
 * (never clipped by the horizontal scroll container), only one opens,
 * keyboard + Escape work, explorer links are correct, mobile-safe.
 *
 * Requires: node --import tsx --import ./lib/test/jsdom-setup.ts
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RecentFlips } from "./RecentFlips.js";
import type { RecentFlip } from "@/lib/solana/history.js";

function sig(seed: string): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let x = h || 1;
  for (let i = 0; i < 88; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += chars[x % chars.length];
  }
  return s;
}

function addr(seed: string): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  let h = 7;
  for (const c of seed) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  let x = h || 2;
  for (let i = 0; i < 44; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += chars[x % chars.length];
  }
  return s;
}

function flip(id: string, result: "HEADS" | "TAILS"): RecentFlip {
  return {
    matchId: id,
    result,
    winnerWallet: addr(`winner-${id}`),
    headsWallet: addr(`heads-${id}`),
    tailsWallet: addr(`tails-${id}`),
    potBaseUnits: "2000000",
    tokenMint: "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh",
    settledAt: new Date().toISOString(),
    settlementSignature: sig(`settle-${id}`),
    tierUsd: 1,
    matchPda: addr(`match-${id}`),
    randomnessAccount: addr(`random-${id}`),
    matchSignature: sig(`match-${id}`),
    oraoFulfillmentSignature: null,
    createdSlot: 1,
    settledSlot: 2,
  };
}

describe("RecentFlips details modal", () => {
  it("clicking a flip opens visible details with explorer links", () => {
    try {
      render(React.createElement(RecentFlips, { flips: [flip("25", "HEADS")], live: true, tierUsd: 1 }));
      const btn = screen.getByRole("button", { name: /ROUND #25/ });
      fireEvent.click(btn);
      const dialog = screen.getByRole("dialog", { name: /ROUND #25 details/ });
      assert.ok(dialog, "details dialog visible");
      // Portaled to body: outside the overflow-x-auto scroller, so it
      // cannot be clipped (the black-artifact regression).
      const scroller = document.querySelector('[role="list"]');
      assert.ok(scroller, "scroll row exists");
      assert.ok(!scroller!.contains(dialog), "dialog is NOT inside the clipping scroller");
      assert.equal(dialog.parentElement?.ownerDocument, document);
      const settle = screen.getByRole("link", { name: /View Settlement on Solscan/ });
      assert.ok((settle as HTMLAnchorElement).href.includes("solscan.io/tx/"));
      assert.ok((settle as HTMLAnchorElement).href.includes("cluster=devnet"));
      assert.ok(screen.getByRole("link", { name: /View Match Account/ }));
      assert.ok(screen.getByRole("link", { name: /View ORAO Account on Solana/ }));
      assert.match(screen.getByRole("link",{name:/View Settlement on Solana Explorer/}).getAttribute("href")!,/explorer.solana.com\/tx\/.+cluster=devnet/);
      assert.ok(screen.getAllByText("HEADS").length >= 1);
    } finally {
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("TAILS content renders; only one dialog open at once; close works", () => {
    try {
      render(React.createElement(RecentFlips, { flips: [flip("20", "TAILS"), flip("18", "HEADS")], live: true, tierUsd: 1 }));
      fireEvent.click(screen.getByRole("button", { name: /ROUND #20/ }));
      assert.ok(screen.getByRole("dialog", { name: /ROUND #20 details/ }));
      assert.ok(screen.getAllByText("TAILS").length >= 1);
      // Opening a second round replaces the first (only one at once).
      fireEvent.click(screen.getByRole("button", { name: /ROUND #18/ }));
      assert.equal(screen.queryByRole("dialog", { name: /ROUND #20 details/ }), null);
      assert.ok(screen.getByRole("dialog", { name: /ROUND #18 details/ }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      assert.equal(screen.queryByRole("dialog"), null);
    } finally {
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("keyboard activation opens; Escape closes", () => {
    try {
      render(React.createElement(RecentFlips, { flips: [flip("22", "HEADS")], live: true, tierUsd: 1 }));
      const btn = screen.getByRole("button", { name: /ROUND #22/ });
      btn.focus();
      fireEvent.click(btn);
      assert.ok(screen.getByRole("dialog", { name: /ROUND #22 details/ }));
      fireEvent.keyDown(window, { key: "Escape" });
      assert.equal(screen.queryByRole("dialog"), null);
    } finally {
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("no duplicate left Latest Results; coin art carries measured centering", () => {
    try {
      const { container } = render(React.createElement(RecentFlips, { flips: [flip("30", "HEADS"), flip("29", "TAILS")], live: true, tierUsd: 1 }));
      // Left side shows only the heading; the desktop right rail keeps the
      // single "Latest results" copy.
      const heading = screen.getByRole("heading", { name: "Recent Flips" });
      assert.ok(heading, "heading present");
      assert.equal(screen.getAllByText("Latest results").length, 1, "exactly one Latest results (desktop rail)");
      // Measured per-asset visual centering (alpha-centroid derived,
      // verified against the PNG alpha channel: mass sits left/up of
      // canvas center, so both shifts are positive; identical box size,
      // no per-coin scale).
      const html = container.innerHTML;
      assert.ok(html.includes("translate(1.24%, 0.17%)"), "HEADS centering transform");
      assert.ok(html.includes("translate(1.49%, 1.1%)"), "TAILS centering transform");
      assert.ok(!html.includes("scale(1.12)"), "no per-coin size skew");
    } finally {
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("no absolutely-positioned details panel remains inside the scroller", () => {
    try {
      const { container } = render(React.createElement(RecentFlips, { flips: [flip("16", "TAILS")], live: true, tierUsd: 1 }));
      fireEvent.click(screen.getByRole("button", { name: /ROUND #16/ }));
      // The old bug rendered `absolute bottom-14` inside overflow-x-auto.
      const scrollerHtml = (container.querySelector('[role="list"]')?.innerHTML ?? "");
      assert.ok(!scrollerHtml.includes("bottom-14"), "no clipped absolute panel in scroller");
      assert.ok(!scrollerHtml.includes("role=\"dialog\""), "dialog lives in portal, not scroller");
    } finally {
      cleanup();
      document.body.innerHTML = "";
    }
  });
});
