import { createHmac, timingSafeEqual } from "node:crypto";

const PATH = "/api/cron/maintain-rooms";
export const CANONICAL_RECOVERY_ORIGIN = "https://headstails.fun";
export function recoveryMessage(origin: string, mint: string, timestamp: string, nonce: string): string {
  return ["headstails-recovery-v1", "GET", PATH, origin, mint, timestamp, nonce].join("\n");
}

/** pg_net responses are readable by database roles: emit health enums, never raw errors. */
export function recoveryHealth(body: { rooms: unknown[]; settle: unknown; rewards: unknown }): unknown {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const errors = (value: unknown, code: string) => Array.isArray(value) ? value.map(() => code) : undefined;
  const settle = object(body.settle), rewards = object(body.rewards);
  return {
    status: "cron-maintained",
    rooms: body.rooms.map(value => {
      const room = object(value);
      return { tierUsd: room.tierUsd === 1 || room.tierUsd === 10 ? room.tierUsd : 0,
        invariants: errors(room.invariants, "ROOM_INVARIANT"),
        ...(["BUDGET_LIMIT", "CONFIRMATION_PENDING", "RPC_RETRY"].includes(String(room.deferred))
          ? { deferred: room.deferred } : {}),
        ...("error" in room ? { error: "ROOM_MAINTENANCE_FAILED" } : {}) };
    }),
    settle: { errors: errors(settle.errors, "SETTLEMENT_RECOVERY_FAILED"),
      ...(Array.isArray(settle.historyPending) ? { historyPending: settle.historyPending.length } : {}),
      ...("error" in settle ? { error: "SETTLEMENT_RECOVERY_FAILED" } : {}) },
    rewards: { failed: typeof rewards.failed === "number" ? rewards.failed : undefined,
      errors: errors(rewards.errors, "REWARD_RECOVERY_FAILED"),
      ...("error" in rewards ? { error: "REWARD_RECOVERY_FAILED" } : {}) },
  };
}

/** Validate before touching the durable single-use claim. No signer material belongs here. */
export async function authorizeRecovery(
  req: Request,
  cfg: { secret: string; origin: string; mint: string; nowSeconds: number },
  consume: (nonce: string, timestamp: string) => Promise<boolean>,
): Promise<boolean> {
  const timestamp = req.headers.get("x-ht-recovery-time") ?? "";
  const nonce = req.headers.get("x-ht-recovery-nonce") ?? "";
  const mac = req.headers.get("x-ht-recovery-mac") ?? "";
  const url = new URL(req.url);
  const allowedOrigin = cfg.origin === CANONICAL_RECOVERY_ORIGIN ||
    /^https:\/\/headstails-devnet-beta[a-z0-9-]*\.vercel\.app$/.test(cfg.origin);
  if (!/^[a-f0-9]{64}$/.test(cfg.secret) ||
      !allowedOrigin || url.origin !== cfg.origin ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cfg.mint) ||
      cfg.mint === "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh" ||
      req.method !== "GET" || url.pathname !== PATH ||
      !/^\d{10}$/.test(timestamp) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce) ||
      !/^[a-f0-9]{64}$/.test(mac)) return false;
  const age = cfg.nowSeconds - Number(timestamp);
  if (!Number.isFinite(age) || age < -10 || age > 120) return false;
  const expected = createHmac("sha256", cfg.secret)
    .update(recoveryMessage(cfg.origin, cfg.mint, timestamp, nonce)).digest();
  if (!timingSafeEqual(expected, Buffer.from(mac, "hex"))) return false;
  try { return await consume(nonce, timestamp); } catch { return false; }
}
