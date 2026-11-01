import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decideIdleRefresh, shouldClearStaleMatchId } from "./matchLabel.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Stale-match-label regression (UI state bug, verified gameplay untouched):
 * after some settled matches the UI returned to `Pick a side` while the old
 * `MATCH #…` label stayed visible. Root cause: the refresh idle branch
 * (PlayerState idle post-settlement, or a missed settled inMatch window)
 * never cleared `activeMatchId` — only the missing-account/queued/Play
 * Again paths did.
 */

describe("shouldClearStaleMatchId truth table", () => {
  it("idle + no result + no reveal → clear (missed-window stale label)", () => {
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: false,
        resultAnchored: false,
        newRoundStarted: false,
      }),
      true
    );
  });

  it("in-flight flip reveal → keep (Match Found / Flipping)", () => {
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: true,
        resultAnchored: false,
        newRoundStarted: false,
      }),
      false
    );
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: true,
        resultAnchored: true,
        newRoundStarted: false,
      }),
      false
    );
  });

  it("intentional result screen for this match → keep until Play Again", () => {
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: false,
        resultAnchored: true,
        newRoundStarted: false,
      }),
      false
    );
  });

  it("new round started → clear even when a result is anchored", () => {
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: false,
        resultAnchored: true,
        newRoundStarted: true,
      }),
      true
    );
    assert.equal(
      shouldClearStaleMatchId({
        pendingRevealInFlight: false,
        resultAnchored: false,
        newRoundStarted: true,
      }),
      true
    );
  });
});

describe("LiveGameClient match-label lifecycle", () => {
  const src = (): string =>
    readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");

  it("1. settled → result visible → Match ID still valid (anchor guard)", () => {
    const s = src();
    assert.ok(s.includes("decideIdleRefresh"), "idle branch uses the single decision point");
    assert.ok(s.includes("resultAnchored"), "result anchoring checked");
    assert.ok(
      s.includes("completedRound.matchId === activeMatchIdRef.current"),
      "anchor binds the completed round to the same match ID"
    );
  });

  it("2. UI resets to Pick a side → old Match label gone (idle clears)", () => {
    const s = src();
    // The idle branch (no queue/match position) applies the decision result.
    assert.ok(s.includes("if (decision.clearMatchId) setActiveMatchId(null)"), "idle branch clears stale ID");
  });

  it("3. Play Again → old Match label gone", () => {
    const s = src();
    // Play Again shares resetRoundState (same clean ready as auto-Ready).
    const playAgain = s.slice(s.indexOf("const handlePlayAgain = useCallback("));
    assert.ok(playAgain.includes("resetRoundState()"), "Play Again uses the shared reset");
    const reset = s.slice(s.indexOf("const resetRoundState = useCallback("));
    assert.ok(reset.includes("setActiveMatchId(null)"), "reset clears the label");
    assert.ok(reset.includes("setLastCompleted(null)"), "reset clears the result");
  });

  it("4. polling refresh cannot resurrect a stale Match ID", () => {
    const s = src();
    // Exactly one non-null setter exists: the live inMatch chain branch.
    const total = (s.match(/setActiveMatchId\(/g) ?? []).length;
    const nulls = (s.match(/setActiveMatchId\(null\)/g) ?? []).length;
    assert.equal(total - nulls, 1, "exactly one non-null setter (all others clear)");
    assert.ok(s.includes("setActiveMatchId(matchId.toString())"), "the setter uses the live chain match ID");
    assert.ok(s.includes("if (st.inMatch)"), "setter lives in the inMatch branch");
  });

  it("5. new match shows only the new Match ID (overwrite, never append)", () => {
    const s = src();
    assert.ok(
      s.includes("const matchLabel = activeMatchId !== null ? `MATCH #${activeMatchId}` : undefined"),
      "single label derived from the single active ID"
    );
  });

  it("Match Found / Flipping / Result never clear the ID early", () => {
    const s = src();
    for (const fn of ["holdAndReveal", "revealFlipResult"]) {
      const body = s.slice(s.indexOf(`const ${fn} =`), s.indexOf(`const ${fn} =`) + 3000);
      assert.ok(!body.includes("setActiveMatchId(null)"), `${fn} preserves the label`);
    }
  });
});

describe("match #50 flash race (idle observed before delayed reveal fires)", () => {
  it("2. chain settles while reveal pending → hold Flipping, keep ID (never Pick a side + old label)", () => {
    // Exact live timing: ORAO fulfilled → 5s timer pending → settlement
    // lands → poll sees idle PlayerState → (old code: ready flash) →
    // ~2s later the timer reveals the result.
    const d = decideIdleRefresh({
      pendingRevealInFlight: true,
      resultAnchored: false,
      newRoundStarted: false,
    });
    assert.equal(d.presentation, "hold-flipping", "ready transition suppressed");
    assert.equal(d.clearMatchId, false, "label kept for the imminent reveal");
  });

  it("3. pending result exists → intermediate presentation stays coherent", () => {
    const s = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    // All three no-position branches hold instead of committing ready.
    for (const reason of [
      "idle-pending-reveal-hold",
      "no-account-pending-reveal-hold",
      "no-state-pending-reveal-hold",
    ]) {
      assert.ok(s.includes(reason), `hold traced: ${reason}`);
    }
    // NOTE: \r? — source files may carry CRLF line endings.
    const holds = (s.match(/setLiveState\("flipping"\);\r?\n\s+setDetail\("Flipping\.\.\."\);\r?\n\s+return;/g) ?? []).length;
    assert.ok(holds >= 3, `three hold paths enforce Flipping + early return (found ${holds})`);
  });

  it("4. result appears → timer reveal path untouched by the hold", () => {
    const s = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    // Hold paths return without touching the pending timer, so the delayed
    // reveal still fires with the correct match ID and result.
    const timer = s.slice(s.indexOf("flipTimerRef.current = setTimeout"));
    assert.ok(timer.includes("revealFlipResult(p.matchId, p.resultSide, p.iWon, p.settled)"), "timer reveals");
    const reveal = s.slice(s.indexOf("const revealFlipResult ="));
    assert.ok(reveal.includes("setLastCompleted({ matchId, result: resultSide, iWon })"), "reveal records");
  });

  it("5. UI eventually returns to ready → old Match ID already cleared", () => {
    // After the reveal + Play Again (or a missed window with no anchor),
    // the next idle poll proceeds to ready AND clears together — the two
    // states can never disagree.
    const d = decideIdleRefresh({
      pendingRevealInFlight: false,
      resultAnchored: false,
      newRoundStarted: false,
    });
    assert.equal(d.presentation, "proceed-ready");
    assert.equal(d.clearMatchId, true, "ready and cleared atomically in one poll");
  });

  it("hold is bounded: pending implies a live timer (no infinite Flipping)", () => {
    const s = readFileSync(join(root, "components", "game", "LiveGameClient.tsx"), "utf8");
    // Pending is stored in holdAndReveal; the single scheduling point
    // (scheduleFlipReveal, called from the visible-start anchor and the
    // anchored reschedule) always arms flipTimerRef alongside it, and every
    // clear path nulls both — so hold-flipping always resolves.
    assert.ok(s.includes("pendingFlipRef.current = { matchId:"), "pending assigned with result");
    assert.ok(s.includes("const scheduleFlipReveal = useCallback("), "single scheduling point");
    assert.ok(s.includes("flipTimerRef.current = setTimeout("), "timer armed alongside");
  });
});
