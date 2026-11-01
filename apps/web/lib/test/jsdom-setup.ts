/**
 * jsdom + env setup for component-level tests. Loaded via
 * `node --import` BEFORE the test module, so browser-flavored env vars are
 * in place before `@/lib/solana/cluster` evaluates them.
 */
process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT =
  "DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy";
process.env.NEXT_PUBLIC_HTS_TOKEN_MINT = process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT;
process.env.NEXT_PUBLIC_TOKEN_SYMBOL = "HTS";
process.env.NEXT_PUBLIC_TOKEN_DECIMALS = "6";
process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
process.env.NEXT_PUBLIC_RPC_URL = "http://127.0.0.1:18789";
process.env.NEXT_PUBLIC_DEVNET_SPONSOR_ENABLED = "false";
process.env.NEXT_PUBLIC_DEVNET_FAUCET_ENABLED = "false";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { JSDOM } from "jsdom";
import * as React from "react";

// Some components reference the React UMD global (works under Next.js);
// provide it for the bare-node harness.
setGlobal("React", React);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
});

const g = globalThis as Record<string, unknown>;
function setGlobal(key: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  } catch {
    (g as Record<string, unknown>)[key] = value;
  }
}
setGlobal("window", dom.window as unknown);
setGlobal("document", dom.window.document as unknown);
setGlobal("navigator", dom.window.navigator as unknown);
setGlobal("HTMLElement", dom.window.HTMLElement as unknown);
setGlobal("Element", dom.window.Element as unknown);
setGlobal("Node", dom.window.Node as unknown);
setGlobal("Event", dom.window.Event as unknown);
setGlobal("CustomEvent", dom.window.CustomEvent as unknown);
setGlobal("KeyboardEvent", dom.window.KeyboardEvent as unknown);
setGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window) as unknown);
// Next.js client runtime (next/link -> use-intersection) references global
// `self`; jsdom only provides window.self.
setGlobal("self", dom.window as unknown);
g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 16)) as unknown;
g.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown;

// jsdom has no layout engine: smooth-scroll calls must not throw.
try {
  const proto = (dom.window.Element as unknown as { prototype: Record<string, unknown> })
    .prototype;
  if (!proto.scrollIntoView) proto.scrollIntoView = () => undefined;
} catch {
  // ignore
}
if (typeof (g.navigator as Navigator & { clipboard?: unknown }).clipboard === "undefined") {
  try {
    Object.defineProperty(g.navigator, "clipboard", {
      value: { writeText: async () => undefined },
      configurable: true,
    });
  } catch {
    // ignore
  }
}
