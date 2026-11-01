-- Growth systems: referrals, airdrop points, bug reports/bounties.
-- Additive only. RLS enabled. No broad public writes (service-role via APIs).
-- Atomic reward RPCs are SECURITY DEFINER with service_role-only execute.

-- Referral codes: one stable code per authenticated wallet.
create table public.referral_codes (
  wallet text primary key,
  code text not null unique,
  created_at timestamptz not null default now()
);

-- Referral attributions: one wallet has one immutable referrer.
create table public.referral_attributions (
  invitee_wallet text primary key,
  referrer_wallet text not null,
  referral_code text not null,
  attributed_at timestamptz not null default now(),
  qualified_at timestamptz,
  status text not null default 'pending' check (status in ('pending','qualified','blocked')),
  qualification_reason text
);

-- Airdrop seasons: DEVNET_BETA for testing, fresh SEASON_1 for production.
create table public.airdrop_seasons (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default false,
  rules_version integer not null default 1
);

-- Points ledger: off-chain, idempotent by season+wallet+event_type+source_key.
create table public.airdrop_points_ledger (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.airdrop_seasons(id) on delete cascade,
  wallet text not null,
  category text not null check (category in ('gameplay','win_bonus','referral','social','adjustment')),
  event_type text not null,
  source_key text not null,
  points integer not null,
  status text not null default 'verified' check (status in ('verified','pending','rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (season_id, wallet, event_type, source_key)
);

-- Social claims: X tasks with manual-pending fallback.
create table public.airdrop_social_claims (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.airdrop_seasons(id) on delete cascade,
  wallet text not null,
  x_user_id text,
  x_handle text not null,
  x_profile_url text not null default '',
  task_type text not null check (task_type in ('connect_x','repost','reply')),
  evidence_url text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  reviewer_wallet text,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- X identities: exactly one linked X account per wallet per season.
-- Task claims stay separate rows so one wallet can verify connect_x +
-- repost + reply for the SAME identity. Verified-identity uniqueness lives
-- here (never on individual task rows).
create table public.airdrop_x_identities (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.airdrop_seasons(id) on delete cascade,
  wallet text not null,
  x_user_id text,
  x_handle text not null,
  normalized_handle text generated always as (lower(x_handle)) stored,
  x_profile_url text not null default '',
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, wallet)
);

-- Bug reports (user severity) + admin triage.
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  telegram_handle text,
  description text not null,
  steps_to_reproduce text,
  reported_severity text not null check (reported_severity in ('Low','Medium','High','Critical')),
  admin_severity text check (admin_severity in ('Low','Medium','High','Critical')),
  status text not null default 'new' check (status in ('new','triaged','needs_info','accepted','duplicate','rejected','resolved','rewarded')),
  page_path text,
  user_agent_summary text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bug bounties: metadata only, no auto-transfer.
create table public.bug_bounties (
  report_id uuid primary key references public.bug_reports(id) on delete cascade,
  reward_type text not null default 'none' check (reward_type in ('none','project_token','sol')),
  status text not null default 'none' check (status in ('none','approved','paid')),
  suggested_usd_min numeric,
  suggested_usd_max numeric,
  reward_amount_base_units text,
  reward_mint text,
  payout_signature text,
  approved_by text,
  paid_at timestamptz
);

-- Reward exclusions: QA / test / abuse wallets skipped by the reward
-- processor (gameplay itself is unaffected). No public writes.
create table public.reward_exclusions (
  wallet text primary key,
  reason text not null,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every ENABLE RLS occurs AFTER its table exists (clean-database safe).
alter table public.referral_codes enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.airdrop_seasons enable row level security;
alter table public.airdrop_points_ledger enable row level security;
alter table public.airdrop_social_claims enable row level security;
alter table public.airdrop_x_identities enable row level security;
alter table public.bug_reports enable row level security;
alter table public.bug_bounties enable row level security;
alter table public.reward_exclusions enable row level security;

-- No public policies: all access through authenticated server routes (service role).

-- One claim per season + wallet + task (application conflict -> already-claimed).
alter table public.airdrop_social_claims
  add constraint airdrop_social_claims_one_task_per_wallet
  unique (season_id, wallet, task_type);

-- One verified X identity cannot belong to two wallets: OAuth id...
create unique index airdrop_x_verified_user_idx
  on public.airdrop_x_identities (season_id, x_user_id)
  where x_user_id is not null and status = 'verified';

-- ...and normalized handle for the manual fallback.
create unique index airdrop_x_verified_handle_idx
  on public.airdrop_x_identities (season_id, normalized_handle)
  where status = 'verified';

-- Exactly one active season at a time.
create unique index airdrop_seasons_single_active_idx
  on public.airdrop_seasons (active)
  where active;

create index referral_attributions_referrer_idx on public.referral_attributions (referrer_wallet);
create index referral_attributions_status_idx on public.referral_attributions (status);
create index airdrop_ledger_wallet_idx on public.airdrop_points_ledger (wallet);
create index airdrop_ledger_season_idx on public.airdrop_points_ledger (season_id);
create index airdrop_ledger_status_idx on public.airdrop_points_ledger (status);
create index airdrop_ledger_referral_game_idx on public.airdrop_points_ledger (season_id, wallet, event_type, created_at);
create index airdrop_x_identity_wallet_idx on public.airdrop_x_identities (season_id, wallet);
create index airdrop_claims_wallet_idx on public.airdrop_social_claims (wallet);
create index airdrop_claims_status_idx on public.airdrop_social_claims (status);
create index reward_exclusions_active_idx on public.reward_exclusions (active) where active;
create index bug_reports_wallet_idx on public.bug_reports (wallet);
create index bug_reports_status_idx on public.bug_reports (status);

-- ============================================================
-- Atomic growth RPCs. Single-transaction claim/review/qualify/
-- award flows: all succeed or all roll back. SECURITY DEFINER
-- with a fixed search_path; execute granted to service_role only.
-- Server routes (verified wallet session) are the sole callers.
-- ============================================================

-- Atomic social claim creation: identity bind + claim + pending ledger.
-- Returns {"status":"created","claim_id":...} or
-- {"status":"already-claimed","claim_id":...}.
create or replace function public.create_airdrop_social_claim_atomic(
  p_season_id uuid,
  p_wallet text,
  p_task_type text,
  p_handle text,
  p_profile_url text,
  p_evidence_url text,
  p_x_user_id text,
  p_points integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_claim_id uuid;
  v_event text;
  v_handle_norm text;
  v_ident public.airdrop_x_identities%rowtype;
begin
  if p_task_type not in ('connect_x', 'repost', 'reply') then
    raise exception 'invalid-task' using errcode = '22023';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'invalid-points' using errcode = '22023';
  end if;
  if p_handle is null or btrim(p_handle) = '' then
    raise exception 'invalid-handle' using errcode = '22023';
  end if;
  v_event := 'social_' || p_task_type;
  v_handle_norm := lower(btrim(btrim(p_handle), '@'));

  -- one identity per wallet per season: bind or confirm
  insert into public.airdrop_x_identities (season_id, wallet, x_user_id, x_handle, x_profile_url, status)
  values (p_season_id, p_wallet, nullif(btrim(p_x_user_id), ''), p_handle, coalesce(p_profile_url, ''), 'pending')
  on conflict (season_id, wallet) do nothing;

  select * into v_ident from public.airdrop_x_identities
   where season_id = p_season_id and wallet = p_wallet;
  if not found then
    raise exception 'identity-bind-failed' using errcode = 'P0001';
  end if;
  if lower(v_ident.x_handle) <> v_handle_norm then
    raise exception 'wallet-bound' using errcode = 'P0001';
  end if;
  if p_x_user_id is not null and btrim(p_x_user_id) <> '' and v_ident.x_user_id is null then
    update public.airdrop_x_identities
       set x_user_id = btrim(p_x_user_id), updated_at = now()
     where id = v_ident.id;
  end if;

  -- verified X cannot belong to another wallet (OAuth id, then handle)
  if exists (
    select 1 from public.airdrop_x_identities
     where season_id = p_season_id and status = 'verified' and wallet <> p_wallet
       and ((p_x_user_id is not null and btrim(p_x_user_id) <> '' and x_user_id = btrim(p_x_user_id))
            or lower(x_handle) = v_handle_norm)
  ) then
    raise exception 'x-taken' using errcode = 'P0001';
  end if;

  -- claim insert; duplicate task -> already-claimed with the existing id
  begin
    insert into public.airdrop_social_claims
      (season_id, wallet, x_user_id, x_handle, x_profile_url, task_type, evidence_url, status)
    values (p_season_id, p_wallet, nullif(btrim(p_x_user_id), ''), p_handle,
            coalesce(p_profile_url, ''), p_task_type, p_evidence_url, 'pending')
    returning id into v_claim_id;
  exception when unique_violation then
    select id into v_claim_id from public.airdrop_social_claims
     where season_id = p_season_id and wallet = p_wallet and task_type = p_task_type;
    return jsonb_build_object('status', 'already-claimed', 'claim_id', v_claim_id);
  end;

  -- matching pending ledger event in the SAME transaction (both or neither)
  insert into public.airdrop_points_ledger
    (season_id, wallet, category, event_type, source_key, points, status, metadata)
  values (p_season_id, p_wallet, 'social', v_event, v_claim_id::text, p_points, 'pending',
          jsonb_build_object('claimId', v_claim_id, 'task', p_task_type, 'handle', p_handle))
  on conflict (season_id, wallet, event_type, source_key) do nothing;

  return jsonb_build_object('status', 'created', 'claim_id', v_claim_id);
end;
$func$;

-- Atomic social review: claim + SAME ledger event + identity move together.
-- VERIFY sets claim/ledger verified and establishes the wallet identity;
-- REJECT/REVOKE sets claim/ledger rejected (verified_at null, history kept)
-- and demotes the identity only when no sibling verified claim remains.
-- Returns {"status":"verified"|"rejected","claim_id":...}.
create or replace function public.review_airdrop_social_claim_atomic(
  p_claim_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_claim public.airdrop_social_claims%rowtype;
  v_event text;
  v_ident public.airdrop_x_identities%rowtype;
  v_siblings integer;
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'invalid-decision' using errcode = '22023';
  end if;

  select * into v_claim from public.airdrop_social_claims
   where id = p_claim_id for update;
  if not found then
    raise exception 'claim-not-found' using errcode = 'P0002';
  end if;
  v_event := 'social_' || v_claim.task_type;

  if p_decision = 'verified' then
    -- wallet-bound: a wallet keeps exactly one X identity per season
    select * into v_ident from public.airdrop_x_identities
     where season_id = v_claim.season_id and wallet = v_claim.wallet for update;
    if found and lower(v_ident.x_handle) <> lower(v_claim.x_handle) then
      raise exception 'wallet-bound' using errcode = 'P0001';
    end if;
    -- X conflict: row locks serialize concurrent verifiers on the same rows
    if exists (
      select 1 from public.airdrop_x_identities
       where season_id = v_claim.season_id and status = 'verified' and wallet <> v_claim.wallet
         and ((v_claim.x_user_id is not null and x_user_id = v_claim.x_user_id)
              or lower(x_handle) = lower(v_claim.x_handle))
      for update
    ) then
      raise exception 'x-taken' using errcode = 'P0001';
    end if;
    -- backstop: verified task rows from other wallets
    if exists (
      select 1 from public.airdrop_social_claims
       where season_id = v_claim.season_id and status = 'verified' and wallet <> v_claim.wallet
         and lower(x_handle) = lower(v_claim.x_handle)
      for update
    ) then
      raise exception 'x-taken' using errcode = 'P0001';
    end if;

    update public.airdrop_social_claims
       set status = 'verified', reviewer_wallet = p_reviewer,
           review_note = nullif(btrim(p_note), ''), reviewed_at = now()
     where id = v_claim.id;

    update public.airdrop_points_ledger
       set status = 'verified', verified_at = now()
     where season_id = v_claim.season_id and wallet = v_claim.wallet
       and event_type = v_event and source_key = v_claim.id::text;

    -- identity follows the claim; unique backstop rolls ALL of the above
    -- back on a concurrent-verify race (no verified-points leak possible)
    insert into public.airdrop_x_identities
      (season_id, wallet, x_user_id, x_handle, x_profile_url, status, verified_at)
    values (v_claim.season_id, v_claim.wallet, v_claim.x_user_id, v_claim.x_handle,
            v_claim.x_profile_url, 'verified', now())
    on conflict (season_id, wallet) do update
      set x_user_id = coalesce(excluded.x_user_id, public.airdrop_x_identities.x_user_id),
          x_handle = excluded.x_handle,
          x_profile_url = excluded.x_profile_url,
          status = 'verified', verified_at = now(), updated_at = now();
  else
    update public.airdrop_social_claims
       set status = 'rejected', reviewer_wallet = p_reviewer,
           review_note = nullif(btrim(p_note), ''), reviewed_at = now()
     where id = v_claim.id;

    update public.airdrop_points_ledger
       set status = 'rejected', verified_at = null
     where season_id = v_claim.season_id and wallet = v_claim.wallet
       and event_type = v_event and source_key = v_claim.id::text;

    select count(*) into v_siblings from public.airdrop_social_claims
     where season_id = v_claim.season_id and wallet = v_claim.wallet and status = 'verified';
    if v_siblings = 0 then
      update public.airdrop_x_identities
         set status = 'rejected', verified_at = null, updated_at = now()
       where season_id = v_claim.season_id and wallet = v_claim.wallet;
    else
      update public.airdrop_x_identities
         set status = 'verified', updated_at = now()
       where season_id = v_claim.season_id and wallet = v_claim.wallet and status <> 'verified';
    end if;
  end if;

  return jsonb_build_object('status', p_decision, 'claim_id', v_claim.id);
end;
$func$;

-- Atomic referral qualification: attribution + BOTH one-time bonuses move
-- together (idempotent re-runs only top up missing rows, never duplicate).
-- Returns {"status":"qualified"|"already-qualified"}.
create or replace function public.qualify_referral_atomic(
  p_season_id uuid,
  p_invitee text,
  p_referrer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_attr public.referral_attributions%rowtype;
begin
  select * into v_attr from public.referral_attributions
   where invitee_wallet = p_invitee for update;
  if not found then
    raise exception 'not-attributed' using errcode = 'P0002';
  end if;
  if v_attr.referrer_wallet <> p_referrer then
    raise exception 'referrer-mismatch' using errcode = '22023';
  end if;
  if v_attr.status = 'qualified' then
    insert into public.airdrop_points_ledger
      (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
    values (p_season_id, p_invitee, 'referral', 'referral_qualify_invitee', p_invitee,
            25, 'verified', now(), jsonb_build_object('referrer', p_referrer))
    on conflict (season_id, wallet, event_type, source_key) do nothing;
    insert into public.airdrop_points_ledger
      (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
    values (p_season_id, p_referrer, 'referral', 'referral_qualify_referrer', p_invitee,
            50, 'verified', now(), jsonb_build_object('invitee', p_invitee))
    on conflict (season_id, wallet, event_type, source_key) do nothing;
    return jsonb_build_object('status', 'already-qualified');
  end if;
  if v_attr.status <> 'pending' then
    raise exception 'invalid-attribution-state' using errcode = '22023';
  end if;

  insert into public.airdrop_points_ledger
    (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
  values (p_season_id, p_invitee, 'referral', 'referral_qualify_invitee', p_invitee,
          25, 'verified', now(), jsonb_build_object('referrer', p_referrer));

  insert into public.airdrop_points_ledger
    (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
  values (p_season_id, p_referrer, 'referral', 'referral_qualify_referrer', p_invitee,
          50, 'verified', now(), jsonb_build_object('invitee', p_invitee));

  update public.referral_attributions
     set status = 'qualified', qualified_at = now(),
         qualification_reason = '3 eligible settled games'
   where invitee_wallet = p_invitee;

  return jsonb_build_object('status', 'qualified');
end;
$func$;

-- Atomic recurring referral award: serialized per referrer + UTC day.
-- Counts ONLY verified event_type='referral_game' rows (qualification and
-- adjustments never pollute the caps). Awards +2 only when
-- todayRecurring + 2 <= 500 and the invitee has < 25 events today.
-- Idempotent by matchId + invitee source key.
-- Returns {"status":"awarded"|"exists"|"capped-invitee"|"capped-referrer"}.
create or replace function public.award_referral_game_atomic(
  p_season_id uuid,
  p_referrer text,
  p_invitee text,
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_day_start timestamptz;
  v_key text;
  v_invitee_count integer;
  v_recurring integer;
begin
  perform pg_advisory_xact_lock(
    hashtext('referral-day:' || p_referrer || ':' || ((now() at time zone 'UTC')::date)::text)
  );
  v_day_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_key := p_match_id || ':' || p_invitee;

  if exists (
    select 1 from public.airdrop_points_ledger
     where season_id = p_season_id and wallet = p_referrer
       and event_type = 'referral_game' and source_key = v_key
  ) then
    return jsonb_build_object('status', 'exists');
  end if;

  select count(*) into v_invitee_count from public.airdrop_points_ledger
   where season_id = p_season_id and wallet = p_referrer
     and event_type = 'referral_game' and status = 'verified'
     and created_at >= v_day_start and metadata->>'invitee' = p_invitee;
  if v_invitee_count >= 25 then
    return jsonb_build_object('status', 'capped-invitee');
  end if;

  select coalesce(sum(points), 0) into v_recurring from public.airdrop_points_ledger
   where season_id = p_season_id and wallet = p_referrer
     and event_type = 'referral_game' and status = 'verified'
     and created_at >= v_day_start;
  if v_recurring + 2 > 500 then
    return jsonb_build_object('status', 'capped-referrer');
  end if;

  insert into public.airdrop_points_ledger
    (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
  values (p_season_id, p_referrer, 'referral', 'referral_game', v_key,
          2, 'verified', now(), jsonb_build_object('invitee', p_invitee, 'matchId', p_match_id))
  on conflict (season_id, wallet, event_type, source_key) do nothing;

  return jsonb_build_object('status', 'awarded');
end;
$func$;

-- Atomic gameplay award: base +2 plus win bonus +3 under ONE daily cap.
-- Serialized per season + wallet + UTC day. Partial awards fill the base
-- first (win at 198 -> gameplay +2 / bonus +0; at 199 -> gameplay +1 / +0),
-- never exceed 200, never negative. Idempotent by Match event keys.
-- Returns {"status":"awarded"|"partial"|"capped"|"exists",...}.
create or replace function public.award_gameplay_match_atomic(
  p_season_id uuid,
  p_wallet text,
  p_match_id text,
  p_is_winner boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_day_start timestamptz;
  v_current integer;
  v_allow integer;
  v_game_exists boolean;
  v_bonus_exists boolean;
  v_game_pts integer := 0;
  v_bonus_pts integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtext('gameplay-day:' || p_season_id::text || ':' || p_wallet || ':' || ((now() at time zone 'UTC')::date)::text)
  );
  v_day_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select exists (
    select 1 from public.airdrop_points_ledger
     where season_id = p_season_id and wallet = p_wallet
       and event_type = 'gameplay_match' and source_key = p_match_id
  ) into v_game_exists;
  select exists (
    select 1 from public.airdrop_points_ledger
     where season_id = p_season_id and wallet = p_wallet
       and event_type = 'win_bonus_match' and source_key = p_match_id
  ) into v_bonus_exists;
  if v_game_exists and (not p_is_winner or v_bonus_exists) then
    return jsonb_build_object('status', 'exists');
  end if;

  select coalesce(sum(points), 0) into v_current from public.airdrop_points_ledger
   where season_id = p_season_id and wallet = p_wallet
     and category in ('gameplay', 'win_bonus') and status = 'verified'
     and created_at >= v_day_start;
  v_allow := greatest(0, 200 - v_current);
  if v_allow <= 0 then
    return jsonb_build_object('status', 'capped', 'day_total', v_current);
  end if;

  if not v_game_exists then
    v_game_pts := least(2, v_allow);
    insert into public.airdrop_points_ledger
      (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
    values (p_season_id, p_wallet, 'gameplay', 'gameplay_match', p_match_id,
            v_game_pts, 'verified', now(),
            jsonb_build_object('matchId', p_match_id, 'outcome', case when p_is_winner then 'win' else 'loss' end))
    on conflict (season_id, wallet, event_type, source_key) do nothing;
    v_allow := v_allow - v_game_pts;
  end if;

  if p_is_winner and not v_bonus_exists and v_allow > 0 then
    v_bonus_pts := least(3, v_allow);
    insert into public.airdrop_points_ledger
      (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
    values (p_season_id, p_wallet, 'win_bonus', 'win_bonus_match', p_match_id,
            v_bonus_pts, 'verified', now(), jsonb_build_object('matchId', p_match_id))
    on conflict (season_id, wallet, event_type, source_key) do nothing;
    v_allow := v_allow - v_bonus_pts;
  end if;

  if (not v_game_exists and v_game_pts < 2) or (p_is_winner and not v_bonus_exists and v_bonus_pts < 3) then
    return jsonb_build_object('status', 'partial', 'gameplay', v_game_pts, 'win_bonus', v_bonus_pts);
  end if;
  return jsonb_build_object('status', 'awarded', 'gameplay', v_game_pts, 'win_bonus', v_bonus_pts);
end;
$func$;

-- RPC permissions: service_role only. PUBLIC/anon/authenticated revoked.
-- Role guards keep this file runnable on clean Postgres without Supabase roles.
do $perm$
declare
  f record;
begin
  for f in
    select * from (values
      ('create_airdrop_social_claim_atomic', 'uuid,text,text,text,text,text,text,integer'),
      ('review_airdrop_social_claim_atomic', 'uuid,text,text,text'),
      ('qualify_referral_atomic', 'uuid,text,text'),
      ('award_referral_game_atomic', 'uuid,text,text,text'),
      ('award_gameplay_match_atomic', 'uuid,text,text,boolean')
    ) as t(fname, fsig)
  loop
    execute format('revoke all on function public.%I(%s) from public', f.fname, f.fsig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%I(%s) from anon', f.fname, f.fsig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function public.%I(%s) from authenticated', f.fname, f.fsig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%I(%s) to service_role', f.fname, f.fsig);
    end if;
  end loop;
end
$perm$;

-- Seed testing season (idempotent).
insert into public.airdrop_seasons (key, name, active, rules_version)
values ('DEVNET_BETA', 'Devnet Beta', true, 1)
on conflict (key) do nothing;
