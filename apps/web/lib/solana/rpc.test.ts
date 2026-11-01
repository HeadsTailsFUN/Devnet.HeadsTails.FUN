import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  PUBLIC_DEVNET_RPC,
  estimateRpcVolume,
  getRpcConfigStatus,
  isPublicRpcUrl,
  resolveBrowserRpcUrl,
  resolveServerRpcUrl,
} from "./rpc.js";

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe("dedicated RPC", () => {
  it("detects public endpoint as non-dedicated", () => {
    assert.equal(isPublicRpcUrl(PUBLIC_DEVNET_RPC), true);
    assert.equal(isPublicRpcUrl("https://helius.devnet.rpc.example/abc"), false);
  });

  it("uses dedicated browser RPC when configured", () => {
    withEnv(
      { NEXT_PUBLIC_RPC_URL: "https://helius.devnet.rpc.example/abc", NODE_ENV: "production", VERCEL_ENV: "production" },
      () => {
        const r = resolveBrowserRpcUrl();
        assert.equal(r.isDedicated, true);
        assert.equal(r.missing, false);
        assert.equal(r.url, "https://helius.devnet.rpc.example/abc");
      }
    );
  });

  it("fail-closes when dedicated RPC is missing in production", () => {
    withEnv(
      { NEXT_PUBLIC_RPC_URL: undefined, NODE_ENV: "production", VERCEL_ENV: "production" },
      () => {
        const r = resolveBrowserRpcUrl();
        assert.equal(r.missing, true);
        const s = getRpcConfigStatus();
        assert.equal(s.ok, false);
      }
    );
  });

  it("prefers server-only RPC over browser credential", () => {
    withEnv(
      {
        SOLANA_SERVER_RPC_URL: "https://server.devnet.rpc.example/secret",
        NEXT_PUBLIC_RPC_URL: "https://browser.devnet.rpc.example/pub",
        NODE_ENV: "test",
        VERCEL_ENV: undefined,
      },
      () => {
        const r = resolveServerRpcUrl();
        assert.equal(r.url, "https://server.devnet.rpc.example/secret");
        assert.equal(r.isDedicated, true);
      }
    );
  });

  it("reduces RPC pressure after the fix", () => {
    const { before, after } = estimateRpcVolume();
    const sum = (xs: Array<{ requestsPerMinute: number }>) =>
      xs.reduce((s, x) => s + x.requestsPerMinute, 0);
    assert.ok(sum(after) < sum(before));
    const hidden = after.find((x) => x.label === "hidden tab");
    assert.equal(hidden?.requestsPerMinute, 0);
  });
});
