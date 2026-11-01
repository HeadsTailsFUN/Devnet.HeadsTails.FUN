import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { devnetAdminContext } from "./auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function routeSrc(path: string): string {
  return readFileSync(join(root, "app", "api", path), "utf8");
}

describe("web-admin authorization matrix", () => {
  it("devnetAdminContext: devnet + mainnet-off => true; any mainnet signal => false", () => {
    withEnv(
      { NEXT_PUBLIC_SOLANA_CLUSTER: "devnet", MAINNET_REAL_VALUE_ENABLED: "false", NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED: undefined },
      () => assert.equal(devnetAdminContext(), true)
    );
    withEnv(
      { NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta", MAINNET_REAL_VALUE_ENABLED: "false" },
      () => assert.equal(devnetAdminContext(), false)
    );
    withEnv(
      { NEXT_PUBLIC_SOLANA_CLUSTER: "devnet", MAINNET_REAL_VALUE_ENABLED: "true" },
      () => assert.equal(devnetAdminContext(), false)
    );
    withEnv(
      { NEXT_PUBLIC_SOLANA_CLUSTER: "devnet", MAINNET_REAL_VALUE_ENABLED: "false", NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED: "true" },
      () => assert.equal(devnetAdminContext(), false)
    );
  });

  it("checkWebAdmin admits OWNER or Devnet FULL_ADMIN only (moderators denied, mainnet denied)", () => {
    const src = readFileSync(join(root, "lib", "admin", "auth.ts"), "utf8");
    assert.ok(src.includes("export async function checkWebAdmin"), "helper exists");
    assert.ok(src.includes('staff.role === "OWNER"'), "owner admitted");
    assert.ok(src.includes('staff.role === "FULL_ADMIN"'), "full admin admitted");
    assert.ok(src.includes("devnetAdminContext()"), "devnet gate inside helper");
    // Moderators fall through to denial; normal users never reach a role.
    const body = src.slice(src.indexOf("export async function checkWebAdmin"));
    assert.ok(body.includes('status: 403'), "denial is 403");
  });

  it("checkStaff(req, true) semantics untouched (FULL_ADMIN can never satisfy owner-only)", () => {
    const src = readFileSync(join(root, "lib", "admin", "auth.ts"), "utf8");
    const staffFn = src.slice(src.indexOf("export async function checkStaff"), src.indexOf("export async function checkWebAdmin"));
    const gateIdx = staffFn.indexOf("if (ownerOnly)");
    assert.ok(gateIdx >= 0, "owner-only gate preserved");
    // The owner gate returns before any role is read: FULL_ADMIN appears
    // only in the off-chain branch below it.
    assert.ok(staffFn.indexOf("FULL_ADMIN") > gateIdx, "role read happens strictly after the owner gate");
    assert.ok(staffFn.includes('error: "owner access required"'), "owner denial message preserved");
  });

  const offChain: Array<[string, string]> = [
    ["admin/audit/route.ts", "audit read"],
    ["admin/users/profile/route.ts", "user/profile mutation"],
    ["admin/settings/route.ts", "settings mutation"],
    ["admin/airdrop/route.ts", "exclude/restore/adjust"],
    ["admin/bugs/route.ts", "bounty/payout metadata"],
    ["admin/assets/route.ts", "asset upload"],
  ];
  for (const [path, label] of offChain) {
    it(`off-chain ${label} uses checkWebAdmin (${path})`, () => {
      const src = routeSrc(path);
      assert.ok(src.includes("checkWebAdmin"), `${label}: helper used`);
    });
  }

  it("strict owner-only routes never use checkWebAdmin (pause/init-rooms/upgrade/members)", () => {
    for (const path of [
      "admin/game/pause-tx/route.ts",
      "admin/init-rooms-tx/route.ts",
      "admin/members/route.ts",
    ]) {
      const src = routeSrc(path);
      assert.ok(src.includes("checkStaff(req, true)"), `${path}: strict owner check`);
      assert.ok(!src.includes("checkWebAdmin"), `${path}: no web-admin bypass`);
    }
  });

  it("obsolete hosted V2 upgrade builder is permanently disabled", async () => {
    const { POST } = await import("../../app/api/admin/upgrade-tx/route.js");
    assert.equal((await POST()).status,410);
    assert.ok(!readFileSync(join(root,"app","admin","page.tsx"),"utf8").includes("<UpgradeTab"));
  });

  it("members (staff-role mutation) stays OWNER-only by design; no UI mutation surface", () => {
    const tabsA = readFileSync(join(root, "components", "admin", "AdminTabsA.tsx"), "utf8");
    assert.ok(!tabsA.includes("/api/admin/members"), "no UI calls members endpoint (nothing appears usable then 403s)");
  });

  it("unauthenticated admin API access is denied without a session", async () => {
    const { GET: auditGet } = await import("../../app/api/admin/audit/route.js");
    assert.equal((await auditGet(new Request("http://x/api/admin/audit"))).status, 401);
    const { GET: statusGet } = await import("../../app/api/admin/status/route.js");
    assert.equal((await statusGet(new Request("http://x/api/admin/status"))).status, 401);
    const { POST: adjustPost } = await import("../../app/api/admin/airdrop/route.js");
    const res = await adjustPost(
      new Request("http://x/api/admin/airdrop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "adjust", wallet: "W", points: 1, reason: "r" }),
      })
    );
    assert.equal(res.status, 401);
  });

  it("admin UI gates off-chain controls on canWebAdmin, on-chain on owner notice", () => {
    const page = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    assert.ok(page.includes("canWebAdmin"), "page passes web-admin capability");
    assert.ok(page.includes("status.isFullAdmin"), "full-admin recognized");
    assert.ok(page.includes("Owner signature required"), "on-chain notice for non-owners");
    for (const tab of ["UsersTab", "AirdropTab", "BugReportsTab"]) {
      const src = readFileSync(
        join(root, "components", "admin", tab === "UsersTab" ? "AdminTabsA.tsx" : "AdminTabsC.tsx"),
        "utf8"
      );
      assert.ok(src.includes("canWebAdmin"), `${tab}: capability prop`);
      assert.ok(!src.includes("isOwner"), `${tab}: no stale owner-only gating`);
    }
  });
});
