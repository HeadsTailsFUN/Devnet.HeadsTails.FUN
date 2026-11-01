import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  indexSettlementSignature,
  isMissingColumnError,
  stripV3Columns,
} from "./indexSettlement.js";

const PROGRAM = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
const HEADS_WALLET = new PublicKey("HCtvTxUW3DXiBMZgrh17ds8xzqKdJwtkxNC5YMHFXr4B");
const TAILS_WALLET = new PublicKey("5PRgybsoa2CyWTgsfbGF7jHx2zAshsVfgXE942phHk6D");
const MINT = new PublicKey("BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh");

// Real MatchSettled event log line from Devnet settlement tx 2jCbnrzD… (match 17).
const EVENT_LOG =
  "Program data: 88mGl8GD35YRAAAAAAAAAAFBLXEUXiVXh8pPptv8ZSkqhHReoUrXQYuC7daiF/HLWoCEHgAAAAAA1B4OHgAAAAA=";

function disc(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function configBuffer(): Buffer {
  const b = Buffer.alloc(117);
  disc("GameConfig").copy(b, 0);
  new PublicKey("5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW").toBuffer().copy(b, 8);
  MINT.toBuffer().copy(b, 40);
  b[72] = 0;
  b[73] = 1;
  b.writeBigUInt64LE(BigInt(20), 74);
  b.writeBigUInt64LE(BigInt(21), 82);
  b.writeBigUInt64LE(BigInt(18), 90);
  b.writeBigUInt64LE(BigInt(19), 98);
  b.writeBigUInt64LE(BigInt(18), 106);
  b[114] = 1;
  b[115] = 1;
  b[116] = 1;
  return b;
}

function matchBuffer(): Buffer {
  const b = Buffer.alloc(191);
  disc("Match").copy(b, 0);
  b.writeBigUInt64LE(BigInt(17), 8);
  HEADS_WALLET.toBuffer().copy(b, 16);
  TAILS_WALLET.toBuffer().copy(b, 48);
  b.writeBigUInt64LE(BigInt(1000000), 80);
  b.writeBigUInt64LE(BigInt(1000000), 88);
  b.writeBigUInt64LE(BigInt(2000000), 96);
  b[104] = 1;
  b.writeBigUInt64LE(BigInt(504241800), 105);
  b[113] = 1; // Settled
  Buffer.alloc(32, 7).copy(b, 114);
  b[146] = 1; // result Some
  b[147] = 1; // Tails
  b[148] = 1; // winner Some
  TAILS_WALLET.toBuffer().copy(b, 149);
  b[181] = 1; // settled_slot Some
  b.writeBigUInt64LE(BigInt(504241876), 182);
  b[190] = 255;
  return b;
}

function fakeConnection() {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM);
  return {
    getTransaction: async () => ({
      slot: 504241876,
      blockTime: 1750000000,
      meta: {
        err: null,
        logMessages: [
          "Program AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k invoke [1]",
          "Program log: Instruction: SettleMatch",
          EVENT_LOG,
          "Program AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k success",
        ],
      },
    }),
    getAccountInfo: async (pk: PublicKey) => {
      const data = pk.equals(config) ? configBuffer() : matchBuffer();
      return { data, executable: false, lamports: 1000000, owner: PROGRAM, rentEpoch: 0 };
    },
    getMultipleAccountsInfo: async (keys: PublicKey[]) => {
      const id=Buffer.alloc(8);id.writeBigUInt64LE(BigInt(17));
      const legacyMatch=PublicKey.findProgramAddressSync([Buffer.from("match"),id],PROGRAM)[0];
      return keys.map(pk=>pk.equals(legacyMatch)?{data:matchBuffer(),executable:false,lamports:1000000,owner:PROGRAM,rentEpoch:0}:null);
    },
    getAccountInfoAndContext: async (pk: PublicKey) => {
      const data = pk.equals(config) ? configBuffer() : matchBuffer();
      return {
        context: { slot: 1 },
        value: { data, executable: false, lamports: 1000000, owner: PROGRAM, rentEpoch: 0 },
      };
    },
  } as never;
}

function fakeDb(mode: "full-ok" | "missing-v3-columns" | "always-fail") {
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        seen.push(row);
        if (mode === "full-ok") return { error: null };
        if (mode === "always-fail") return { error: { code: "500", message: "boom" } };
        if ("match_pda" in row) {
          return { error: { code: "42703", message: "column matches.match_pda does not exist" } };
        }
        return { error: null };
      },
    }),
  } as never;
}

describe("indexSettlement", () => {
  it("missing-column detection and V3 stripping are pure", () => {
    assert.equal(isMissingColumnError({ code: "42703", message: "x" }), true);
    assert.equal(isMissingColumnError({ code: "PGRST204", message: "x" }), true);
    assert.equal(isMissingColumnError({ message: "column matches.match_pda does not exist" }), true);
    assert.equal(
      isMissingColumnError({ message: "Could not find the 'match_pda' column of 'matches' in the schema cache" }),
      true
    );
    assert.equal(isMissingColumnError({ message: "boom" }), false);
    assert.equal(isMissingColumnError(null), false);
    const stripped = stripV3Columns({ a: 1, match_pda: "x", settlement_signature: "y", tier_usd: 1 });
    assert.deepEqual(stripped, { a: 1, tier_usd: 1 });
  });

  it("full schema indexes with verification links, not degraded", async () => {
    const db = fakeDb("full-ok");
    const out = await indexSettlementSignature(fakeConnection(), db, PROGRAM, "devnet", "sig");
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.deepEqual(out.matches, ["17"]);
      assert.equal(out.degraded ?? false, false);
    }
    const row = (db as unknown as { seen: Array<Record<string, unknown>> }).seen[0];
    assert.equal(row.onchain_match_id, "17");
    assert.equal(row.tier_usd, 1);
    assert.equal(row.result, "TAILS");
    assert.ok(typeof row.match_pda === "string" && typeof row.randomness_account === "string");
  });

  it("pre-V3 schema falls back to base columns and flags degraded", async () => {
    const db = fakeDb("missing-v3-columns");
    const out = await indexSettlementSignature(fakeConnection(), db, PROGRAM, "devnet", "sig");
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.deepEqual(out.matches, ["17"]);
      assert.equal(out.degraded, true);
    }
    const seen = (db as unknown as { seen: Array<Record<string, unknown>> }).seen;
    assert.equal(seen.length, 2);
    assert.ok(!("match_pda" in seen[1]));
    assert.equal(seen[1].tier_usd, 1);
  });

  it("persistent failure surfaces a reason instead of a bare message", async () => {
    const db = fakeDb("always-fail");
    const out = await indexSettlementSignature(fakeConnection(), db, PROGRAM, "devnet", "sig");
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.match(out.error, /upsert failed/);
    }
  });
});

