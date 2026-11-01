import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  checkFifoPlan,
  clearCrankLocksForTests,
  decideCrankReadiness,
  isBenignRaceError,
  isTransientCrankError,
  releaseCrankLock,
  sanitizeCrankRequest,
  tryAcquireCrankLock,
} from "./matchCrank.js";
import {
  EXPECTED_SPONSOR_PUBKEY,
  evaluateSponsorGate,
  isUserReimbursableAction,
} from "./sponsorGate.js";

const HEADS_ENTRY = {
  address: "He1111111111111111111111111111111111111111",
  side: 0,
  sequence: BigInt(7),
  status: "Active",
  player: "AAA1111111111111111111111111111111111111111",
};
const TAILS_ENTRY = {
  address: "Te1111111111111111111111111111111111111111",
  side: 1,
  sequence: BigInt(6),
  status: "Active",
  player: "BBB1111111111111111111111111111111111111111",
};
const HEADS_STATE = {
  address: "Hs1111111111111111111111111111111111111111",
  player: HEADS_ENTRY.player,
  queued: true,
  queuedSide: 0,
  queuedSequence: BigInt(7),
};
const TAILS_STATE = {
  address: "Ts1111111111111111111111111111111111111111",
  player: TAILS_ENTRY.player,
  queued: true,
  queuedSide: 1,
  queuedSequence: BigInt(6),
};
const BASE = {
  headsHead: BigInt(7),
  tailsHead: BigInt(6),
  totalMatches: BigInt(7),
  headsEntry: HEADS_ENTRY,
  tailsEntry: TAILS_ENTRY,
  headsState: HEADS_STATE,
  tailsState: TAILS_STATE,
};

describe("match crank readiness", () => {
  it("1. both queue heads present -> ready to construct matchNext", () => {
    assert.equal(
      decideCrankReadiness({ paused: false, headsWaiting: BigInt(1), tailsWaiting: BigInt(1) }),
      "ready"
    );
    const r = checkFifoPlan(BASE);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.plan.matchId, BigInt(7));
  });

  it("2. only one side present -> no transaction", () => {
    assert.equal(
      decideCrankReadiness({ paused: false, headsWaiting: BigInt(0), tailsWaiting: BigInt(1) }),
      "empty"
    );
    assert.equal(
      decideCrankReadiness({ paused: false, headsWaiting: BigInt(2), tailsWaiting: BigInt(0) }),
      "empty"
    );
  });

  it("paused -> no transaction", () => {
    assert.equal(
      decideCrankReadiness({ paused: true, headsWaiting: BigInt(1), tailsWaiting: BigInt(1) }),
      "paused"
    );
  });

  it("3. stale match id (sequence moved) -> re-read/reconcile, no send", () => {
    const r = checkFifoPlan({ ...BASE, headsHead: BigInt(8) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /sequence moved|not active|mismatch/);
  });
});

describe("crank race safety", () => {
  it("4. simultaneous crank requests -> at most one holds the lock", () => {
    clearCrankLocksForTests();
    assert.equal(tryAcquireCrankLock("match:7", 1000), true);
    assert.equal(tryAcquireCrankLock("match:7", 1001), false);
    releaseCrankLock("match:7");
    assert.equal(tryAcquireCrankLock("match:7", 1002), true);
    releaseCrankLock("match:7");
  });

  it("lock expires after TTL", () => {
    clearCrankLocksForTests();
    assert.equal(tryAcquireCrankLock("match:9", 0), true);
    assert.equal(tryAcquireCrankLock("match:9", 30_001), true);
    releaseCrankLock("match:9");
  });

  it("race errors are benign (refresh to Match Found, no user error)", () => {
    for (const m of ["InvalidHeadEntry", "HeadNotActive", "EntryNotActive", "AlreadyMatched"]) {
      assert.equal(isBenignRaceError(`AnchorError ... ${m} ...`), true);
    }
    assert.equal(isBenignRaceError("429 rate limit"), false);
  });

  it("transient errors are retryable, not races", () => {
    assert.equal(isTransientCrankError("429 Connection rate limits exceeded"), true);
    assert.equal(isTransientCrankError("InvalidHeadEntry"), false);
  });
});

describe("client cannot choose crank parameters", () => {
  it("5. client cannot choose match id", () => {
    const { ignored } = sanitizeCrankRequest({ matchId: "999", match_id: 999 });
    assert.deepEqual(ignored.sort(), ["matchId", "match_id"]);
  });

  it("6. client cannot choose players", () => {
    const { ignored } = sanitizeCrankRequest({
      players: ["X"],
      player: "X",
      headsState: "X",
      tailsState: "X",
      headsEntry: "X",
      tailsEntry: "X",
    });
    assert.equal(ignored.length, 6);
  });

  it("7. client cannot choose randomness", () => {
    const { ignored } = sanitizeCrankRequest({ randomness: "X", seed: "e30=" });
    assert.deepEqual(ignored.sort(), ["randomness", "seed"]);
  });

  it("8. client cannot choose ORAO treasury", () => {
    const { ignored } = sanitizeCrankRequest({ treasury: "X", vrfTreasury: "X" });
    assert.deepEqual(ignored.sort(), ["treasury", "vrfTreasury"]);
  });

  it("empty/missing body is the only valid request", () => {
    assert.deepEqual(sanitizeCrankRequest(null), { ignored: [] });
    assert.deepEqual(sanitizeCrankRequest({}), { ignored: [] });
    assert.deepEqual(sanitizeCrankRequest("attempt"), { ignored: [] });
  });

  it("10b. client cannot choose caller/payer (user is NOT Match payer)", () => {
    const { ignored } = sanitizeCrankRequest({
      caller: "X",
      payer: "X",
      feePayer: "X",
      requester: "X",
    });
    assert.deepEqual(ignored.sort(), ["caller", "feePayer", "payer", "requester"]);
  });

  it("15. ORAO refund returns to sponsor requester (caller fixed to pinned sponsor)", () => {
    // The crank builds matchNext with caller = pinned sponsor signer only;
    // no request field selects the caller (see 10b), so the VRF requester —
    // and therefore the ORAO refund recipient — is always the sponsor.
    assert.equal(EXPECTED_SPONSOR_PUBKEY.length >= 32, true);
    const { ignored } = sanitizeCrankRequest({ caller: EXPECTED_SPONSOR_PUBKEY });
    assert.deepEqual(ignored, ["caller"]);
  });
});

describe("sponsor is only caller/payer", () => {
  it("9. sponsor signer identity is pinned server-side", () => {
    assert.equal(EXPECTED_SPONSOR_PUBKEY, "FwP4JekrFhJ2PksQXdi4DhiPTfVvYTkgpnjJTwaW2nY8");
  });

  it("10. plan chooses nothing: no payer/winner/result/stake fields", () => {
    const r = checkFifoPlan(BASE);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(Object.keys(r.plan).sort(), [
        "headsEntry",
        "headsState",
        "matchId",
        "tailsEntry",
        "tailsState",
      ]);
    }
  });

  it("Anchor-shaped lowercase statuses behave identically (live-decoder shape)", () => {
    const lower = {
      ...BASE,
      headsEntry: { ...HEADS_ENTRY, status: "active" },
      tailsEntry: { ...TAILS_ENTRY, status: "active" },
    };
    const r = checkFifoPlan(lower);
    assert.equal(r.ok, true);
    const cancelled = checkFifoPlan({
      ...BASE,
      tailsEntry: { ...TAILS_ENTRY, status: "cancelled" },
    });
    assert.equal(cancelled.ok, false);
    const matched = checkFifoPlan({
      ...BASE,
      headsEntry: { ...HEADS_ENTRY, status: "matched" },
    });
    assert.equal(matched.ok, false);
  });

  it("16. FIFO enforced: wrong side / inactive / mismatch rejected", () => {
    assert.equal(
      checkFifoPlan({ ...BASE, headsEntry: { ...HEADS_ENTRY, side: 1 } }).ok,
      false
    );
    assert.equal(
      checkFifoPlan({ ...BASE, tailsEntry: { ...TAILS_ENTRY, status: "Matched" } }).ok,
      false
    );
    assert.equal(
      checkFifoPlan({ ...BASE, headsState: { ...HEADS_STATE, queued: false } }).ok,
      false
    );
    assert.equal(
      checkFifoPlan({
        ...BASE,
        headsEntry: { ...HEADS_ENTRY, player: TAILS_ENTRY.player },
        headsState: { ...HEADS_STATE, player: TAILS_ENTRY.player },
        tailsEntry: { ...TAILS_ENTRY, player: TAILS_ENTRY.player },
      }).ok,
      false
    );
  });

  it("17. plan carries no winner/result", () => {
    const r = checkFifoPlan(BASE);
    assert.equal(r.ok, true);
    if (r.ok) {
      const s = JSON.stringify(r.plan, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      assert.ok(!s.includes("winner") && !s.includes("result"));
    }
  });
});

describe("user match reimbursement removed", () => {
  it("11. user action=match reimbursement rejected", () => {
    assert.equal(isUserReimbursableAction("match"), false);
  });

  it("12/13/14. Only Join/Cancel reimbursable (match/claim/settle are server-settled)", () => {
    assert.equal(isUserReimbursableAction("join"), true);
    assert.equal(isUserReimbursableAction("cancel"), true);
    assert.equal(isUserReimbursableAction("claim"), false);
    assert.equal(isUserReimbursableAction("settle"), false);
    assert.equal(isUserReimbursableAction("drain"), false);
  });
});

describe("crank mainnet safety", () => {
  it("18. Mainnet fails closed (same gates as sponsor)", () => {
    assert.equal(
      evaluateSponsorGate({ cluster: "mainnet-beta", sponsorEnabled: "true", mainnetRealValue: "false" })
        .ok,
      false
    );
    assert.equal(
      evaluateSponsorGate({ cluster: "devnet", sponsorEnabled: "true", mainnetRealValue: "true" }).ok,
      false
    );
    assert.equal(
      evaluateSponsorGate({ cluster: "devnet", sponsorEnabled: "true", mainnetRealValue: "false" }).ok,
      true
    );
  });
});
