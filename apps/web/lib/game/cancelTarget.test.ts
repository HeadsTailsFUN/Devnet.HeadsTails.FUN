import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { queuePda, roomQueuePda } from "@heads-or-tails/game-sdk";
import { cancelMethodFor, classifyCancelTarget } from "./cancelTarget.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROGRAM = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");

describe("cancel target resolution (legacy compatibility)", () => {
  it("V2 $1 queued user derives the tier-1 room PDA + room cancel", () => {
    const t = classifyCancelTarget({
      schema: "v2",
      queuedTierUsd: 1,
      queuedSide: 1,
      queuedSequence: BigInt(9),
    });
    assert.deepEqual(t, { kind: "room", tierUsd: 1 });
    assert.equal(cancelMethodFor(t!), "cancelQueueEntryRoom");
    const [room] = roomQueuePda(PROGRAM, 1, 1, BigInt(9));
    const [legacy] = queuePda(PROGRAM, 1, BigInt(9));
    assert.notEqual(
      room.toBase58(),
      legacy.toBase58(),
      "room PDA is never the legacy PDA",
    );
  });

  it("V2 $10 queued user derives the tier-10 room PDA + room cancel", () => {
    const t = classifyCancelTarget({
      schema: "v2",
      queuedTierUsd: 10,
      queuedSide: 0,
      queuedSequence: BigInt(5),
    });
    assert.deepEqual(t, { kind: "room", tierUsd: 10 });
    assert.equal(cancelMethodFor(t!), "cancelQueueEntryRoom");
    const [room] = roomQueuePda(PROGRAM, 10, 0, BigInt(5));
    const [legacy] = queuePda(PROGRAM, 0, BigInt(5));
    assert.notEqual(room.toBase58(), legacy.toBase58());
  });

  it("legacy queued user (V1 layout) derives the legacy global PDA + legacy cancel", () => {
    // Compat normalizes queued V1 to tier 1 — schema is the signal, not tier.
    const t = classifyCancelTarget({
      schema: "v1",
      queuedTierUsd: 1,
      queuedSide: 1,
      queuedSequence: BigInt(19),
    });
    assert.deepEqual(t, { kind: "legacy" });
    assert.equal(cancelMethodFor(t!), "cancelQueueEntry");
    const [legacy] = queuePda(PROGRAM, 1, BigInt(19));
    assert.equal(
      legacy.toBase58(),
      "C8BUjDuB7rFr2NbyDYWbDpFeeCVc49EzjrvAtYDHa19c",
      "exact live dadmehr PDA",
    );
    const [room] = roomQueuePda(PROGRAM, 1, 1, BigInt(19));
    assert.notEqual(
      legacy.toBase58(),
      room.toBase58(),
      "legacy user MUST NOT derive a room PDA",
    );
  });

  it("safety: V2 users never resolve legacy, legacy never resolves room", () => {
    assert.equal(
      classifyCancelTarget({
        schema: "v2",
        queuedTierUsd: 1,
        queuedSide: 0,
        queuedSequence: BigInt(1),
      })?.kind,
      "room",
    );
    assert.equal(
      classifyCancelTarget({
        schema: "v1",
        queuedTierUsd: 0,
        queuedSide: 0,
        queuedSequence: BigInt(1),
      })?.kind,
      "legacy",
    );
    assert.equal(
      classifyCancelTarget({
        schema: "v2",
        queuedTierUsd: 0,
        queuedSide: 0,
        queuedSequence: BigInt(1),
      }),
      null,
    );
  });

  it("no legacy Join or legacy Match restored in product code", () => {
    const client = readFileSync(
      join(root, "components", "game", "LiveGameClient.tsx"),
      "utf8",
    );
    assert.ok(!/\.joinQueue\(/.test(client), "no legacy joinQueue call");
    assert.ok(!/\.matchNext\(/.test(client), "no legacy matchNext call");
    assert.ok(!/\.advanceHead\(/.test(client), "no legacy advanceHead call");
    // Historical refunds are isolated from the current HTS join/cancel flow.
    const legacy = readFileSync(
      join(root, "components", "game", "LegacyPositionNotice.tsx"),
      "utf8",
    );
    assert.ok(
      legacy.includes("buildLegacyRefund"),
      "owner-clicked legacy refund retained",
    );
    assert.ok(
      client.includes("LegacyPositionNotice"),
      "legacy position guard retained",
    );
    assert.ok(
      readFileSync(
        join(root, "..", "..", "packages", "game-sdk", "src", "legacyExit.ts"),
        "utf8",
      ).includes("migratePlayerState"),
      "migration pre-step retained",
    );
  });

  it("keeper never touches the legacy global pool", () => {
    const keep = readFileSync(
      join(root, "lib", "server", "maintainRoom.ts"),
      "utf8",
    );
    assert.ok(keep.includes("roomQueuePda"), "V2 room PDAs only");
    assert.ok(
      !/[^e]queuePda\(/.test(keep.replace(/roomQueuePda\(/g, "")),
      "no legacy queuePda use",
    );
    assert.ok(
      !/cancelQueueEntry\(/.test(keep),
      "no cancel of any kind in keeper",
    );
    assert.ok(!/\.matchNext\(/.test(keep), "no legacy match in keeper");
  });
});
