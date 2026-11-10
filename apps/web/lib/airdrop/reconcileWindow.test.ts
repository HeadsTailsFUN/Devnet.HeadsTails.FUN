import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSettledMatchRewards } from "./reconcile";

test("scheduled reward pages cover the recent 50 matches in small batches", async () => {
  const ranges: Array<[number, number]> = [];
  const db = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        gte() { return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle: async () => ({ data: { id: "synthetic", key: "DEVNET_BETA" }, error: null }),
        range: async (start: number, end: number) => {
          assert.equal(table, "matches");
          ranges.push([start, end]);
          return { data: [], error: null };
        },
      };
      return query;
    },
  };
  for (let page = 0; page < 10; page++) {
    const result = await reconcileSettledMatchRewards(db, { limit: 5, offset: page * 5 });
    assert.equal(result.scanned, 0);
    assert.deepEqual(result.errors, []);
  }
  assert.deepEqual(ranges.flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, i) => start + i)), Array.from({ length: 50 }, (_, i) => i));
  await reconcileSettledMatchRewards(db);
  assert.deepEqual(ranges.at(-1), [0, 49]);
});
