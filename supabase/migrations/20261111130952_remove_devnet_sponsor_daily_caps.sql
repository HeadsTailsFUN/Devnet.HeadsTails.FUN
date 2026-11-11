-- Owner-approved Devnet SOL sponsorship: remove daily quotas, retain journal and transfer controls.
-- Existing numerical limits remain stored for explicit rollback; only this pinned release is opted out.
alter table public.devnet_token_releases
  add column daily_sol_caps_enabled boolean not null default true;

create or replace function public.reserve_devnet_expense_b2_internal(
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
  if p_lamports is null or p_drain_reserve is null
     or p_operation_key is null or p_wallet is null or p_kind is null
     or p_lamports < 0 or (p_wallet_cap is not null and p_wallet_cap <= 0)
     or (p_global_cap is not null and p_global_cap <= 0)
     or p_drain_reserve < 0 or (p_global_cap is not null and p_drain_reserve > p_global_cap)
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
    if p_wallet_cap is not null and v_wallet+p_lamports > p_wallet_cap then return jsonb_build_object('status','wallet-cap'); end if;
    if p_global_cap is not null and v_global+p_lamports > p_global_cap-p_drain_reserve then
      return jsonb_build_object('status','global-cap');
    end if;
  end if;
  insert into public.devnet_expenses(operation_key,wallet,kind,reserved_lamports,charged_lamports)
    values(p_operation_key,p_wallet,p_kind,p_lamports,p_lamports) returning * into r;
  return jsonb_build_object('status','reserved','expense',to_jsonb(r));
end;
$$;

create or replace function public.hts_budget_result(
  p_wallet text,p_lamports bigint,p_wallet_cap bigint,p_global_cap bigint,p_drain bigint
) returns text language plpgsql security definer set search_path='' as $$
declare totals jsonb := public.devnet_expense_totals(p_wallet);
begin
  if exists(select 1 from public.devnet_token_releases
    where entitlement_version='hts-v1' and enabled
      and mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
      and not daily_sol_caps_enabled) then return null; end if;
  if (totals->>'wallet')::bigint+p_lamports > p_wallet_cap then return 'wallet-cap'; end if;
  if (totals->>'global')::bigint+p_lamports > p_global_cap-p_drain then return 'global-cap'; end if;
  return null;
end;
$$;

create or replace function public.reserve_devnet_expense(
  p_operation_key text,p_wallet text,p_kind text,p_lamports bigint,
  p_wallet_cap bigint,p_global_cap bigint,p_drain_reserve bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  limits public.devnet_token_releases%rowtype;
  cap_result text;
  service_spend bigint;
  service_wallet constant text := '3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw';
  service_cap constant bigint := 10000000000;
  service_drain constant bigint := 50000000;
  service_operation boolean;
begin
  if p_kind='faucet' then raise exception 'use-versioned-hts-entitlement' using errcode='55000'; end if;
  if p_lamports is null or p_lamports<0 or (p_wallet_cap is not null and p_wallet_cap<=0)
    or (p_global_cap is not null and p_global_cap<=0) or p_drain_reserve is null
    or p_drain_reserve<0 or (p_global_cap is not null and p_drain_reserve>p_global_cap) then
    raise exception 'invalid-expense' using errcode='22023';
  end if;
  select * into limits from public.devnet_token_releases where entitlement_version='hts-v1';
  if not found then raise exception 'hts-operational-limits-unconfigured' using errcode='55000'; end if;
  if limits.enabled and limits.mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
      and not limits.daily_sol_caps_enabled then
    -- B2 still serializes, fences identities, preserves holds and verifies retries.
    -- Null disables only daily quotas; no synthetic high spending ceiling.
    return public.reserve_devnet_expense_b2_internal(
      p_operation_key,p_wallet,p_kind,p_lamports,null,null,0);
  end if;
  if p_wallet_cap is null or p_global_cap is null then
    raise exception 'daily-limits-required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(734278126);
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
    where status='reserved' and raw_transaction is null and lease_expires_at<now();
  -- Existing operation keys still go through B2's identity fence before reuse.
  if exists(select 1 from public.devnet_expenses where operation_key=p_operation_key and status<>'failed') then
    return public.reserve_devnet_expense_b2_internal(p_operation_key,p_wallet,p_kind,p_lamports,p_wallet_cap,p_global_cap,p_drain_reserve);
  end if;
  select * into limits from public.devnet_token_releases where entitlement_version='hts-v1';
  if not found then raise exception 'hts-operational-limits-unconfigured' using errcode='55000'; end if;
  service_operation := limits.enabled
    and limits.mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
    and p_wallet=service_wallet and p_kind in ('match','advance','settle');
  select coalesce(sum(charged_lamports),0)::bigint into service_spend
  from public.devnet_expenses
  where wallet=service_wallet and kind in ('match','advance','settle')
    and (status in ('reserved','submitted') or expense_day=(now() at time zone 'UTC')::date);
  if service_operation then
    if p_lamports > service_cap - service_spend - (case when p_kind='settle' then 0 else service_drain end) then
      return jsonb_build_object('status','wallet-cap');
    end if;
    -- B2 still sees player expenses. Account for that existing spend without
    -- charging it to the service quota or increasing the player allowance.
    return public.reserve_devnet_expense_b2_internal(p_operation_key,p_wallet,p_kind,p_lamports,
      service_cap,service_cap+(public.devnet_expense_totals(null)->>'global')::bigint,0);
  end if;
  cap_result := public.hts_budget_result(p_wallet,p_lamports,
    least(p_wallet_cap,limits.wallet_cap_lamports),least(p_global_cap,limits.global_cap_lamports),
    case when p_kind='settle' then p_drain_reserve else greatest(p_drain_reserve,limits.drain_reserve_lamports) end);
  if cap_result is not null then return jsonb_build_object('status',cap_result); end if;
  -- B2's combined read includes these already-accounted service expenses.
  return public.reserve_devnet_expense_b2_internal(p_operation_key,p_wallet,p_kind,p_lamports,
    p_wallet_cap,p_global_cap+service_spend,p_drain_reserve);
end;
$$;

revoke all on function public.reserve_devnet_expense_b2_internal(text,text,text,bigint,bigint,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.hts_budget_result(text,bigint,bigint,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_devnet_expense(text,text,text,bigint,bigint,bigint,bigint) to service_role;

do $$
begin
  update public.devnet_token_releases set daily_sol_caps_enabled=false
    where entitlement_version='hts-v1' and enabled
      and mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4';
  if not found then raise exception 'approved-devnet-release-not-found'; end if;
end;
$$;
