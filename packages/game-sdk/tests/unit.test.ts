import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PublicKey } from "@solana/web3.js";
import {
  FixedPriceAdapter,
  JupiterPriceAdapter,
  StaleQuoteError,
  quoteAgeSeconds,
  stakeForUsd,
} from "../src/price.js";
import {
  configPda,
  matchPda,
  oraoNetworkStatePda,
  oraoRandomnessPda,
  playerPda,
  queuePda,
  vaultAuthorityPda,
  vaultPda,
  ORAO_VRF_PROGRAM_ID,
} from "../src/pdas.js";
import { fetchRandomnessStatus } from "../src/randomness.js";
import { PROGRAM_ID } from "../src/client.js";

const PROGRAM = new PublicKey(PROGRAM_ID);
const USER = new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR");

describe("price adapter", () => {
  it("computes exact base-unit stakes and rounds down", async () => {
    const adapter = new FixedPriceAdapter(1_000_000n, 6, 60_000, "t");
    const q = await adapter.getQuote("mint");
    // $1.00 at 1M units/USD = exactly 1M units.
    assert.equal(stakeForUsd(q, 100, q.updatedAtMs), 1_000_000n);
    // Fractional units round down, never up.
    const odd = { ...q, baseUnitsPerUsd: 999n };
    assert.equal(stakeForUsd(odd, 1, q.updatedAtMs), 9n);
  });

  it("fails closed on stale quotes", async () => {
    const adapter = new FixedPriceAdapter(1_000_000n, 6, 1000, "t");
    const q = await adapter.getQuote("mint");
    assert.throws(
      () => stakeForUsd(q, 100, q.updatedAtMs + 1001),
      StaleQuoteError
    );
    assert.ok(quoteAgeSeconds(q, q.updatedAtMs + 5000) >= 5);
  });

  it("jupiter adapter rejects bad prices and does integer math", async () => {
    const good = new JupiterPriceAdapter(6, 60_000, "https://x.test");
    const realFetch = globalThis.fetch;
    try {
      (globalThis as Record<string, unknown>).fetch = (async () =>
        new Response(JSON.stringify({ data: { MINT: { price: "0.001" } } }), {
          status: 200,
        })) as typeof fetch;
      const q = await good.getQuote("MINT");
      // $0.001/token, 6 decimals -> 1e6 * 1e9 / 1e6 = 1e9 units per USD.
      assert.equal(q.baseUnitsPerUsd, 1_000_000_000n);
      (globalThis as Record<string, unknown>).fetch = (async () =>
        new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch;
      await assert.rejects(() => good.getQuote("MINT"), StaleQuoteError);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("pda derivation", () => {
  it("is deterministic and side/sequence-unique", () => {
    const [c1] = configPda(PROGRAM);
    const [c2] = configPda(PROGRAM);
    assert.ok(c1.equals(c2));
    const [h0] = queuePda(PROGRAM, 0, 0n);
    const [h1] = queuePda(PROGRAM, 0, 1n);
    const [t0] = queuePda(PROGRAM, 1, 0n);
    assert.ok(!h0.equals(h1));
    assert.ok(!h0.equals(t0));
    const [m0] = matchPda(PROGRAM, 0n);
    const [m1] = matchPda(PROGRAM, 1n);
    assert.ok(!m0.equals(m1));
    const [p1] = playerPda(PROGRAM, USER);
    const [p2] = playerPda(PROGRAM, USER);
    assert.ok(p1.equals(p2));
    const [v] = vaultPda(PROGRAM);
    const [va] = vaultAuthorityPda(PROGRAM);
    assert.ok(!v.equals(va));
    for (const [pk] of [[c1], [h0], [m0], [p1], [v]]) {
      assert.ok(!PublicKey.isOnCurve(pk.toBytes()));
    }
  });

  it("orao addresses match known devnet deployment", () => {
    assert.equal(
      ORAO_VRF_PROGRAM_ID.toBase58(),
      "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
    );
    const [ns] = oraoNetworkStatePda();
    assert.equal(ns.toBase58(), "5ER1oENnV4srxYdAynUfRzWeQCPQaqMiAp4VqyMbSqnK");
    const seed = Buffer.alloc(32, 7);
    const [r1] = oraoRandomnessPda(seed);
    const [r2] = oraoRandomnessPda(seed);
    assert.ok(r1.equals(r2));
  });
});

describe("randomness parsing", () => {
  function fakeConnection(data: Buffer | null) {
    return {
      getAccountInfo: async () => (data ? { data } : null),
    } as never;
  }

  it("missing -> missing, short/pending -> pending", async () => {
    const seed = Buffer.alloc(32, 1);
    const missing = await fetchRandomnessStatus(fakeConnection(null), seed);
    assert.equal(missing.kind, "missing");
    const short = await fetchRandomnessStatus(
      fakeConnection(Buffer.alloc(20)),
      seed
    );
    assert.equal(short.kind, "pending");
    // Pending tag 0 with full length.
    const pending = Buffer.alloc(137);
    pending[8] = 0;
    assert.equal(
      (await fetchRandomnessStatus(fakeConnection(pending), seed)).kind,
      "pending"
    );
  });

  it("fulfilled parses the result bit", async () => {
    const seed = Buffer.alloc(32, 2);
    const heads = Buffer.alloc(137);
    heads[8] = 1;
    heads[8 + 1 + 32 + 32] = 0xfe; // bit 0
    const h = await fetchRandomnessStatus(fakeConnection(heads), seed);
    assert.equal(h.kind, "fulfilled");
    if (h.kind === "fulfilled") assert.equal(h.resultBit, 0);
    const tails = Buffer.alloc(137);
    tails[8] = 1;
    tails[8 + 1 + 32 + 32] = 0x07; // bit 1
    const t = await fetchRandomnessStatus(fakeConnection(tails), seed);
    assert.equal(t.kind, "fulfilled");
    if (t.kind === "fulfilled") assert.equal(t.resultBit, 1);
  });
});

describe("tier-scoped rooms (V2)", () => {
  it("room PDAs are tier-scoped and deterministic", async () => {
    const { roomPda } = await import("../src/pdas.js");
    const [r1a] = roomPda(PROGRAM, 1);
    const [r1b] = roomPda(PROGRAM, 1);
    const [r10] = roomPda(PROGRAM, 10);
    assert.ok(r1a.equals(r1b));
    assert.ok(!r1a.equals(r10));
  });

  it("$1 HEADS cannot share a queue address with $10 TAILS", async () => {
    const { roomQueuePda } = await import("../src/pdas.js");
    const [a] = roomQueuePda(PROGRAM, 1, 0, 0n);
    const [b] = roomQueuePda(PROGRAM, 10, 1, 0n);
    assert.ok(!a.equals(b));
  });

  it("V2 queue PDAs never collide with legacy V1 queue PDAs", async () => {
    const { roomQueuePda } = await import("../src/pdas.js");
    const [v2] = roomQueuePda(PROGRAM, 1, 0, 7n);
    const [v1] = queuePda(PROGRAM, 0, 7n);
    assert.ok(!v2.equals(v1));
  });
});

describe("playerState compatibility (V1 legacy <-> V2)", () => {
  const PLAYER = new PublicKey("5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW");

  /** Exact deployed-V1 encoding: disc + 52 bytes (no tier fields). */
  function v1Bytes(opts: { queued: boolean; side: number; seq: bigint; inMatch: boolean; matchId: bigint }): Buffer {
    const b = Buffer.alloc(60);
    Buffer.from("38033c56ae10f4c3", "hex").copy(b, 0);
    PLAYER.toBuffer().copy(b, 8);
    b[40] = opts.queued ? 1 : 0;
    b[41] = opts.side;
    b.writeBigUInt64LE(opts.seq, 42);
    b[50] = opts.inMatch ? 1 : 0;
    b.writeBigUInt64LE(opts.matchId, 51);
    b[59] = 255;
    return b;
  }

  function v2Bytes(v1: Buffer, queuedTier: number, matchTier: number): Buffer {
    const b = Buffer.alloc(62);
    v1.copy(b, 0, 0, 60);
    b[60] = queuedTier;
    b[61] = matchTier;
    return b;
  }

  it("decodes legacy V1 queued accounts as $1 (never $10)", async () => {
    const { decodePlayerStateCompat } = await import("../src/playerStateCompat.js");
    const st = decodePlayerStateCompat(
      v1Bytes({ queued: true, side: 1, seq: 18n, inMatch: false, matchId: 0n })
    );
    assert.equal(st.schema, "v1");
    assert.ok(st.player.equals(PLAYER));
    assert.equal(st.queued, true);
    assert.equal(st.queuedSide, 1);
    assert.equal(st.queuedSequence, 18n);
    assert.equal(st.inMatch, false);
    assert.equal(st.queuedTierUsd, 1);
    assert.equal(st.matchTierUsd, 0);
  });

  it("decodes legacy V1 in-match accounts as $1", async () => {
    const { decodePlayerStateCompat } = await import("../src/playerStateCompat.js");
    const st = decodePlayerStateCompat(
      v1Bytes({ queued: false, side: 0, seq: 0n, inMatch: true, matchId: 16n })
    );
    assert.equal(st.schema, "v1");
    assert.equal(st.matchId, 16n);
    assert.equal(st.matchTierUsd, 1);
    assert.equal(st.queuedTierUsd, 0);
  });

  it("decodes V2 accounts with explicit tiers", async () => {
    const { decodePlayerStateCompat } = await import("../src/playerStateCompat.js");
    const st = decodePlayerStateCompat(
      v2Bytes(v1Bytes({ queued: true, side: 0, seq: 3n, inMatch: false, matchId: 0n }), 10, 0)
    );
    assert.equal(st.schema, "v2");
    assert.equal(st.queuedTierUsd, 10);
    assert.equal(st.queuedSequence, 3n);
  });

  it("rejects wrong discriminator and unknown lengths", async () => {
    const { decodePlayerStateCompat } = await import("../src/playerStateCompat.js");
    const badDisc = v1Bytes({ queued: false, side: 0, seq: 0n, inMatch: false, matchId: 0n });
    badDisc[0] ^= 0xff;
    assert.throws(() => decodePlayerStateCompat(badDisc), /not a PlayerState/);
    assert.throws(() => decodePlayerStateCompat(Buffer.alloc(61)), /unknown PlayerState length/);
    assert.throws(() => decodePlayerStateCompat(Buffer.alloc(8)), /unknown PlayerState length/);
  });

  it("fetch returns null when missing and decodes when present", async () => {
    const { fetchPlayerStateCompat } = await import("../src/playerStateCompat.js");
    const bytes = v1Bytes({ queued: true, side: 0, seq: 20n, inMatch: false, matchId: 0n });
    const conn = {
      getAccountInfo: async (pk: PublicKey) =>
        pk.equals(PLAYER) ? { data: bytes } : null,
    } as never;
    assert.equal(await fetchPlayerStateCompat(conn, new PublicKey("9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR")), null);
    const st = await fetchPlayerStateCompat(conn, PLAYER);
    assert.ok(st && st.queued && st.schema === "v1" && st.queuedTierUsd === 1);
  });
});
