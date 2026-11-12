import assert from "node:assert/strict";
import { test } from "node:test";
import { ExpenseBudgetError, ExpensePendingError } from "@/lib/solana/expenseJournal";
import { maintenanceDeferral } from "./maintenanceOutcome";
import { recoveryHealth } from "./recoveryAuth";

test("unknown transaction outcomes defer without claiming a successful match or payout", () => {
  for (const phase of ["send", "confirmation", "storage", "outcome"] as const) {
    assert.equal(maintenanceDeferral(new ExpensePendingError(phase)), "CONFIRMATION_PENDING");
  }
  assert.equal(maintenanceDeferral(new ExpenseBudgetError()), "BUDGET_LIMIT");
});

test("temporary RPC errors are retryable, while invariant, safety and journal failures remain failures", () => {
  for (const message of ["429 rate limit", "fetch failed", "503 Service Unavailable", "request timeout"]) {
    assert.equal(maintenanceDeferral(new Error(message)), "RPC_RETRY");
  }
  for (const message of ["Wrong Devnet genesis", "SeedMismatch", "expense-identity-mismatch", "Operation journal unavailable", "matcher unavailable"]) {
    assert.equal(maintenanceDeferral(new Error(message)), undefined);
  }
});

test("five successive pending confirmations preserve a valid retryable health body", () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = recoveryHealth({
      rooms: [1, 10].map(tierUsd => ({ tierUsd, invariants: [], deferred: maintenanceDeferral(new ExpensePendingError()) })),
      settle: {errors: [], historyPending: ["908", "909"]},
      rewards: {failed: 0, errors: []},
    });
    assert.deepEqual(body, {
      status: "cron-maintained",
      rooms: [1, 10].map(tierUsd => ({tierUsd, invariants: [], deferred: "CONFIRMATION_PENDING"})),
      settle: {errors: [], historyPending: 2},
      rewards: {failed: 0, errors: []},
    });
  }
});

test("real room invariants are preserved beside a retryable transaction", () => {
  const body = recoveryHealth({
    rooms: [{tierUsd: 1, invariants: ["entry mismatch"], deferred: "CONFIRMATION_PENDING"}, {tierUsd: 10, invariants: []}],
    settle: {errors: []}, rewards: {failed: 0, errors: []},
  });
  assert.match(JSON.stringify(body), /ROOM_INVARIANT/);
});
