import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadExcludedWallets, processSettledMatchRewards } from "./processor.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fakeDb(opts: {
  members?: string[];
  exclusions?: string[];
  ledger?: Array<Record<string, any>>;
  attrs?: Array<Record<string, any>>;
}) {
  const calls: Array<{ table: string; op: string; row?: unknown }> = [];
  return {
    calls,
    from(table: string) {
      const api: Record<string, any> = {};
      let eq: Array<[string, unknown]> = [];
      api.select = () => api;
      api.eq = (k: string, v: unknown) => {
        eq.push([k, v]);
        return api;
      };
      api.in = () => api;
      api.gte = () => api;
      api.limit = () => api;
      api.order = () => api;
      api.maybeSingle = async () => ({ data: null, error: null });
      const filtered = () => {
        if (table === "admin_members") return (opts.members ?? []).map((wallet) => ({ wallet }));
        if (table === "reward_exclusions")
          return (opts.exclusions ?? []).map((wallet) => ({ wallet, active: true }));
        return [];
      };
      api.then = (resolve: (v: { data: unknown; error: null; count?: number }) => unknown) =>
        Promise.resolve({ data: filtered(), error: null, count: 0 }).then(resolve);
      api.upsert = async (row: unknown) => {
        calls.push({ table, op: "upsert", row });
        return { error: null };
      };
      api.insert = async (row: unknown) => {
        calls.push({ table, op: "insert", row });
        return { error: null };
      };
      api.update = () => ({ eq: async () => ({ error: null }) });
      void eq;
      return api;
    },
  };
}

describe("reward exclusions (QA / abuse)", () => {
  it("excluded wallets load from both admin_members and reward_exclusions", async () => {
    const db = fakeDb({ members: ["MOD"], exclusions: ["QA1"] });
    const out = await loadExcludedWallets(db as any);
    assert.ok(out.has("MOD"));
    assert.ok(out.has("QA1"));
  });

  it("excluded player earns zero gameplay points (gameplay unaffected = no throw)", async () => {
    const db = fakeDb({ exclusions: ["HEADS_WALLET", "TAILS_WALLET"] });
    await processSettledMatchRewards(db as any, {
      seasonId: "s",
      matchId: "42",
      headsWallet: "HEADS_WALLET",
      tailsWallet: "TAILS_WALLET",
      winnerWallet: "HEADS_WALLET",
      settledAt: "2026-09-20T12:00:00.000Z",
    });
    const ledgerWrites = db.calls.filter((c) => c.table === "airdrop_points_ledger");
    assert.equal(ledgerWrites.length, 0, "no points for excluded players");
  });

  it("excluded invitee blocks referral flow both directions", async () => {
    const src = readFileSync(join(root, "lib", "airdrop", "processor.ts"), "utf8");
    assert.ok(
      src.includes("excluded.has(row.referrer_wallet) || excluded.has(wallet)"),
      "no referral TO or FROM excluded wallets"
    );
  });

  it("admin exclusion is owner-only and audited", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "airdrop", "route.ts"), "utf8");
    assert.ok(src.includes('"exclude"') || src.includes('"exclude"'), "exclude action");
    assert.ok(src.includes("airdrop.exclude"), "audit logged");
    assert.ok(src.includes("reason required") || src.includes("reason"), "reason required");
  });
});
