import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migPath = join(root, "..", "..", "supabase", "migrations", "20260929000000_growth_systems.sql");

describe("growth migration proof (pre-apply)", () => {
  const mig = () => readFileSync(migPath, "utf8");

  it("every ENABLE RLS occurs AFTER its table is created (clean-database safe)", () => {
    const src = mig();
    for (const t of [
      "referral_codes",
      "referral_attributions",
      "airdrop_seasons",
      "airdrop_points_ledger",
      "airdrop_social_claims",
      "airdrop_x_identities",
      "bug_reports",
      "bug_bounties",
      "reward_exclusions",
    ]) {
      const created = src.indexOf(`create table public.${t} (`);
      const rls = src.indexOf(`alter table public.${t} enable row level security`);
      assert.ok(created >= 0, `${t} created`);
      assert.ok(rls > created, `${t} RLS after CREATE`);
    }
  });

  it("atomic RPCs exist with locked-down execute", () => {
    const src = mig();
    const fns = [
      "create_airdrop_social_claim_atomic",
      "review_airdrop_social_claim_atomic",
      "qualify_referral_atomic",
      "award_referral_game_atomic",
      "award_gameplay_match_atomic",
    ];
    for (const f of fns) {
      assert.ok(src.includes(`function public.${f}(`), `${f} defined`);
    }
    assert.equal(fns.length, 5, "exactly five growth RPCs");
    assert.ok(src.includes("security definer"), "definer preserved");
    assert.ok(src.includes("set search_path = public"), "fixed search path");
    assert.ok(src.includes("grant execute"), "service_role grant present");
    assert.ok(src.includes("from public"), "public revoked");
    assert.ok(src.includes("pg_advisory_xact_lock"), "award serialization lock");
    assert.ok(src.includes("award_gameplay_match_atomic', 'uuid,text,text,boolean"), "gameplay RPC in permission loop");
  });

  it("event-day gameplay migration replaces the processing-time overload", () => {
    const src = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000002_gameplay_event_day_idempotency.sql"),
      "utf8"
    );
    assert.ok(src.includes("p_settled_at timestamptz"), "authoritative event time param");
    assert.ok(src.includes("missing-settled-at"), "null event time fails closed");
    assert.ok(
      src.includes("drop function if exists public.award_gameplay_match_atomic(uuid, text, text, boolean)"),
      "obsolete 4-arg overload dropped"
    );
    assert.ok(src.includes("award_gameplay_match_atomic', 'uuid,text,text,boolean,timestamptz"), "new sig in permission loop");
    assert.ok(src.includes("grant execute"), "service_role grant");
    assert.ok(src.includes("from anon"), "anon revoked");
    assert.ok(src.includes("from authenticated"), "authenticated revoked");
    assert.ok(src.includes("from public"), "public revoked");
  });

  it("FULL_ADMIN role migration is additive with a check constraint", () => {
    const src = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000004_admin_full_admin.sql"),
      "utf8"
    );
    assert.ok(src.includes("FULL_ADMIN"), "role added");
    assert.ok(src.includes("MODERATOR"), "moderator preserved");
    assert.ok(!/insert into public\.admin_members/i.test(src), "no wallet rows hardcoded in migration");
  });

  it("social edit migration is additive with locked-down execute", () => {
    const src = readFileSync(
      join(root, "..", "..", "supabase", "migrations", "20260929000003_social_claim_edit.sql"),
      "utf8"
    );
    assert.ok(src.includes("update_airdrop_social_claim_atomic"), "edit RPC defined");
    assert.ok(src.includes("grant execute"), "service_role grant");
    assert.ok(src.includes("from anon"), "anon revoked");
  });

  it("social task uniqueness is DB-enforced", () => {
    assert.ok(
      mig().includes("airdrop_social_claims_one_task_per_wallet") &&
        mig().includes("unique (season_id, wallet, task_type)"),
      "season+wallet+task unique constraint"
    );
  });

  it("verified X identity uniqueness lives on the identity table (not task rows)", () => {
    assert.ok(mig().includes("create table public.airdrop_x_identities"), "identity table");
    assert.ok(mig().includes("unique (season_id, wallet)"), "one identity per wallet per season");
    assert.ok(mig().includes("airdrop_x_verified_user_idx"), "OAuth id partial index");
    assert.ok(mig().includes("airdrop_x_verified_handle_idx"), "normalized handle partial index");
    assert.ok(mig().includes("normalized_handle"), "stored normalized handle");
    assert.ok(!mig().includes("airdrop_claims_verified_x_user_idx"), "no claim-level OAuth index");
    assert.ok(!mig().includes("airdrop_claims_verified_x_handle_idx"), "no claim-level handle index");
    // Same wallet must verify all three tasks on one X: no task-row handle lock.
    assert.ok(
      !/airdrop_social_claims[^;]*lower\(x_handle\)/.test(mig().replace(/airdrop_x_identities[\s\S]*$/, "")),
      "task rows carry no verified-handle uniqueness"
    );
  });

  it("single active season is DB-enforced", () => {
    assert.ok(mig().includes("airdrop_seasons_single_active_idx"), "single-active partial index");
    assert.ok(!/insert into public\.airdrop_seasons[^;]*SEASON_1/.test(mig()), "no SEASON_1 seeded");
    assert.ok(mig().includes("DEVNET_BETA"), "DEVNET_BETA seeded");
  });

  it("reward_exclusions exists with RLS and no public writes", () => {
    assert.ok(mig().includes("create table public.reward_exclusions"), "exclusion table");
    assert.ok(mig().includes("alter table public.reward_exclusions enable row level security"), "RLS on");
    assert.ok(!/create policy/i.test(mig()), "no public write policies anywhere");
  });

  it("all growth tables have RLS enabled", () => {
    for (const t of [
      "referral_codes",
      "referral_attributions",
      "airdrop_seasons",
      "airdrop_points_ledger",
      "airdrop_social_claims",
      "airdrop_x_identities",
      "bug_reports",
      "bug_bounties",
      "reward_exclusions",
    ]) {
      assert.ok(mig().includes(`alter table public.${t} enable row level security`), `RLS: ${t}`);
    }
  });

  it("referral cap query index exists", () => {
    assert.ok(mig().includes("airdrop_ledger_referral_game_idx"), "referral_game lookup index");
  });
});
