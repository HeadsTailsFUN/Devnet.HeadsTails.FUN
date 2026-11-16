import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { WelcomeReferral } from "./WelcomeReferral";
import { getPendingReferral } from "@/lib/referrals/client";

beforeEach(() => { cleanup(); window.localStorage.clear(); });
test("landing attribution survives a guide visit and a subsequent bare-root game entry", () => {
  window.history.replaceState(null, "", "/welcome?ref=abc12345");
  render(<WelcomeReferral />);
  window.history.replaceState(null, "", "/how-to");
  assert.equal(getPendingReferral(), "ABC12345");
  window.history.replaceState(null, "", "/");
  assert.equal(getPendingReferral(), "ABC12345");
});
test("an invalid incoming code cannot replace the existing validated pending referral", () => {
  window.history.replaceState(null, "", "/welcome?ref=ABC12345"); const first=render(<WelcomeReferral />); first.unmount();
  window.history.replaceState(null, "", "/welcome?ref=https%3A%2F%2Fevil.invalid"); render(<WelcomeReferral />);
  assert.equal(getPendingReferral(), "ABC12345");
});
