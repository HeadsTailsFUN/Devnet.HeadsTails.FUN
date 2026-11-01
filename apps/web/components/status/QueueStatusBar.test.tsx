/**
 * Queue Status order regression (reference image):
 * desktop left → right = TAILS WAITING | FIFO QUEUE | AUTO ON-CHAIN | HEADS WAITING.
 * Data must stay bound to the correct side.
 * Requires: node --import tsx --import ./lib/test/jsdom-setup.ts
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { render, screen, cleanup } from "@testing-library/react";
import { QueueStatusBar } from "./QueueStatusBar.js";

describe("QueueStatusBar order", () => {
  it("desktop DOM order is TAILS | FIFO | AUTO | HEADS with bound counters", () => {
    try {
      render(QueueStatusBar({ headsWaiting: 7, tailsWaiting: 3 }));
      const section = screen.getByRole("region", { name: "Queue status" });
      const text = section.textContent ?? "";
      const tailsIdx = text.indexOf("Tails Waiting");
      const fifoIdx = text.indexOf("FIFO Queue");
      const autoIdx = text.indexOf("Auto On-Chain");
      const headsIdx = text.indexOf("Heads Waiting");
      assert.ok(tailsIdx >= 0 && fifoIdx >= 0 && autoIdx >= 0 && headsIdx >= 0);
      assert.ok(tailsIdx < fifoIdx, "TAILS before FIFO");
      assert.ok(fifoIdx < autoIdx, "FIFO before AUTO");
      assert.ok(autoIdx < headsIdx, "AUTO before HEADS");
      // Counters bound to the correct side: 3 near TAILS, 7 near HEADS.
      const tailsBlock = text.slice(tailsIdx, fifoIdx);
      const headsBlock = text.slice(headsIdx);
      assert.ok(tailsBlock.includes("3"), `tails counter in tails cell, got: ${tailsBlock}`);
      assert.ok(headsBlock.includes("7"), `heads counter in heads cell, got: ${headsBlock}`);
    } finally {
      cleanup();
    }
  });
});
