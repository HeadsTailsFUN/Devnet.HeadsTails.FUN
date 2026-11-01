import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_TIER_USD,
  ROOMS,
  ROOM_ACTIVATION_COPY,
  isRoomActive,
  isRoomJoinable,
  mergeRoomLiveness,
  resolveRoomCard,
  roomForTier,
} from "./rooms.js";

describe("rooms", () => {
  it("$1 room active and default", () => {
    assert.equal(DEFAULT_TIER_USD, 1);
    assert.equal(roomForTier(1)?.label, "$1");
    assert.equal(isRoomActive(1), true);
  });

  it("$10 room designed active (real room, not fake)", () => {
    assert.equal(roomForTier(10)?.label, "$10");
    assert.equal(isRoomActive(10), true);
  });

  it("$10 pre-upgrade: activating, never OPEN, never joinable", () => {
    const card = resolveRoomCard(10, [1]);
    assert.equal(card.mode, "activating");
    assert.equal(card.note, ROOM_ACTIVATION_COPY);
    assert.equal(isRoomJoinable(10, [1]), false);
    assert.equal(isRoomJoinable(10, []), false);
  });

  it("$10 post-upgrade (room live on-chain): OPEN and joinable", () => {
    const card = resolveRoomCard(10, [1, 10]);
    assert.equal(card.mode, "open");
    assert.equal(isRoomJoinable(10, new Set([1, 10])), true);
  });

  it("failed probes keep last-known liveness (never flap live rooms)", () => {
    // First probe fails: nothing known, nothing marked live.
    const first = mergeRoomLiveness({}, [
      { tier: 1, live: null },
      { tier: 10, live: null },
    ]);
    assert.deepEqual(first.next, {});
    assert.equal(first.changed, false);
    // Probe succeeds: both tiers commit.
    const second = mergeRoomLiveness(first.next, [
      { tier: 1, live: true },
      { tier: 10, live: true },
    ]);
    assert.deepEqual(second.next, { 1: true, 10: true });
    assert.equal(second.changed, true);
    // Flaky cycle: failures keep prior values, success updates deltas only.
    const third = mergeRoomLiveness(second.next, [
      { tier: 1, live: null },
      { tier: 10, live: false },
    ]);
    assert.deepEqual(third.next, { 1: true, 10: false });
    assert.equal(third.changed, true);
    const fourth = mergeRoomLiveness(third.next, [
      { tier: 1, live: null },
      { tier: 10, live: false },
    ]);
    assert.equal(fourth.changed, false);
  });

  it("$1 requires a live on-chain room like every tier", () => {
    assert.equal(resolveRoomCard(1, []).mode, "activating");
    assert.equal(isRoomJoinable(1, []), false);
    assert.equal(resolveRoomCard(1, [1, 10]).mode, "open");
    assert.equal(isRoomJoinable(1, [1, 10]), true);
    assert.equal(isRoomJoinable(1, new Set([1])), true);
  });

  it("$1 default", () => {
    assert.equal(DEFAULT_TIER_USD, 1);
  });

  it("$100 disabled with exact Opening Soon copy", () => {
    assert.equal(isRoomActive(100), false);
    assert.equal(roomForTier(100)?.disabledLabel, "Opening Soon");
  });

  it("$1000 disabled with exact Opening Soon copy", () => {
    assert.equal(isRoomActive(1000), false);
    assert.equal(roomForTier(1000)?.disabledLabel, "Opening Soon");
  });

  it("tiers are distinct rooms (no shared identity)", () => {
    const tiers = ROOMS.map((r) => r.tierUsd);
    assert.deepEqual([...new Set(tiers)].sort((a, b) => a - b), [1, 10, 100, 1000]);
    assert.notEqual(roomForTier(1), roomForTier(10));
  });

  it("stake amount correct per room (10x)", () => {
    assert.equal(roomForTier(10)!.usdCents, roomForTier(1)!.usdCents * 10);
  });
});
