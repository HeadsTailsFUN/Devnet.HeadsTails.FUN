-- HTS is a new mint entitlement. Historical grants and unversioned faucet
-- claims remain unchanged and continue to govern the original token only.
-- This migration contains NO mint activation, historical rewrite or grant.
begin;
create table public.devnet_token_releases (
  mint text primary key check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  entitlement_version text not null unique check (entitlement_version = 'hts-v1'),
  enabled boolean not null default false,
  wallet_cap_lamports bigint not null default 500000000 check (wallet_cap_lamports > 0),
  global_cap_lamports bigint not null default 2000000000 check (global_cap_lamports > 0),
  drain_reserve_lamports bigint not null default 50000000 check (drain_reserve_lamports >= 0),
  approved_at timestamptz not null default now(),
  check (mint <> 'BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh'),
  check (drain_reserve_lamports <= global_cap_lamports)
);
alter table public.devnet_token_releases enable row level security;

-- All SOL costs, including HTS ATA/claim fees, share one serialized budget.
-- Preserve the accepted B2 function unchanged behind a non-callable wrapper.
alter function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint)
  rename to reserve_devnet_expense_b2_internal;

create function public.hts_budget_result(
  p_wallet text,p_lamports bigint,p_wallet_cap bigint,p_global_cap bigint,p_drain bigint
) returns text language plpgsql security definer set search_path='' as $$
declare v_global bigint; v_wallet bigint; v_day date := (now() at time zone 'UTC')::date;
begin
  select coalesce(sum(charged_lamports),0),
    coalesce(sum(charged_lamports) filter(where wallet=p_wallet),0)
    into v_global,v_wallet from public.devnet_expenses
    where status in ('reserved','submitted') or expense_day=v_day;
  select v_global+coalesce(sum(amount_lamports),0),
    v_wallet+coalesce(sum(amount_lamports) filter(where wallet=p_wallet),0)
    into v_global,v_wallet from public.sponsor_ledger
    where created_at >= (v_day::timestamp at time zone 'UTC');
  if v_wallet+p_lamports > p_wallet_cap then return 'wallet-cap'; end if;
  if v_global+p_lamports > p_global_cap-p_drain then return 'global-cap'; end if;
  return null;
end;
$$;

create function public.reserve_devnet_expense(
  p_operation_key text,p_wallet text,p_kind text,p_lamports bigint,
  p_wallet_cap bigint,p_global_cap bigint,p_drain_reserve bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare limits public.devnet_token_releases%rowtype; cap_result text;
begin
  if p_kind='faucet' then raise exception 'use-versioned-hts-entitlement' using errcode='55000'; end if;
  if p_lamports is null or p_lamports<0 or p_wallet_cap is null or p_wallet_cap<=0
    or p_global_cap is null or p_global_cap<=0 or p_drain_reserve is null
    or p_drain_reserve<0 or p_drain_reserve>p_global_cap then
    raise exception 'invalid-expense' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(734278126);
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
    where status='reserved' and raw_transaction is null and lease_expires_at<now();
  if not exists(select 1 from public.devnet_expenses where operation_key=p_operation_key and status<>'failed') then
    select * into limits from public.devnet_token_releases where entitlement_version='hts-v1';
    if not found then raise exception 'hts-operational-limits-unconfigured' using errcode='55000'; end if;
    cap_result := public.hts_budget_result(p_wallet,p_lamports,
      least(p_wallet_cap,limits.wallet_cap_lamports),least(p_global_cap,limits.global_cap_lamports),
      case when p_kind='settle' then p_drain_reserve else greatest(p_drain_reserve,limits.drain_reserve_lamports) end);
    if cap_result is not null then return jsonb_build_object('status',cap_result); end if;
  end if;
  return public.reserve_devnet_expense_b2_internal(p_operation_key,p_wallet,p_kind,p_lamports,p_wallet_cap,p_global_cap,p_drain_reserve);
end;
$$;

create or replace function public.devnet_expense_totals(p_wallet text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('global',coalesce(sum(amount),0),
   'wallet',coalesce(sum(amount) filter(where wallet=p_wallet),0))
 from (
  select wallet,charged_lamports amount from public.devnet_expenses
   where status in ('reserved','submitted') or expense_day=(now() at time zone 'UTC')::date
  union all
  select wallet,amount_lamports from public.sponsor_ledger
   where created_at >= ((now() at time zone 'UTC')::date::timestamp at time zone 'UTC')
 ) expenses;
$$;

create function public.reserve_hts_welcome(
  p_operation_key text, p_wallet text, p_mint text, p_lamports bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.devnet_expenses%rowtype;
  limits public.devnet_token_releases%rowtype;
  cap_result text;
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    or p_mint is null or p_operation_key is distinct from ('welcome-'||p_mint||'-'||p_wallet)
    or p_lamports is null or p_lamports < 0 or p_lamports > 50000000 then
    raise exception 'invalid-hts-entitlement' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(734278126);
  select * into limits from public.devnet_token_releases
    where mint=p_mint and entitlement_version='hts-v1' and enabled;
  if not found then
    raise exception 'hts-entitlement-disabled' using errcode='55000';
  end if;
  -- Same fencing and unknown-outcome holds as the accepted B2 journal.
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
    where status='reserved' and raw_transaction is null and lease_expires_at<now();
  select * into r from public.devnet_expenses
    where operation_key=p_operation_key and status<>'failed' for update;
  if found then
    if r.wallet<>p_wallet or r.kind<>'faucet' then
      raise exception 'expense-identity-mismatch' using errcode='22023';
    end if;
    return jsonb_build_object('status','existing','expense',to_jsonb(r));
  end if;
  -- Only evidence for THIS mint can consume the new entitlement. Historical
  -- faucet_claims has no mint column and cannot consume an HTS grant.
  if exists(select 1 from public.welcome_grants
    where wallet=p_wallet and mint=p_mint and status='completed') then
    return jsonb_build_object('status','legacy-completed');
  end if;
  cap_result := public.hts_budget_result(p_wallet,p_lamports,limits.wallet_cap_lamports,
    limits.global_cap_lamports,limits.drain_reserve_lamports);
  if cap_result is not null then return jsonb_build_object('status',cap_result); end if;
  if exists(select 1 from public.welcome_grants
    where wallet=p_wallet and mint=p_mint and status in ('pending','submitted','failed')) then
    return jsonb_build_object('status','legacy-pending');
  end if;
  insert into public.devnet_expenses(operation_key,wallet,kind,reserved_lamports,charged_lamports)
    values(p_operation_key,p_wallet,'faucet',p_lamports,p_lamports) returning * into r;
  return jsonb_build_object('status','reserved','expense',to_jsonb(r));
end;
$$;

-- Override provider default grants explicitly. Only the database owner can
-- approve a mint. Service workers can read it and call the fenced RPC.
revoke all on table public.devnet_token_releases from public;
revoke all on function public.reserve_hts_welcome(text,text,text,bigint) from public;
revoke all on function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint) from public;
revoke all on function public.reserve_devnet_expense_b2_internal(text,text,text,bigint,bigint,bigint,bigint) from public;
revoke all on function public.hts_budget_result(text,bigint,bigint,bigint,bigint) from public;
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on table public.devnet_token_releases from %I',r);
      execute format('revoke all on function public.reserve_hts_welcome(text,text,text,bigint) from %I',r);
      execute format('revoke all on function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint) from %I',r);
      execute format('revoke all on function public.reserve_devnet_expense_b2_internal(text,text,text,bigint,bigint,bigint,bigint) from %I',r);
      execute format('revoke all on function public.hts_budget_result(text,bigint,bigint,bigint,bigint) from %I',r);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select on public.devnet_token_releases to service_role;
    grant execute on function public.reserve_hts_welcome(text,text,text,bigint) to service_role;
    grant execute on function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint) to service_role;
  end if;
end;
$$;
commit;
