import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCONNECTED_ROOM_COPY,
  resolveRoomCardWithConnection,
} from "./rooms.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("disconnected room copy", () => {
  it("$1/$10 disconnected -> Connect Wallet", () => {
    assert.equal(
      resolveRoomCardWithConnection(1, [], false).note,
      DISCONNECTED_ROOM_COPY
    );
    assert.equal(
      resolveRoomCardWithConnection(10, [], false).note,
      DISCONNECTED_ROOM_COPY
    );
    assert.equal(DISCONNECTED_ROOM_COPY, "Connect Wallet");
  });

  it("$100/$1000 disconnected -> Opening Soon", () => {
    assert.equal(resolveRoomCardWithConnection(100, [], false).note, "Opening Soon");
    assert.equal(resolveRoomCardWithConnection(1000, [], false).note, "Opening Soon");
  });

  it("disconnected never shows Activating after upgrade", () => {
    for (const tier of [1, 10, 100, 1000]) {
      const card = resolveRoomCardWithConnection(tier, [], false);
      assert.ok(!card.note.includes("Activating"), `tier ${tier} no activating copy`);
    }
  });

  it("connected delegates to live RoomState logic", () => {
    assert.equal(resolveRoomCardWithConnection(1, [1], true).mode, "open");
    assert.equal(resolveRoomCardWithConnection(100, [1, 10], true).note, "Opening Soon");
  });

  it("StakeTierSelector passes wallet connection state", () => {
    const src = readFileSync(join(root, "components", "game", "StakeTierSelector.tsx"), "utf8");
    assert.ok(src.includes("connected"), "connected prop exists");
    assert.ok(src.includes("resolveRoomCardWithConnection"), "uses connection-aware resolver");
    const live = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(live.includes("connected={address !== null}"), "wires wallet state");
  });
});
