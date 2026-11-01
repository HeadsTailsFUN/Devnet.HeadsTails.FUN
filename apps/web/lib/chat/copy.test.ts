import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  AUTO_ONCHAIN_LABEL,
  CHAT_DISCONNECTED_COPY,
  CHAT_INPUT_PLACEHOLDER,
  GAME_STEPS,
} from "./copy.js";

describe("chat/UI copy", () => {
  it("exact disconnected copy", () => {
    assert.equal(CHAT_DISCONNECTED_COPY, "Connect Wallet to chat");
  });

  it("exact input placeholder", () => {
    assert.equal(CHAT_INPUT_PLACEHOLDER, "Say Something...");
  });

  it("game steps end in GG, never Settle", () => {
    assert.deepEqual([...GAME_STEPS], ["Pick Side", "Queue", "Match", "Flip", "GG"]);
    assert.ok(!(GAME_STEPS as readonly string[]).includes("Settle"));
  });

  it("auto on-chain label complete (no truncation)", () => {
    assert.equal(AUTO_ONCHAIN_LABEL, "Auto On-Chain");
  });
});
