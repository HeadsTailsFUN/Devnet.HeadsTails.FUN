-- Proposed additive Devnet operational migration; NOT applied to hosted systems.
-- Requires separately approved pg_cron/pg_net provisioning and existing Vault.
-- Installs no job, enables no scheduler, stores no credential literal.
begin;
do $$ begin
  if exists(select 1 from net.http_request_queue) or exists(select 1 from net._http_response)
    then raise exception 'Dedicated empty pg_net prerequisite not satisfied; review existing consumers'; end if;
end $$;
-- Managed pg_net grants are retained. Queue headers contain only a short-lived,
-- single-use MAC for this exact maintenance intent, never the HMAC secret.
-- Database login roles remain trusted for availability; net must not be Data API exposed.
do $$begin if to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
 raise exception 'Reviewed pgcrypto HMAC prerequisite missing'; end if; end $$;
create schema headstails_recovery;
revoke all on schema headstails_recovery from public,anon,authenticated,service_role;
create table headstails_recovery.control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  origin text check(origin ~ '^https://headstails-devnet-beta[a-z0-9-]*[.]vercel[.]app$'),
  mint text check(mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    and mint <> 'BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh'),
  secret_id uuid,
  last_request_nonce text,
  last_request_timestamp bigint,
  request_claimed boolean not null default false,
  max_calls_per_day integer not null default 1440 check(max_calls_per_day between 1 and 1440),
  calls_day date not null default (now() at time zone 'UTC')::date,
  calls_today integer not null default 0 check(calls_today>=0),
  failures integer not null default 0 check(failures between 0 and 5),
  last_request_id bigint,
  last_requested_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  outcome text not null default 'DISABLED',
  last_http_status integer,
  last_completed_at timestamptz,
  check(not enabled or (origin is not null and mint is not null and secret_id is not null))
);
alter table headstails_recovery.control enable row level security;
revoke all on headstails_recovery.control from public,anon,authenticated,service_role;
insert into headstails_recovery.control(singleton) values(true);

-- Pure health parser. Do not store raw response bodies or error messages here.
create function headstails_recovery.response_health(body text)
returns text language plpgsql immutable set search_path='' as $$
declare b jsonb; room jsonb; seen integer:=0; tiers integer[]:='{}';
begin
  begin b:=body::jsonb; exception when others then return 'INVALID_BODY'; end;
  if b is null or jsonb_typeof(b)<>'object' or b->>'status' is distinct from 'cron-maintained'
    or jsonb_typeof(b->'rooms') is distinct from 'array'
    or jsonb_array_length(b->'rooms')<>2 then return 'INVALID_BODY'; end if;
  for room in select value from jsonb_array_elements(b->'rooms') loop
    if jsonb_typeof(room)<>'object' or room->>'tierUsd' not in ('1','10')
      or room->>'tierUsd' is null then return 'INVALID_BODY'; end if;
    tiers:=array_append(tiers,(room->>'tierUsd')::integer);seen:=seen+1;
    if room ? 'error' or jsonb_typeof(room->'invariants') is distinct from 'array'
      or jsonb_array_length(room->'invariants')>0 then return 'PARTIAL_FAILURE'; end if;
  end loop;
  if not (1=any(tiers) and 10=any(tiers)) then return 'INVALID_BODY'; end if;
  if jsonb_typeof(b->'settle') is distinct from 'object' or b->'settle' ? 'error'
    or jsonb_typeof(b->'settle'->'errors') is distinct from 'array'
    or jsonb_array_length(b->'settle'->'errors')>0 then return 'PARTIAL_FAILURE'; end if;
  if jsonb_typeof(b->'rewards') is distinct from 'object' or b->'rewards' ? 'error'
    or jsonb_typeof(b->'rewards'->'failed') is distinct from 'number'
    or b->'rewards'->>'failed' is distinct from '0'
    or jsonb_typeof(b->'rewards'->'errors') is distinct from 'array'
    or jsonb_array_length(b->'rewards'->'errors')>0
    then return 'PARTIAL_FAILURE'; end if;
  -- Pending ORAO is a successful maintenance attempt, not evidence of payout.
  return 'HEALTHY_ATTEMPT';
exception when others then return 'INVALID_BODY';
end $$;

create function headstails_recovery.tick()
returns text language plpgsql security definer set search_path='' as $$
declare s headstails_recovery.control%rowtype; r record; result text; token text;
  t timestamptz:=clock_timestamp(); request_id bigint; response_exists boolean;
  nonce text; stamp bigint; mac text; message text;
begin
  begin select * into strict s from headstails_recovery.control where singleton for update nowait;
  exception when lock_not_available then return 'LOCKED'; end;
  if not s.enabled then return 'DISABLED'; end if;
  -- Queue ACLs are provider-managed; authorization uses a scoped single-use MAC.
  if s.failures>=5 then
    update headstails_recovery.control set enabled=false,outcome='CIRCUIT_OPEN' where singleton;
    return 'CIRCUIT_OPEN';
  end if;
  if s.last_request_id is not null then
    select * into r from net._http_response where id=s.last_request_id;
    response_exists:=found;
    if not response_exists then
      if t-s.last_requested_at < interval '95 seconds' then return 'IN_FLIGHT'; end if;
      -- Never replay an unknown send. Remove only our still-queued request,
      -- stop and require reconciliation; an already-running call cannot be undone.
      delete from net.http_request_queue where id=s.last_request_id;
      update headstails_recovery.control set enabled=false,outcome='UNKNOWN_RESPONSE_HOLD' where singleton;
      return 'UNKNOWN_RESPONSE_HOLD';
    end if;
    if coalesce(r.timed_out,false) or r.error_msg is not null then
      update headstails_recovery.control set enabled=false,outcome='TRANSPORT_UNKNOWN_HOLD',
        last_http_status=r.status_code,last_completed_at=t where singleton;
      return 'TRANSPORT_UNKNOWN_HOLD';
    end if;
    if r.status_code in (401,403,404) or r.status_code between 300 and 399 then
      update headstails_recovery.control set enabled=false,outcome='TARGET_AUTH_HOLD',
        last_http_status=r.status_code,last_completed_at=t where singleton;
      return 'TARGET_AUTH_HOLD';
    end if;
    if r.status_code between 200 and 299 then result:=headstails_recovery.response_health(r.content);
    else result:='HTTP_FAILURE'; end if;
    s.failures:=case when result='HEALTHY_ATTEMPT' then 0 else least(s.failures+1,5) end;
    s.next_attempt_at:=greatest(s.next_attempt_at,case when s.failures=0 then t
      else t+make_interval(secs=>least(60*(2^(s.failures-1))::integer,900)) end);
    update headstails_recovery.control set last_request_id=null,last_requested_at=null,
      failures=s.failures,next_attempt_at=s.next_attempt_at,outcome=result,
      last_http_status=r.status_code,last_completed_at=t where singleton;
    if s.failures>=5 then
      update headstails_recovery.control set enabled=false,outcome='CIRCUIT_OPEN' where singleton;
      return 'CIRCUIT_OPEN';
    end if;
  end if;
  if s.next_attempt_at>t then return 'BACKOFF'; end if;
  -- Deny admission when the approved HTS namespace is not enabled.
  if not exists(select 1 from public.devnet_token_releases where mint=s.mint
    and entitlement_version='hts-v1' and enabled) then
    update headstails_recovery.control set enabled=false,outcome='REGISTRY_HOLD' where singleton;
    return 'REGISTRY_HOLD';
  end if;
  if s.calls_day<>(t at time zone 'UTC')::date then s.calls_today:=0; end if;
  if s.calls_today>=s.max_calls_per_day then
    update headstails_recovery.control set outcome='DAILY_CAP' where singleton;return 'DAILY_CAP';
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=s.secret_id;
  if token is null or token !~ '^[a-f0-9]{64}$' then
    update headstails_recovery.control set enabled=false,outcome='SECRET_HOLD' where singleton;
    return 'SECRET_HOLD';
  end if;
  -- Fixed path and bounded timeout. The Vercel route remains maxDuration=60.
  nonce:=gen_random_uuid()::text;
  stamp:=floor(extract(epoch from t))::bigint;
  message:=concat_ws(E'\n','headstails-recovery-v1','GET','/api/cron/maintain-rooms',s.origin,s.mint,stamp::text,nonce);
  mac:=encode(extensions.hmac(convert_to(message,'UTF8'),convert_to(token,'UTF8'),'sha256'),'hex');
  request_id:=net.http_get(url:=s.origin||'/api/cron/maintain-rooms',params:='{}'::jsonb,
    headers:=jsonb_build_object('x-ht-recovery-time',stamp::text,'x-ht-recovery-nonce',nonce,'x-ht-recovery-mac',mac),timeout_milliseconds:=65000);
  if request_id is null then raise exception 'Request enqueue failed'; end if;
  token:=null;
  update headstails_recovery.control set calls_day=(t at time zone 'UTC')::date,
    calls_today=s.calls_today+1,last_request_id=request_id,last_requested_at=t,
    last_request_nonce=nonce,last_request_timestamp=stamp,request_claimed=false,
    next_attempt_at=t+interval '60 seconds',outcome='QUEUED' where singleton;
  return 'QUEUED';
exception when others then
  -- Subtransaction rolls back any enqueue; emit no raw extension/secret error.
  update headstails_recovery.control set enabled=false,outcome='INTERNAL_HOLD' where singleton;
  return 'INTERNAL_HOLD';
end $$;

create function headstails_recovery.disable()
returns void language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
  select last_request_id into request_id from headstails_recovery.control where singleton for update;
  delete from net.http_request_queue where id=request_id;
  update headstails_recovery.control set enabled=false,outcome='OWNER_DISABLED' where singleton;
  -- Keep pending identity for reconciliation; never reset unknown operations.
end $$;
revoke all on all functions in schema headstails_recovery from public,anon,authenticated,service_role;
revoke all on all tables in schema headstails_recovery from public,anon,authenticated,service_role;
-- Called only after the app verifies HMAC; atomic consumption also fences restarts.
create function public.claim_headstails_recovery_request(p_nonce text,p_timestamp text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed boolean;
begin
 update headstails_recovery.control set request_claimed=true
 where singleton and enabled and not request_claimed and last_request_id is not null
   and last_request_nonce=p_nonce and last_request_timestamp::text=p_timestamp
   and floor(extract(epoch from clock_timestamp()))-last_request_timestamp between -10 and 120
 returning true into claimed;
 return coalesce(claimed,false);
end $$;
revoke all on function public.claim_headstails_recovery_request(text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_headstails_recovery_request(text,text) to service_role;
commit;
