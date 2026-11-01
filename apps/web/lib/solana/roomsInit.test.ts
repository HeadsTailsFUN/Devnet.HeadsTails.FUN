import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PublicKey } from "@solana/web3.js";
import {
  assertInitRoomExact,
  buildInitRoomInstruction,
  roomPdaFor,
} from "./roomsInit.js";

const PROGRAM = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
const ADMIN = new PublicKey("5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW");
const [CONFIG] = PublicKey.findProgramAddressSync([Buffer.from("hts-config")], PROGRAM);

describe("HTS room init (single-signature 1+10 HTS)", () => {
  it("room PDAs use the isolated HTS namespace and preserve legacy addresses", () => {
    for (const tier of [1, 10]) {
      const [expected] = PublicKey.findProgramAddressSync([Buffer.from("hts-room"), Buffer.from([tier])], PROGRAM);
      const [historical] = PublicKey.findProgramAddressSync([Buffer.from("room"), Buffer.from([tier])], PROGRAM);
      assert.ok(roomPdaFor(PROGRAM, tier).equals(expected));
      assert.ok(!roomPdaFor(PROGRAM, tier).equals(historical));
    }
  });

  it("init_room instructions are IDL-exact for both tiers", () => {
    for (const tierUsd of [1, 10]) {
      const ix = buildInitRoomInstruction(PROGRAM, ADMIN, CONFIG, { tierUsd, active: true });
      assert.equal(assertInitRoomExact(ix, PROGRAM, ADMIN, CONFIG, { tierUsd, active: true }), null);
      // Independently pinned Anchor init_hts_room discriminator.
      assert.deepEqual([...Buffer.from(ix.data).subarray(0, 8)], [164, 165, 150, 254, 171, 178, 112, 92]);
      assert.equal(ix.data[8], tierUsd);
      assert.equal(ix.data[9], 1);
    }
  });

  it("unsupported tiers never build", () => {
    assert.throws(
      () => buildInitRoomInstruction(PROGRAM, ADMIN, CONFIG, { tierUsd: 100, active: true }),
      /unsupported room tier/
    );
    assert.throws(
      () => buildInitRoomInstruction(PROGRAM, ADMIN, CONFIG, { tierUsd: 0, active: true }),
      /unsupported room tier/
    );
  });

  it("tampered tier/active/admin are rejected", () => {
    const ix = buildInitRoomInstruction(PROGRAM, ADMIN, CONFIG, { tierUsd: 1, active: true });
    assert.match(
      assertInitRoomExact(ix, PROGRAM, ADMIN, CONFIG, { tierUsd: 10, active: true }) ?? "",
      /tier mismatch/
    );
    assert.match(
      assertInitRoomExact(ix, PROGRAM, ADMIN, CONFIG, { tierUsd: 1, active: false }) ?? "",
      /active flag mismatch/
    );
    const stranger = new PublicKey("Dyo5Je7MHkqD66vdVi2WW4mA8asX3p6zotjo4K2mfYAx");
    assert.match(
      assertInitRoomExact(ix, PROGRAM, stranger, CONFIG, { tierUsd: 1, active: true }) ?? "",
      /pubkey mismatch/
    );
    assert.match(
      assertInitRoomExact(ix, PROGRAM, ADMIN, CONFIG, { tierUsd: 1, active: true }) ?? "ok",
      /ok/
    );
  });

  it("both room instructions compose into one transaction", () => {
    const ixs = [1, 10].map((tierUsd) =>
      buildInitRoomInstruction(PROGRAM, ADMIN, CONFIG, { tierUsd, active: true })
    );
    assert.equal(ixs.length, 2);
    for (const [i, tierUsd] of [1, 10].entries()) {
      assert.equal(
        assertInitRoomExact(ixs[i], PROGRAM, ADMIN, CONFIG, { tierUsd, active: true }),
        null
      );
    }
  });
});
