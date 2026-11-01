import { GameClient } from "@heads-or-tails/game-sdk";
import {
  loadConfigFromEnv,
  loadKeeperKeypair,
  makeProvider,
  runOnce,
} from "./keeper.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Autonomous room maintenance (primary browser-independent mechanism).
 *
 * The Vercel Hobby plan allows daily crons only, so the daily
 * `/api/cron/maintain-rooms` is a backstop, NOT the gameplay recovery path.
 * This keeper — an always-on process — POSTs the authoritative
 * `/api/devnet/maintain-room` reconciler (hole-skipping + match attempts
 * for tiers 1 and 10) at gameplay cadence. Server logic stays in one place
 * (the web app); the keeper only triggers it over HTTP and never holds
 * gameplay authority.
 *
 * Env:
 * - MAINTAIN_API_BASE_URL: e.g. https://<preview>.vercel.app (unset = settle-only mode)
 * - MAINTAIN_INTERVAL_MS: default 20000
 */
async function maintainRoomsOnce(baseUrl: string): Promise<void> {
  for (const tierUsd of [1, 10]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/devnet/maintain-room`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tierUsd }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        matched?: Array<{ matchId: string }>;
        advanced?: Array<{ side: string; sequence: string }>;
      } | null;
      const matched = (body?.matched ?? []).map((m) => m.matchId).join(",");
      const advanced = (body?.advanced ?? []).map((a) => `${a.side}#${a.sequence}`).join(",");
      if ((body?.matched ?? []).length > 0 || (body?.advanced ?? []).length > 0) {
        console.log(`[keeper] maintain tier=${tierUsd} status=${body?.status} matched=[${matched}] advanced=[${advanced}]`);
      }
    } catch (e) {
      console.error(`[keeper] maintain tier=${tierUsd} failed: ${String(e).slice(0, 160)}`);
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfigFromEnv();
  const keeper = loadKeeperKeypair(cfg.keeperKeypairPath);
  const provider = makeProvider(cfg.rpcUrl, keeper);
  const client = await GameClient.load(provider);
  console.log(
    `[keeper] cluster=${cfg.cluster} program=${client.program.programId.toBase58()} keeper=${keeper.publicKey.toBase58()}`
  );
  const maintainBase = (process.env.MAINTAIN_API_BASE_URL ?? "").trim();
  const maintainMs = Number(process.env.MAINTAIN_INTERVAL_MS ?? 20000);
  if (!maintainBase) {
    console.log("[keeper] MAINTAIN_API_BASE_URL unset: settle-only mode (room maintenance via Vercel cron backstop / client fast-path)");
  } else {
    console.log(`[keeper] room maintenance -> ${maintainBase} every ${maintainMs}ms (tiers 1+10)`);
  }
  let lastMaintain = 0;
  let failures = 0;
  for (;;) {
    try {
      const { settled, pending } = await runOnce(
        client,
        keeper,
        cfg.cluster,
        cfg.lookback
      );
      failures = 0;
      if (settled.length > 0 || pending.length > 0) {
        console.log(
          `[keeper] settled=[${settled.join(",")}] pending=[${pending.join(",")}]`
        );
      }
    } catch (e) {
      failures += 1;
      const wait = Math.min(5000 * 2 ** failures, 120000);
      console.error(`[keeper] error (${failures}): ${String(e).slice(0, 300)}; retry in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (maintainBase && Date.now() - lastMaintain >= maintainMs) {
      lastMaintain = Date.now();
      await maintainRoomsOnce(maintainBase);
    }
    await sleep(cfg.pollMs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
