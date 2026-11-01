import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_FLIP_REVEAL_MS,
  classifyMatchObservation,
  flipRevealDelayMs,
  planVisibleReveal,
  shouldRevealFlip,
} from "./flipReveal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("minimum 5s flipping reveal", () => {
  it("constant is exactly 5000ms", () => {
    assert.equal(MIN_FLIP_REVEAL_MS, 5000);
  });

  it("result at 1s -> reveal >=5s", () => {
    const start = 0;
    const arrived = 1000;
    assert.equal(shouldRevealFlip({ flipStartedAtMs: start, resultArrivedAtMs: arrived, nowMs: 4999 }), false);
    assert.equal(shouldRevealFlip({ flipStartedAtMs: start, resultArrivedAtMs: arrived, nowMs: 5000 }), true);
    assert.equal(flipRevealDelayMs({ flipStartedAtMs: start, resultArrivedAtMs: arrived, nowMs: 1000 }), 4000);
  });

  it("result at 4.9s -> reveal >=5s", () => {
    assert.equal(shouldRevealFlip({ flipStartedAtMs: 0, resultArrivedAtMs: 4900, nowMs: 4999 }), false);
    assert.equal(shouldRevealFlip({ flipStartedAtMs: 0, resultArrivedAtMs: 4900, nowMs: 5000 }), true);
  });

  it("result at 7s -> reveal around 7s (no extra delay)", () => {
    assert.equal(shouldRevealFlip({ flipStartedAtMs: 0, resultArrivedAtMs: 7000, nowMs: 6999 }), false);
    assert.equal(shouldRevealFlip({ flipStartedAtMs: 0, resultArrivedAtMs: 7000, nowMs: 7000 }), true);
    assert.equal(flipRevealDelayMs({ flipStartedAtMs: 0, resultArrivedAtMs: 7000, nowMs: 7000 }), 0);
  });

  it("historical settled state reveals immediately (no fake animation)", () => {
    assert.equal(shouldRevealFlip({ flipStartedAtMs: null, resultArrivedAtMs: 1000, nowMs: 1000 }), true);
  });

  it("LiveGameClient presentation-only: settlement not delayed", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("MIN_FLIP_REVEAL_MS"), "uses 5s constant");
    // Settlement fires immediately even while Flipping stays visible.
    const fulfillIdx = src.indexOf("fetchRandomnessStatus");
    const ensureIdx = src.indexOf("ensureAutoSettlement", fulfillIdx);
    assert.ok(fulfillIdx > 0 && ensureIdx > fulfillIdx, "settlement triggered on fulfillment");
    // Play Again resets the timer for a fresh next match.
    assert.ok(src.includes("flipMatchIdRef"), "tracks live-round ownership per Match ID");
    assert.ok(src.includes("visibleFlipStartedAtRef"), "anchors the visible presentation start");
    assert.ok(src.includes("pendingFlip"), "stores result internally");
  });
});

describe("first-observation live-match timer (0ms-flip race)", () => {
  it("1. new live Match ID observed → ownership registered, visible timer NOT consumed by reads", () => {
    assert.equal(
      classifyMatchObservation({ trackedMatchId: null, observedMatchId: "51" }),
      "init-new-round"
    );
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    const inMatch = src.slice(src.indexOf("if (st.inMatch)"));
    const registerIdx = inMatch.indexOf("flipMatchIdRef.current = matchId.toString()");
    const fetchIdx = inMatch.indexOf("program.account.match.fetch");
    assert.ok(registerIdx > 0, "first observation registers the Match ID");
    assert.ok(fetchIdx > registerIdx, "registered BEFORE the Match fetch");
    // The visible 5000ms timer is anchored post-render, never here: no
    // pre-network timestamp may drive the reveal.
    assert.ok(!inMatch.includes("visibleFlipStartedAtRef.current = {"), "no pre-render anchor in the poll path");
    assert.ok(src.includes("VISIBLE-START ANCHOR"), "post-commit effect anchors the visible start");
  });

  it("2. first Match fetch already Settled → held 5000ms, NOT immediate", () => {
    // Observation at t=0, settled result read at t≈0: full hold remains.
    const started = 1000;
    const now = 1000;
    assert.equal(flipRevealDelayMs({ flipStartedAtMs: started, resultArrivedAtMs: now, nowMs: now }), 5000);
    assert.equal(shouldRevealFlip({ flipStartedAtMs: started, resultArrivedAtMs: now, nowMs: now + 4999 }), false);
    assert.equal(shouldRevealFlip({ flipStartedAtMs: started, resultArrivedAtMs: now, nowMs: now + 5000 }), true);
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    // The settled branch holds via the visible anchor; an unanchored first
    // observation stores + commits flipping for the effect to anchor.
    assert.ok(src.includes("anchoredForMatch"), "settled branch resolves the visible anchor");
    assert.ok(src.includes("planVisibleReveal"), "reveal planned from the visible start");
  });

  it("3. first ORAO read already fulfilled → result held until 5000ms", () => {
    const started = 2000;
    const now = 2000;
    assert.equal(flipRevealDelayMs({ flipStartedAtMs: started, resultArrivedAtMs: now, nowMs: now }), 5000);
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    const inMatch = src.slice(src.indexOf("if (st.inMatch)"));
    const holdIdx = inMatch.indexOf("holdAndReveal(resultSide, iWon, false)");
    const initIdx = inMatch.indexOf("flipMatchIdRef.current = matchId.toString()");
    assert.ok(holdIdx > initIdx, "fulfilled path runs after timer init, so the hold applies");
  });

  it("4. normal WaitingForRandomness path preserved", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes('setLiveState(fresh ? "match-found" : "flipping")'), "match-found/flipping flow kept");
    assert.ok(src.includes('setDetail("Flipping...")'), "flipping detail kept");
  });

  it("5. repeated polls for same Match ID → timer NOT restarted", () => {
    assert.equal(
      classifyMatchObservation({ trackedMatchId: "51", observedMatchId: "51" }),
      "same-round"
    );
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(
      src.includes('classifyMatchObservation({ trackedMatchId: flipMatchIdRef.current'),
      "init guarded by ID comparison (no per-poll reset)"
    );
  });

  it("6. new Match ID → fresh timer starts", () => {
    assert.equal(
      classifyMatchObservation({ trackedMatchId: "50", observedMatchId: "51" }),
      "init-new-round"
    );
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("flipMatchIdRef.current = null"), "round resets release the timer owner");
  });

  it("7. historical settled match without active PlayerState → no fake animation", () => {
    // Pure helper: null start still means immediate (unchanged semantics).
    assert.equal(shouldRevealFlip({ flipStartedAtMs: null, resultArrivedAtMs: 1000, nowMs: 1000 }), true);
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    const inMatchIdx = src.indexOf("if (st.inMatch)");
    const initIdx = src.indexOf("flipMatchIdRef.current = matchId.toString()");
    assert.ok(initIdx > inMatchIdx, "timer init lives ONLY inside the authoritative inMatch branch");
  });

  it("8. settlement before reveal → chain proceeds immediately, UI stays delayed", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    const inMatch = src.slice(src.indexOf("if (st.inMatch)"));
    // Fire-and-forget settlement precedes the presentation hold in program order.
    const ensureIdx = inMatch.indexOf("void ensureAutoSettlement(matchId.toString())");
    const holdIdx = inMatch.indexOf("holdAndReveal(resultSide, iWon, false)");
    assert.ok(ensureIdx > 0 && holdIdx > ensureIdx, "settlement first, presentation hold second");
    assert.ok(inMatch.includes("chain work is never delayed by the 5s presentation"), "intent documented");
  });

  it("9. match #50 stale-label regression → ready+label can never disagree", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    assert.ok(src.includes("decideIdleRefresh"), "idle polls use the single decision point");
    assert.ok(src.includes("idle-pending-reveal-hold"), "pending reveal holds Flipping");
  });

  it("visible planner: 1500ms pre-render latency still yields full 5000ms visible", () => {
    // Match #52 fast case: observed at t=0, fetch resolves at t=1500,
    // Flipping commits right after. Timer runs from the visible commit.
    const p = planVisibleReveal({ visibleStartedAtMs: 1500, resultArrivedAtMs: 1500, nowMs: 1500 });
    assert.equal(p.delayMs, 5000);
    assert.equal(p.revealAtMs, 6500);
  });

  it("visible planner: late arrival waits only the remainder", () => {
    const p = planVisibleReveal({ visibleStartedAtMs: 0, resultArrivedAtMs: 2000, nowMs: 2000 });
    assert.equal(p.delayMs, 3000);
  });

  it("visible planner: arrival after 5s visible reveals immediately", () => {
    const p = planVisibleReveal({ visibleStartedAtMs: 0, resultArrivedAtMs: 6000, nowMs: 6000 });
    assert.equal(p.delayMs, 0);
  });

  it("10. polling cannot resurrect old state (timer owner released on reset)", () => {
    const src = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    // Every full round reset releases the timer owner, so a later poll for
    // a new match always re-initializes instead of inheriting a stale start.
    const resets = (src.match(/flipMatchIdRef\.current = null/g) ?? []).length;
    assert.ok(resets >= 2, `reset paths release ownership (found ${resets})`);
  });
});
