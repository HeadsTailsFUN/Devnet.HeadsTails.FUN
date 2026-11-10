import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const url = "https://headstails.fun/api/admin/users";
test("wallet-session routes deny cross-origin browsers without CORS grants", () => {
  for (const headers of [
    { origin: "https://example.invalid" },
    { origin: "https://www.headstails.fun", "sec-fetch-site": "same-site" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const result = middleware(new NextRequest(url, { headers: new Headers(headers as Record<string, string>) }));
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
});

test("same-origin and direct requests still go through server-side authorization", () => {
  for (const headers of [{ origin: "https://headstails.fun" }, {}]) {
    const result = middleware(new NextRequest(url, { headers: new Headers(headers as Record<string, string>) }));
    assert.equal(result.headers.get("x-middleware-next"), "1");
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
});
