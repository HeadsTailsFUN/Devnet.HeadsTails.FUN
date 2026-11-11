\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role;
create table public.sponsor_ledger(wallet text,amount_lamports bigint,created_at timestamptz default now(),kind text,status text,idempotency_key text);
create table public.welcome_grants(wallet text,mint text,status text);
create table public.faucet_claims(wallet text);
-- PREPARED ONLY: Devnet B2. Never apply to the hosted project in this phase.
-- Additive journals; existing points, referrals, grants and audit rows stay intact.
create table public.devnet_expenses (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null check (length(operation_key) between 1 and 240),
  wallet text not null,
  kind text not null check (kind in ('prefund','reimburse','advance','match','settle','faucet')),
  status text not null default 'reserved' check (status in ('reserved','submitted','confirmed','failed')),
  reserved_lamports bigint not null check (reserved_lamports >= 0),
  charged_lamports bigint not null check (charged_lamports >= 0),
  expense_day date not null default (now() at time zone 'UTC')::date,
  claim_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default now() + interval '90 seconds',
  signature text,
  raw_transaction text,
  blockhash text,
  last_valid_block_height bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (charged_lamports <= reserved_lamports)
);
create unique index devnet_expenses_active_operation
  on public.devnet_expenses(operation_key) where status <> 'failed';
create index devnet_expenses_budget on public.devnet_expenses(expense_day, wallet);
alter table public.devnet_expenses enable row level security;

-- Append-only operator evidence for exceptional expired signatures. Public
-- retries cannot infer non-payment merely from a missing/pruned RPC receipt.
create table public.devnet_expense_resolutions (
  expense_id uuid primary key references public.devnet_expenses(id),
  signature text not null,
  outcome text not null check(outcome='not-landed'),
  finalized_height bigint not null,
  evidence text not null check(length(evidence)>=20),
  reviewed_at timestamptz not null default now()
);
alter table public.devnet_expense_resolutions enable row level security;

-- Operator-reviewed evidence for ambiguous pre-B2 grants. No existing grant
-- or ledger row is deleted or rewritten to authorize a replacement.
create table public.devnet_legacy_grant_clearances (
  wallet text not null,
  mint text not null,
  outcome text not null check(outcome in ('paid','not-paid')),
  evidence text not null check(length(evidence)>0),
  reviewed_at timestamptz not null default now(),
  primary key(wallet,mint)
);
alter table public.devnet_legacy_grant_clearances enable row level security;

create function public.reserve_devnet_expense(
  p_operation_key text, p_wallet text, p_kind text, p_lamports bigint,
  p_wallet_cap bigint, p_global_cap bigint, p_drain_reserve bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.devnet_expenses%rowtype;
  v_global bigint;
  v_wallet bigint;
  v_day date := (now() at time zone 'UTC')::date;
  v_legacy boolean;
  v_clearance text;
begin
  if p_lamports is null or p_wallet_cap is null or p_global_cap is null or p_drain_reserve is null
     or p_operation_key is null or p_wallet is null or p_kind is null
     or p_lamports < 0 or p_wallet_cap <= 0 or p_global_cap <= 0
     or p_drain_reserve < 0 or p_drain_reserve > p_global_cap
     or length(p_operation_key) not between 1 and 240 then
    raise exception 'invalid-expense' using errcode='22023';
  end if;
  -- One shared lock covers BOTH wallet and global admission across instances.
  perform pg_advisory_xact_lock(734278126);
  -- Expired unsigned reservations cannot have spent anything. Fencing in
  -- submit_devnet_expense prevents an old worker from broadcasting afterward.
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
    where status='reserved' and raw_transaction is null and lease_expires_at<now();
  select * into r from public.devnet_expenses
   where operation_key=p_operation_key and status <> 'failed' for update;
  if found then
    if r.wallet <> p_wallet or r.kind <> p_kind then
      raise exception 'expense-identity-mismatch' using errcode='22023';
    end if;
    if r.status='reserved' and r.raw_transaction is null and r.lease_expires_at < now() then
      update public.devnet_expenses set claim_token=gen_random_uuid(),
        lease_expires_at=now()+interval '90 seconds', updated_at=now()
       where id=r.id returning * into r;
      return jsonb_build_object('status','reserved','expense',to_jsonb(r));
    end if;
    return jsonb_build_object('status','existing','expense',to_jsonb(r));
  end if;
  if p_kind='reimburse' and exists(select 1 from public.sponsor_ledger
      where idempotency_key=p_operation_key and status='confirmed') then
    return jsonb_build_object('status','legacy-completed');
  end if;
  if p_kind='prefund' then
    -- Sliding cooldown also covers in-flight reservations, including hour boundaries.
    select * into r from public.devnet_expenses where wallet=p_wallet and kind='prefund'
      and status <> 'failed' and created_at > now()-interval '1 hour'
      order by created_at desc limit 1;
    if found then return jsonb_build_object('status','existing','expense',to_jsonb(r)); end if;
    if exists(select 1 from public.sponsor_ledger where wallet=p_wallet and kind='PRE_FUND'
        and status in ('pending','confirmed') and created_at > now()-interval '1 hour') then
      return jsonb_build_object('status','legacy-completed');
    end if;
  end if;
  if p_kind='faucet' then
    -- Both endpoints share one identity, and legacy evidence is never discarded.
    select outcome into v_clearance from public.devnet_legacy_grant_clearances
      where wallet=p_wallet and mint=split_part(p_operation_key,'-',2);
    if v_clearance='paid' then return jsonb_build_object('status','legacy-completed'); end if;
    if v_clearance is distinct from 'not-paid' then
      select exists(select 1 from public.faucet_claims where wallet=p_wallet)
        or exists(select 1 from public.welcome_grants where wallet=p_wallet
            and mint=split_part(p_operation_key,'-',2) and status='completed') into v_legacy;
      if v_legacy then return jsonb_build_object('status','legacy-completed'); end if;
      if exists(select 1 from public.welcome_grants where wallet=p_wallet
          and mint=split_part(p_operation_key,'-',2) and status in ('pending','submitted','failed')) then
        return jsonb_build_object('status','legacy-pending');
      end if;
    end if;
  else
    -- Pending holds count across midnight until their actual outcome is known.
    select coalesce(sum(charged_lamports),0),
      coalesce(sum(charged_lamports) filter(where wallet=p_wallet),0)
      into v_global,v_wallet from public.devnet_expenses
      where kind <> 'faucet' and
        (status in ('reserved','submitted') or expense_day=v_day);
    select v_global+coalesce(sum(amount_lamports),0),
      v_wallet+coalesce(sum(amount_lamports) filter(where wallet=p_wallet),0)
      into v_global,v_wallet from public.sponsor_ledger
      where created_at >= (v_day::timestamp at time zone 'UTC');
    if v_wallet+p_lamports > p_wallet_cap then return jsonb_build_object('status','wallet-cap'); end if;
    if v_global+p_lamports > p_global_cap-p_drain_reserve then
      return jsonb_build_object('status','global-cap');
    end if;
  end if;
  insert into public.devnet_expenses(operation_key,wallet,kind,reserved_lamports,charged_lamports)
    values(p_operation_key,p_wallet,p_kind,p_lamports,p_lamports) returning * into r;
  return jsonb_build_object('status','reserved','expense',to_jsonb(r));
end;
$$;

create function public.devnet_expense_totals(p_wallet text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('global',coalesce(sum(amount),0),
   'wallet',coalesce(sum(amount) filter(where wallet=p_wallet),0))
 from (
  select wallet,charged_lamports amount from public.devnet_expenses where kind<>'faucet'
   and (status in ('reserved','submitted') or expense_day=(now() at time zone 'UTC')::date)
  union all
  select wallet,amount_lamports from public.sponsor_ledger
   where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
 ) expenses;
$$;


\ir ../migrations/20261027160000_hts_versioned_welcome.sql
insert into public.devnet_token_releases(mint,entitlement_version,enabled,wallet_cap_lamports,global_cap_lamports)
values ('HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4','hts-v1',true,100000000,500000000);
\ir ../migrations/20261110023059_scope_devnet_service_match_budget.sql
-- Past real expenses above all historical caps, simulated only in this local fixture.
insert into public.sponsor_ledger(wallet,amount_lamports,kind,status) values ('player',100000000000,'REIMBURSE','confirmed');
insert into public.devnet_expenses(operation_key,wallet,kind,status,reserved_lamports,charged_lamports)
values ('historical-service','3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw','match','confirmed',20000000000,20000000000);
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
select public.test_assert(public.reserve_devnet_expense('before','player','reimburse',5000,500000000,2000000000,0)->>'status'='wallet-cap','old player limit reproduced');
select public.test_assert(public.reserve_devnet_expense('before-service','3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw','match',5000,500000000,2000000000,0)->>'status'='wallet-cap','old service limit reproduced');
\ir ../migrations/20261111130952_remove_devnet_sponsor_daily_caps.sql
select public.test_assert(not daily_sol_caps_enabled,'pinned release daily quotas disabled') from public.devnet_token_releases;
select public.test_assert(public.reserve_devnet_expense('uncapped-player','player','reimburse',5000,null,null,0)->>'status'='reserved','player above historical wallet and global caps admitted');
select public.test_assert(public.reserve_devnet_expense('uncapped-service','3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw','match',5000,null,null,0)->>'status'='reserved','service above 10 SOL admitted');
select public.test_assert(public.reserve_devnet_expense('uncapped-settle','3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw','settle',5000,500000000,2000000000,0)->>'status'='reserved','old workers numeric caps do not restore quotas');
select public.test_assert(public.reserve_hts_welcome('welcome-HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4-11111111111111111111111111111111','11111111111111111111111111111111','HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4',50000000)->>'status'='reserved','welcome SOL cost no longer blocked by shared daily quota');
select public.test_assert(public.reserve_devnet_expense('uncapped-player','player','reimburse',5000,null,null,0)->>'status'='existing','same operation reuses reservation');
select public.test_assert((select count(*)=1 from public.devnet_expenses where operation_key='uncapped-player'),'no duplicate expense');
select public.test_assert(public.reserve_devnet_expense('prefund-a','player','prefund',20000000,null,null,0)->>'status'='reserved','prefund admitted');
select public.test_assert(public.reserve_devnet_expense('prefund-b','player','prefund',20000000,null,null,0)->>'status'='existing','prefund sliding duplicate protection retained');
do $$ begin
  perform public.reserve_devnet_expense('uncapped-player','wrong-wallet','reimburse',5000,null,null,0);
  raise exception 'identity fence missing';
exception when invalid_parameter_value then raise notice 'PASS: identity mismatch rejected'; end; $$;
do $$ begin
  perform public.reserve_devnet_expense('negative','player','reimburse',-1,null,null,0);
  raise exception 'amount validation missing';
exception when invalid_parameter_value then raise notice 'PASS: negative amount rejected'; end; $$;
select public.test_assert(not has_function_privilege('anon','public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint)','EXECUTE'),'anon denied reservation RPC');
select public.test_assert(not has_function_privilege('authenticated','public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint)','EXECUTE'),'authenticated denied reservation RPC');
select public.test_assert(not has_function_privilege('service_role','public.reserve_devnet_expense_b2_internal(text,text,text,bigint,bigint,bigint,bigint)','EXECUTE'),'internal journal remains non-callable by service');
select public.test_assert(has_function_privilege('service_role','public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint)','EXECUTE'),'service wrapper remains callable');
update public.devnet_token_releases set daily_sol_caps_enabled=true;
select public.test_assert(public.reserve_devnet_expense('rollback-player','player','reimburse',5000,500000000,2000000000,0)->>'status'='wallet-cap','stored numerical quotas can be restored');
update public.devnet_token_releases set daily_sol_caps_enabled=false;
select 'ALL DAILY QUOTA REGRESSIONS PASSED' result;
