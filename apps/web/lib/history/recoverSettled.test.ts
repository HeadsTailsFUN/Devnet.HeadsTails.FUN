import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverSettledMatchHistory } from "./recoverSettled";

const programId = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
const matchAddress = PublicKey.default;
function fixture(options: { indexed?: boolean; journal?: string; candidates?: string[] } = {}) {
  let reads = 0;
  const db = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        limit: async () => ({ data: options.indexed ? [{ onchain_match_id: "337" }] : [], error: null }),
        maybeSingle: async () => ({ data: table === "devnet_expenses" ? { signature: options.journal } : null, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const connection = {
    getSignaturesForAddress: async () => {
      reads++;
      return (options.candidates ?? []).map(signature => ({ signature, err: null }));
    },
  } as unknown as Connection;
  return {
    args: { db, connection, programId, cluster: "devnet", matchId: "337", matchAddress },
    reads: () => reads,
  };
}

test("already indexed matches do not refetch transaction history", async () => {
  const { args, reads } = fixture({ indexed: true, journal: "receipt" });
  await recoverSettledMatchHistory(args, async () => { throw Error("unexpected"); });
  assert.equal(reads(), 0);
});
test("a persisted receipt repairs a missed index even after confirmation timed out", async () => {
  const { args, reads } = fixture({ journal: "confirmed-later" });
  const attempts: string[] = [];
  await recoverSettledMatchHistory(args, async (_c, _db, _p, _cluster, signature) => {
    attempts.push(signature);
    return { ok: true, matches: ["337"] };
  });
  assert.deepEqual(attempts, ["confirmed-later"]);
  assert.equal(reads(), 0);
});
test("a different settler's signature is verified and duplicate candidates are skipped", async () => {
  const { args } = fixture({ journal: "wrong-match", candidates: ["wrong-match", "real-settlement"] });
  const attempts: string[] = [];
  await recoverSettledMatchHistory(args, async (_c, _db, _p, _cluster, signature) => {
    attempts.push(signature);
    return { ok: true, matches: signature === "real-settlement" ? ["337"] : ["336"] };
  });
  assert.deepEqual(attempts, ["wrong-match", "real-settlement"]);
});
test("missing verified metadata remains retryable with at most three receipt attempts", async () => {
  const { args } = fixture({ journal: "first", candidates: ["second", "third", "fourth"] });
  let attempts = 0;
  await assert.rejects(recoverSettledMatchHistory(args, async () => {
    attempts++;
    return { ok: false, error: "transaction not found", status: 404 };
  }), /not available yet/);
  assert.equal(attempts, 3);
});
