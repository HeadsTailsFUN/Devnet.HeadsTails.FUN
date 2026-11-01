import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseCookie, sessionCookieOptions } from "./session.js";
import { SESSION_COOKIE } from "./message.js";

describe("session cookies", () => {
  it("parses the session token without leaking neighbors", () => {
    assert.equal(parseCookie(`a=1; ${SESSION_COOKIE}=tok123; b=2`, SESSION_COOKIE), "tok123");
    assert.equal(parseCookie("", SESSION_COOKIE), null);
    assert.equal(parseCookie("other=x", SESSION_COOKIE), null);
  });

  it("cookie is http-only, same-site, scoped to root", () => {
    const o = sessionCookieOptions();
    assert.equal(o.httpOnly, true);
    assert.equal(o.sameSite, "lax");
    assert.equal(o.path, "/");
    assert.ok(o.maxAge >= 7 * 24 * 3600 - 1);
  });
});
