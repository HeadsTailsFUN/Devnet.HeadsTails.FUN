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

create function public.cancel_unsubmitted_devnet_expense(p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(734278126);
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
   where id=p_id and claim_token=p_claim_token and status='reserved' and raw_transaction is null;
  return found;
end;
$$;

create function public.submit_devnet_expense(
 p_id uuid,p_claim_token uuid,p_signature text,p_raw text,p_blockhash text,p_last_valid bigint
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.devnet_expenses set signature=p_signature,raw_transaction=p_raw,
    blockhash=p_blockhash,last_valid_block_height=p_last_valid,status='submitted',updated_at=now()
   where id=p_id and claim_token=p_claim_token and status='reserved'
     and raw_transaction is null and lease_expires_at > now();
  return found;
end;
$$;

create function public.finish_devnet_expense(p_id uuid,p_signature text,p_success boolean,p_charge bigint,p_day date)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(734278126);
  update public.devnet_expenses set status=case when p_success then 'confirmed' else 'failed' end,
    charged_lamports=p_charge,expense_day=p_day,updated_at=now()
   where id=p_id and signature=p_signature and status='submitted'
     and p_charge between 0 and reserved_lamports;
  return found;
end;
$$;

-- Deliberate operator-only recovery, never called by public request handlers.
-- Caller must independently establish historical non-inclusion and finalized
-- expiry using a complete trusted history source. Null status is NOT evidence.
-- It is safe to allow replacement only after no future inclusion is possible.
create function public.release_expired_unlanded_devnet_expense(
 p_id uuid,p_signature text,p_finalized_height bigint,p_evidence text
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.devnet_expenses%rowtype;
begin
  if p_finalized_height is null or p_evidence is null or length(p_evidence)<20 then
    raise exception 'reviewed-non-inclusion-evidence-required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(734278126);
  select * into r from public.devnet_expenses where id=p_id for update;
  if not found or r.status<>'submitted' or r.signature is distinct from p_signature
      or r.last_valid_block_height is null or p_finalized_height<=r.last_valid_block_height then
    return false;
  end if;
  insert into public.devnet_expense_resolutions(expense_id,signature,outcome,finalized_height,evidence)
    values(r.id,r.signature,'not-landed',p_finalized_height,p_evidence);
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now() where id=r.id;
  return true;
end;
$$;

create function public.issue_wallet_session_atomic(
 p_nonce text,p_wallet text,p_token_hash text,p_expires_at timestamptz,p_ip text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.auth_nonces set used_at=now()
   where nonce=p_nonce and wallet=p_wallet and used_at is null and expires_at>now();
  if not found then return false; end if;
  insert into public.auth_sessions(token_hash,wallet,expires_at,ip)
    values(p_token_hash,p_wallet,p_expires_at,p_ip);
  return true;
end;
$$;

-- Lease and saturating attempt count are atomic. After 60 fast attempts,
-- slow recovery remains possible; legitimate escrow is never discarded.
create function public.claim_devnet_settlement_job(p_match_id text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_attempts integer;
begin
  update public.settlement_jobs set attempts=least(attempts+1,60),status='in-progress',
    next_attempt_at=now()+interval '90 seconds',updated_at=now()
   where match_id=p_match_id and status<>'settled' and next_attempt_at<=now()
   returning attempts into v_attempts;
  return v_attempts;
end;
$$;

create function public.finish_devnet_settlement_attempt(p_match_id text,p_status text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.settlement_jobs set status=p_status,last_error=left(p_error,200),updated_at=now(),
    next_attempt_at=case when p_status='settled' then null else now()+
      case when attempts>=60 then interval '1 hour' when attempts<=1 then interval '2 seconds'
       when attempts=2 then interval '3 seconds' when attempts<=4 then interval '5 seconds'
       when attempts=5 then interval '10 seconds' when attempts=6 then interval '15 seconds'
       when attempts=7 then interval '30 seconds' else interval '60 seconds' end end
   where match_id=p_match_id and status<>'settled';
  return found;
end;
$$;

-- A separate decision record fixes eligibility without rewriting ANY points.
create table public.referral_match_decisions (
  season_id uuid not null references public.airdrop_seasons(id),
  invitee_wallet text not null,
  match_id text not null,
  ordinal bigint not null check(ordinal>0),
  primary key(season_id,invitee_wallet,match_id),
  unique(season_id,invitee_wallet,ordinal)
);
alter table public.referral_match_decisions enable row level security;
-- The versioned migration MUST run transactionally. Hold writers through
-- backfill + trigger installation so no new gameplay marker falls in a gap.
lock table public.airdrop_points_ledger in share row exclusive mode;
insert into public.referral_match_decisions(season_id,invitee_wallet,match_id,ordinal)
 select season_id,wallet,source_key,row_number() over(partition by season_id,wallet order by created_at,id)
 from public.airdrop_points_ledger where event_type='gameplay_match' and status='verified';

create function public.record_referral_match_decision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.event_type='gameplay_match' and new.status='verified' then
    perform pg_advisory_xact_lock(hashtext('referral-sequence:'||new.season_id::text||':'||new.wallet));
    insert into public.referral_match_decisions(season_id,invitee_wallet,match_id,ordinal)
     select new.season_id,new.wallet,new.source_key,coalesce(max(ordinal),0)+1
      from public.referral_match_decisions where season_id=new.season_id and invitee_wallet=new.wallet
     on conflict(season_id,invitee_wallet,match_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger referral_match_decision_after_gameplay after insert on public.airdrop_points_ledger
 for each row execute function public.record_referral_match_decision();

-- Retain the established processing-day caps and reward amounts. The new
-- wrapper checks the immutable per-match eligibility before reaching that RPC.
alter function public.award_referral_game_atomic(uuid,text,text,text) rename to award_referral_game_eligible_internal;
create function public.award_referral_game_atomic(p_season_id uuid,p_referrer text,p_invitee text,p_match_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.airdrop_points_ledger where season_id=p_season_id
      and wallet=p_referrer and event_type='referral_game' and source_key=p_match_id||':'||p_invitee) then
    return jsonb_build_object('status','exists');
  end if;
  if not exists(select 1 from public.referral_match_decisions where season_id=p_season_id
      and invitee_wallet=p_invitee and match_id=p_match_id and ordinal>3)
    or not exists(select 1 from public.airdrop_points_ledger where season_id=p_season_id
      and wallet=p_invitee and event_type='gameplay_match' and source_key=p_match_id and status='verified')
    or not exists(select 1 from public.referral_attributions where invitee_wallet=p_invitee
      and referrer_wallet=p_referrer and status='qualified') or p_referrer=p_invitee then
    return jsonb_build_object('status','ineligible');
  end if;
  return public.award_referral_game_eligible_internal(p_season_id,p_referrer,p_invitee,p_match_id);
end;
$$;

-- No public policies or public RPC privileges. The renamed implementation
-- must not remain an alternate service-role entry point around the wrapper.
revoke all on function public.award_referral_game_eligible_internal(uuid,text,text,text) from public;
do $$ declare f record; r text; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('reserve_devnet_expense','submit_devnet_expense',
    'finish_devnet_expense','devnet_expense_totals','cancel_unsubmitted_devnet_expense','release_expired_unlanded_devnet_expense','issue_wallet_session_atomic',
    'claim_devnet_settlement_job','finish_devnet_settlement_attempt','award_referral_game_atomic','record_referral_match_decision') loop
   execute format('revoke all on function %s from public',f.signature);
   foreach r in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %I',f.signature,r); end if;
   end loop;
   if exists(select 1 from pg_roles where rolname='service_role') and f.signature::text not like '%record_referral_match_decision%' then
    execute format('grant execute on function %s to service_role',f.signature);
   end if;
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   execute format('revoke all on function public.award_referral_game_eligible_internal(uuid,text,text,text) from %I',r);
   -- Provider default ACLs survive RLS, including for BYPASSRLS service roles.
   execute format('revoke all on table public.devnet_expenses, public.devnet_expense_resolutions, public.devnet_legacy_grant_clearances, public.referral_match_decisions from %I',r);
  end if;
 end loop;
 revoke all on table public.devnet_expenses, public.devnet_expense_resolutions,
   public.devnet_legacy_grant_clearances, public.referral_match_decisions from public;
 if exists(select 1 from pg_roles where rolname='service_role') then
  -- Journal and resolution mutations go only through the fenced definer RPCs.
  grant select on public.devnet_expenses to service_role;
  grant select on public.devnet_expense_resolutions to service_role;
  grant select,insert on public.devnet_legacy_grant_clearances to service_role;
  grant select on public.referral_match_decisions to service_role;
 end if;
end $$;
