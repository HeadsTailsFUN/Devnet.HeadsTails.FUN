import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PublicKey } from "@solana/web3.js";
import {
  fetchUserQueuePosition,
  isActiveEntryData,
  QUEUE_ENTRY_LEN,
} from "./queueSnapshot.js";

const PROGRAM = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");

function entryBytes(status: number): Uint8Array {
  const b = Buffer.alloc(QUEUE_ENTRY_LEN);
  b[65] = status;
  return new Uint8Array(b);
}

describe("queue snapshot decoding", () => {
  it("detects Active status byte (0), rejects others/short/missing", () => {
    assert.equal(isActiveEntryData(entryBytes(0)), true);
    assert.equal(isActiveEntryData(entryBytes(1)), false);
    assert.equal(isActiveEntryData(entryBytes(2)), false);
    assert.equal(isActiveEntryData(new Uint8Array(10)), false);
    assert.equal(isActiveEntryData(null), false);
    assert.equal(isActiveEntryData(undefined), false);
  });
});

describe("user queue position", () => {
  function fakeConnection(datas: Array<Uint8Array | null>) {
    return {
      getMultipleAccountsInfo: async () =>
        datas.map((d) => (d ? { data: d } : null)),
    } as never;
  }

  it("counts active entries ahead + 1", async () => {
    // head..user = 3 entries, first two active -> position 3.
    const r = await fetchUserQueuePosition(
      fakeConnection([entryBytes(0), entryBytes(0), entryBytes(0)]),
      PROGRAM,
      0,
      BigInt(7),
      BigInt(5)
    );
    assert.deepEqual(r, { position: 3 });
  });

  it("skips cancelled holes ahead", async () => {
    // seq5 cancelled, seq6 active, user seq7 -> position 2.
    const r = await fetchUserQueuePosition(
      fakeConnection([entryBytes(1), entryBytes(0), entryBytes(0)]),
      PROGRAM,
      0,
      BigInt(7),
      BigInt(5)
    );
    assert.deepEqual(r, { position: 2 });
  });

  it("unknown when unreadable or out of scan range", async () => {
    const missing = await fetchUserQueuePosition(
      fakeConnection([null, entryBytes(0)]),
      PROGRAM,
      0,
      BigInt(6),
      BigInt(5)
    );
    assert.deepEqual(missing, { unknown: true });
    const far = await fetchUserQueuePosition(
      fakeConnection([]),
      PROGRAM,
      0,
      BigInt(500),
      BigInt(0)
    );
    assert.deepEqual(far, { unknown: true });
  });
});
