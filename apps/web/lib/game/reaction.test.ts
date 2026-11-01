import { test } from "node:test";
import assert from "node:assert/strict";
import { reactionAsset } from "./reaction";
test("exact original filenames follow confirmed side/outcome ordinal and saturate", () => {
  assert.equal(
    reactionAsset("HEADS", true, 1),
    "/assets/emotions/HeadFirstWin.png",
  );
  assert.equal(
    reactionAsset("HEADS", true, 2),
    "/assets/emotions/HeadSecondWin.png",
  );
  assert.equal(
    reactionAsset("HEADS", true, 3),
    "/assets/emotions/HeadThirdWin.png",
  );
  assert.equal(
    reactionAsset("HEADS", true, 99),
    "/assets/emotions/HeadFourthWin.png",
  );
  assert.equal(
    reactionAsset("HEADS", false, 99),
    "/assets/emotions/HeadLose.png",
  );
  assert.equal(
    reactionAsset("TAILS", true, 1),
    "/assets/emotions/TailFirstWin.png",
  );
  assert.equal(
    reactionAsset("TAILS", true, 99),
    "/assets/emotions/TailSecondWin.png",
  );
  assert.equal(
    reactionAsset("TAILS", false, 1),
    "/assets/emotions/TailFirstLose.png",
  );
  assert.equal(
    reactionAsset("TAILS", false, 99),
    "/assets/emotions/TailsSecondLose.png",
  );
});
