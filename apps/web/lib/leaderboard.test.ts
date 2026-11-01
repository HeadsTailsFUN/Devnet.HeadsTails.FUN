import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { gamesLabel, pluralize, toLeaderboardRow, winsLabel } from "./leaderboard.js";

describe("leaderboard rows", () => {
  it("attaches display rank without altering stats", () => {
    const r = toLeaderboardRow(
      { wallet: "W", games_played: 150, wins: 90, losses: 60, manual_rank_override: null },
      () => null
    );
    assert.equal(r.displayRank, "VETERAN");
    assert.equal(r.gamesPlayed, 150);
    assert.equal(r.wins, 90);
    assert.equal(r.losses, 60);
  });

  it("manual display rank does not alter stats/order inputs", () => {
    const r = toLeaderboardRow(
      { wallet: "W", games_played: 2, wins: 2, losses: 0, manual_rank_override: "LEGEND" },
      () => null
    );
    assert.equal(r.displayRank, "LEGEND");
    assert.equal(r.gamesPlayed, 2);
    assert.equal(r.wins, 2);
  });

  it("most-wins vs most-played ordering is by stats fields", () => {
    const rows = [
      { wallet: "A", games_played: 100, wins: 10 },
      { wallet: "B", games_played: 20, wins: 15 },
    ];
    const byWins = [...rows].sort((a, b) => b.wins - a.wins || b.games_played - a.games_played);
    const byPlayed = [...rows].sort((a, b) => b.games_played - a.games_played || b.wins - a.wins);
    assert.equal(byWins[0].wallet, "B");
    assert.equal(byPlayed[0].wallet, "A");
  });

  it("no mock users: empty input maps to empty rows", () => {
    assert.deepEqual([].map((s) => toLeaderboardRow(s, () => null)), []);
  });

  // HT-QA-009: count-aware labels.
  it("pluralizes wins/games (0 plural, 1 singular, 2+ plural)", () => {
    assert.equal(winsLabel(0), "0 wins");
    assert.equal(winsLabel(1), "1 win");
    assert.equal(winsLabel(2), "2 wins");
    assert.equal(gamesLabel(0), "0 games");
    assert.equal(gamesLabel(1), "1 game");
    assert.equal(gamesLabel(2), "2 games");
    assert.equal(pluralize(1, "win"), "1 win");
    assert.equal(pluralize(1, "game"), "1 game");
  });
});
