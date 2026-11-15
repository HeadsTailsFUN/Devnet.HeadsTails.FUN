-- Earn Points verification V1. Additive, inactive by default. Never run on production without approval.
-- All functions are SECURITY INVOKER, executable only by service_role. No browser table policies.
create table public.earn_account_refs (
  wallet text primary key, account_ref uuid not null default gen_random_uuid() unique
);
create table public.earn_season_settings (
  season_id uuid primary key references public.airdrop_seasons(id),
  telegram_linking boolean not null default false,
  telegram_jobs boolean not null default false,
  discord_enabled boolean not null default false,
  x_manual_enabled boolean not null default false,
  new_rewards_enabled boolean not null default false,
  quest_flags jsonb not null default '{}'::jsonb
);
create table public.earn_social_links (
  id uuid primary key default gen_random_uuid(), provider text not null check(provider in ('telegram','discord')),
  wallet text not null, external_id text not null, active boolean not null default true,
  linked_at timestamptz not null default now(), unlinked_at timestamptz,
  membership_status text check(membership_status in ('VERIFIED','NOT_MEMBER','PENDING','UNAVAILABLE','ERROR')),
  membership_checked_at timestamptz,
  unique(provider,external_id)
);
create unique index earn_active_wallet_provider on public.earn_social_links(provider,wallet) where active;
create table public.earn_link_tokens (
  digest text primary key check(digest ~ '^[a-f0-9]{64}$'), wallet text not null,
  purpose text not null check(purpose in ('telegram','discord')),
  expires_at timestamptz not null, used_at timestamptz, used_by text,
  created_at timestamptz not null default now()
);
create index earn_tokens_wallet_time on public.earn_link_tokens(wallet,created_at);
create table public.earn_request_receipts (
  scope text not null, request_key text not null, body_digest text not null,
  response jsonb not null, created_at timestamptz not null default now(), primary key(scope,request_key)
);
create table public.earn_rate_windows (
  bucket text primary key, opened_at timestamptz not null default now(), count integer not null default 0
);
create table public.earn_verification_jobs (
  job_id text primary key default gen_random_uuid()::text,
  wallet text not null, season_id uuid not null references public.airdrop_seasons(id),
  telegram_user_id text not null, chat text not null check(chat in ('group','channel')), chat_id bigint not null check(chat_id<0),
  requested_at timestamptz not null default now(), expires_at timestamptz not null,
  lease_until timestamptz, completed_at timestamptz,
  result_status text check(result_status in ('VERIFIED','NOT_MEMBER','PENDING','UNAVAILABLE','ERROR')),
  checked_at timestamptz, result_digest text
);
create index earn_pending_jobs on public.earn_verification_jobs(requested_at) where completed_at is null;
create table public.earn_quest_claims (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.airdrop_seasons(id),
  wallet text not null, quest text not null check(quest in ('telegram_group','telegram_channel','discord_member','three_days')),
  external_id text, status text not null check(status in ('pending','verified','rejected')),
  evidence_ref text, created_at timestamptz not null default now(), verified_at timestamptz,
  unique(season_id,wallet,quest)
);
create unique index earn_identity_quest_once on public.earn_quest_claims(season_id,quest,external_id)
  where external_id is not null and status='verified';
create table public.earn_x_challenges (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.airdrop_seasons(id),
  wallet text not null, handle text not null, profile_url text not null, code text not null unique,
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  status text not null default 'available' check(status in ('available','submitted','verified','rejected','expired','needs_review')),
  claim_id uuid references public.airdrop_social_claims(id), reviewed_at timestamptz, review_reason text
);
create table public.earn_social_disconnects (
  wallet text not null, provider text not null check(provider='x'), disconnected boolean not null default false,
  updated_at timestamptz not null default now(), primary key(wallet,provider)
);
create table public.earn_verification_audit (
  id bigint generated always as identity primary key, account_ref uuid,
  event text not null, related_ref text, created_at timestamptz not null default now(),
  review_details jsonb
);
alter table public.airdrop_social_claims add column ownership_challenge_id uuid references public.earn_x_challenges(id);
alter table public.airdrop_social_claims add column campaign_url text;
alter table public.airdrop_social_claims add column verification_method text;
alter table public.airdrop_social_claims add column review_state text
  check(review_state in ('pending','approved','rejected','expired','needs_review'));

create function public.earn_eligible(p_wallet text,p_season uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.airdrop_seasons where id=p_season and active
   and starts_at<=now() and (ends_at is null or ends_at>now()))
 and not exists(select 1 from public.reward_exclusions where wallet=p_wallet and active)
 and not exists(select 1 from public.admin_members where wallet=p_wallet)
$$;
create function public.earn_three_day_progress(p_wallet text,p_season uuid,p_program text,p_mint text) returns integer
language sql stable security invoker set search_path='' as $$
 select least(3,count(distinct (m.settled_at at time zone 'UTC')::date))::integer
 from public.airdrop_points_ledger l join public.airdrop_seasons s on s.id=l.season_id
 join public.matches m on m.onchain_match_id=l.source_key and m.cluster='devnet'
   and m.program_id=p_program and m.token_mint=p_mint
 where l.wallet=p_wallet and l.season_id=p_season and l.event_type='gameplay_match' and l.status='verified'
 and m.settled_at is not null and m.settled_at>=s.starts_at and (s.ends_at is null or m.settled_at<s.ends_at)
 and (m.heads_wallet=p_wallet or m.tails_wallet=p_wallet)
 and m.winner_wallet=case m.result when 'HEADS' then m.heads_wallet when 'TAILS' then m.tails_wallet end
$$;
create function public.earn_award_quest(p_wallet text,p_season uuid,p_quest text,p_external text,p_evidence text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare pts integer; c public.earn_quest_claims%rowtype;
begin
 if not public.earn_eligible(p_wallet,p_season) then return '{"status":"ineligible"}'::jsonb; end if;
 if not exists(select 1 from public.earn_season_settings where season_id=p_season and new_rewards_enabled
   and coalesce((quest_flags->>p_quest)::boolean,false)) then return '{"status":"disabled"}'::jsonb; end if;
 pts:=case p_quest when 'telegram_group' then 20 when 'telegram_channel' then 5 when 'discord_member' then 15 when 'three_days' then 20 end;
 if pts is null then raise exception 'invalid-quest'; end if;
 select * into c from public.earn_quest_claims where season_id=p_season and wallet=p_wallet and quest=p_quest for update;
 if found and c.status='verified' then return '{"status":"already_claimed"}'::jsonb; end if;
 if p_external is not null and exists(select 1 from public.earn_quest_claims where season_id=p_season
   and quest=p_quest and external_id=p_external and wallet<>p_wallet and status='verified') then return '{"status":"conflict"}'::jsonb; end if;
 insert into public.earn_quest_claims(season_id,wallet,quest,external_id,status,evidence_ref,verified_at)
 values(p_season,p_wallet,p_quest,p_external,'verified',p_evidence,now())
 on conflict(season_id,wallet,quest) do update set external_id=excluded.external_id,status='verified',evidence_ref=excluded.evidence_ref,verified_at=now();
 insert into public.airdrop_points_ledger(season_id,wallet,category,event_type,source_key,points,status,verified_at,metadata)
 values(p_season,p_wallet,'social','quest_'||p_quest,p_quest,pts,'verified',now(),jsonb_build_object('quest',p_quest,'evidenceRef',p_evidence))
 on conflict(season_id,wallet,event_type,source_key) do nothing;
 return jsonb_build_object('status','awarded','points',pts);
end $$;

-- The lock is specific to these low-volume verification transactions; never held across network I/O.
-- It never locks or changes matchmaking, settlement or gameplay reward functions.
create function public.earn_dispatch(p_action text,p_wallet text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 s uuid; cfg public.earn_season_settings%rowtype; a uuid; r jsonb; receipt public.earn_request_receipts%rowtype;
 t public.earn_link_tokens%rowtype; link public.earn_social_links%rowtype; j public.earn_verification_jobs%rowtype;
 x public.earn_x_challenges%rowtype; claim public.airdrop_social_claims%rowtype;
 ext text; v_provider text; kind text; q text; req text; v_digest text; n integer; v_status text; jid text;
 b public.earn_rate_windows%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('headstails:earn-verification:v1',0));
 select id into s from public.airdrop_seasons where active limit 1;
 select * into cfg from public.earn_season_settings where season_id=s;
 if p_wallet is not null then
  insert into public.earn_account_refs(wallet) values(p_wallet) on conflict do nothing;
  select account_ref into a from public.earn_account_refs where wallet=p_wallet;
 end if;
 ext:=p_data->>'external_id'; req:=p_data->>'request_key'; v_digest:=p_data->>'body_digest';
 if req is not null and p_action in ('telegram_link','telegram_unlink','telegram_result') then
  select * into receipt from public.earn_request_receipts where scope=p_action and request_key=req;
  if found then
   if receipt.body_digest<>v_digest then raise exception 'idempotency-conflict'; end if;
   return receipt.response;
  end if;
 end if;
 if p_action='rate' then
  select * into b from public.earn_rate_windows where bucket=p_data->>'bucket';
  if not found or b.opened_at < now()-make_interval(secs=>(p_data->>'window')::integer) then
   insert into public.earn_rate_windows(bucket,opened_at,count) values(p_data->>'bucket',now(),1)
   on conflict(bucket) do update set opened_at=now(),count=1;
   return '{"allowed":true}'::jsonb;
  end if;
  if b.count >= (p_data->>'limit')::integer then return jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch from b.opened_at+make_interval(secs=>(p_data->>'window')::integer)-now())))); end if;
  update public.earn_rate_windows set count=count+1 where bucket=b.bucket;
  return '{"allowed":true}'::jsonb;
 elsif p_action='token' then
  v_provider:=p_data->>'provider';
  if (v_provider='telegram' and not coalesce(cfg.telegram_linking,false)) or
     (v_provider='discord' and not coalesce(cfg.discord_enabled,false)) or v_provider not in ('telegram','discord') then return '{"status":"disabled"}'::jsonb; end if;
  update public.earn_link_tokens set expires_at=least(expires_at,now()) where wallet=p_wallet and purpose=v_provider and used_at is null;
  insert into public.earn_link_tokens(digest,wallet,purpose,expires_at) values(p_data->>'digest',p_wallet,v_provider,now()+interval '10 minutes');
  r:=jsonb_build_object('status','created','expires_at',extract(epoch from now()+interval '10 minutes'));
 elsif p_action='telegram_link' then
  if not coalesce(cfg.telegram_linking,false) then return '{"ok":false,"status":"unavailable"}'::jsonb; end if;
  select * into t from public.earn_link_tokens where digest=p_data->>'token_digest' and purpose='telegram' for update;
  if not found then r:='{"ok":false,"status":"invalid"}';
  elsif t.used_at is not null then r:='{"ok":false,"status":"used"}';
  elsif t.expires_at<=now() then r:='{"ok":false,"status":"expired"}';
  elsif exists(select 1 from public.earn_social_links where provider='telegram' and external_id=ext and wallet<>t.wallet)
    or exists(select 1 from public.earn_social_links where provider='telegram' and wallet=t.wallet and active and external_id<>ext) then
    r:='{"ok":false,"status":"conflict"}';
  else
   select * into link from public.earn_social_links where provider='telegram' and external_id=ext;
   v_status:=case when found and link.active then 'already_linked' else 'linked' end;
   insert into public.earn_social_links(provider,wallet,external_id) values('telegram',t.wallet,ext)
   on conflict(provider,external_id) do update set active=true,unlinked_at=null;
   update public.earn_link_tokens set used_at=now(),used_by=ext where digest=t.digest;
   select account_ref into a from public.earn_account_refs where wallet=t.wallet;
   r:=jsonb_build_object('ok',true,'status',v_status,'account_ref',a);
  end if;
 elsif p_action='wallet_unlink' then
  v_provider:=p_data->>'provider';
  if v_provider='x' then
   insert into public.earn_social_disconnects(wallet,provider,disconnected) values(p_wallet,'x',true)
   on conflict(wallet,provider) do update set disconnected=true,updated_at=now();
  elsif v_provider in ('telegram','discord') then
   update public.earn_social_links set active=false,unlinked_at=now() where wallet=p_wallet and provider=v_provider and active;
   if v_provider='telegram' then update public.earn_verification_jobs set completed_at=now(),result_status='ERROR' where wallet=p_wallet and completed_at is null; end if;
  else raise exception 'invalid-provider'; end if;
  r:='{"status":"unlinked"}';
 elsif p_action='telegram_unlink' then
  -- The bot cannot unlink an active wallet by supplying a numeric user ID.
  -- Owner unlinks on the authenticated website first, then /unlink clears bot-local state.
  if exists(select 1 from public.earn_social_links where provider='telegram' and external_id=ext and active) then
   return '{"ok":false,"status":"unavailable","message":"Unlink on the website first, then retry /unlink."}'::jsonb;
  end if;
  r:='{"ok":true,"status":"not_linked"}';
 elsif p_action='discord_consume' then
  select * into t from public.earn_link_tokens where digest=p_data->>'digest' and purpose='discord' and wallet=p_wallet for update;
  if not found or t.used_at is not null or t.expires_at<=now() then return '{"status":"invalid_state"}'::jsonb; end if;
  update public.earn_link_tokens set used_at=now() where digest=t.digest;
  r:='{"status":"consumed"}';
 elsif p_action='discord_link' then
  if not coalesce(cfg.discord_enabled,false) then return '{"status":"disabled"}'::jsonb; end if;
  if exists(select 1 from public.earn_social_links where provider='discord' and external_id=ext and wallet<>p_wallet)
   or exists(select 1 from public.earn_social_links where provider='discord' and wallet=p_wallet and active and external_id<>ext) then return '{"status":"conflict"}'::jsonb; end if;
  insert into public.earn_social_links(provider,wallet,external_id,membership_status,membership_checked_at)
  values('discord',p_wallet,ext,p_data->>'membership',now())
  on conflict(provider,external_id) do update set active=true,unlinked_at=null,membership_status=excluded.membership_status,membership_checked_at=now();
  r:=jsonb_build_object('status','linked','membership',p_data->>'membership');
  if p_data->>'membership'='VERIFIED' and coalesce((p_data->>'award')::boolean,false) then
   r:=r||jsonb_build_object('reward',public.earn_award_quest(p_wallet,s,'discord_member',ext,'discord-oauth-member'));
  end if;
 elsif p_action='telegram_job' then
  if not coalesce(cfg.telegram_jobs,false) then return '{"status":"disabled"}'::jsonb; end if;
  kind:=p_data->>'chat'; if kind not in ('group','channel') then raise exception 'invalid-chat'; end if;
  select * into link from public.earn_social_links where wallet=p_wallet and provider='telegram' and active;
  if not found then return '{"status":"not_linked"}'::jsonb; end if;
  q:='telegram_'||kind;
  if exists(select 1 from public.earn_quest_claims where wallet=p_wallet and season_id=s and quest=q and status='verified') then return '{"status":"completed"}'::jsonb; end if;
  select * into j from public.earn_verification_jobs where wallet=p_wallet and season_id=s and chat=kind and completed_at is null and expires_at>now() order by requested_at desc limit 1;
  if not found then
   insert into public.earn_verification_jobs(wallet,season_id,telegram_user_id,chat,chat_id,expires_at)
   values(p_wallet,s,link.external_id,kind,(p_data->>'chat_id')::bigint,now()+interval '15 minutes') returning * into j;
  end if;
  r:=jsonb_build_object('status','pending','job_id',j.job_id);
 elsif p_action='telegram_poll' then
  if not coalesce(cfg.telegram_jobs,false) then return '{"ok":true,"jobs":[]}'::jsonb; end if;
  with picked as (
   select job_id from public.earn_verification_jobs where season_id=s and completed_at is null and expires_at>now()
    and (lease_until is null or lease_until<=now())
    and exists(select 1 from public.earn_social_links l where l.wallet=earn_verification_jobs.wallet and l.provider='telegram' and l.active and l.external_id=earn_verification_jobs.telegram_user_id)
    order by requested_at limit least(50,greatest(1,(p_data->>'limit')::integer)) for update skip locked
  ), leased as (
   update public.earn_verification_jobs leased_row set lease_until=now()+interval '120 seconds' from picked where leased_row.job_id=picked.job_id returning leased_row.*
  ) select jsonb_build_object('ok',true,'jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',job_id,'telegram_user_id',telegram_user_id::bigint,'chat',chat,'chat_id',chat_id,'requested_at',extract(epoch from requested_at),'expires_at',extract(epoch from expires_at))),'[]'::jsonb)) into r from leased;
 elsif p_action='telegram_result' then
  select * into j from public.earn_verification_jobs where job_id=p_data->>'job_id' for update;
  if not found then raise exception 'unknown-job'; end if;
  if j.telegram_user_id<>ext or j.chat<>p_data->>'chat' or j.chat_id<>(p_data->>'chat_id')::bigint then raise exception 'job-scope-conflict'; end if;
  if j.completed_at is not null then
   if j.result_digest=v_digest then return '{"ok":true}'::jsonb; end if;
   raise exception 'idempotency-conflict';
  end if;
  v_status:=p_data->>'status';
  if j.lease_until is null or j.expires_at<=now() or to_timestamp((p_data->>'checked_at')::double precision)<j.requested_at-interval '5 seconds'
   or to_timestamp((p_data->>'checked_at')::double precision)>least(j.expires_at,now()+interval '300 seconds')
   or not exists(select 1 from public.earn_social_links where provider='telegram' and wallet=j.wallet and external_id=ext and active)
   then v_status:='ERROR'; end if;
  update public.earn_verification_jobs set completed_at=now(),result_status=v_status,checked_at=to_timestamp((p_data->>'checked_at')::double precision),result_digest=v_digest where job_id=j.job_id;
  if v_status='VERIFIED' and coalesce(cfg.telegram_jobs,false) and coalesce((p_data->>'award')::boolean,false) then
   perform public.earn_award_quest(j.wallet,j.season_id,'telegram_'||j.chat,ext,j.job_id);
  end if;
  select account_ref into a from public.earn_account_refs where wallet=j.wallet;
  r:='{"ok":true}';
 elsif p_action='three_days' then
  n:=public.earn_three_day_progress(p_wallet,s,p_data->>'program',p_data->>'mint');
  r:=jsonb_build_object('status','in_progress','days',n);
  if n=3 and coalesce((p_data->>'award')::boolean,false) then r:=public.earn_award_quest(p_wallet,s,'three_days',null,'three-distinct-settled-utc-days')||jsonb_build_object('days',n); end if;
 elsif p_action='x_challenge' then
  if not coalesce(cfg.x_manual_enabled,false) then return '{"status":"disabled"}'::jsonb; end if;
  if exists(select 1 from public.airdrop_x_identities where season_id=s and wallet=p_wallet and lower(x_handle)<>p_data->>'handle') then return '{"status":"conflict"}'::jsonb; end if;
  update public.earn_x_challenges set status='expired' where wallet=p_wallet and season_id=s and status in ('available','submitted','needs_review');
  insert into public.earn_x_challenges(season_id,wallet,handle,profile_url,code,expires_at)
   values(s,p_wallet,p_data->>'handle',p_data->>'profile_url',p_data->>'code',now()+interval '24 hours') returning * into x;
  r:=jsonb_build_object('status','created','challenge_id',x.id,'code',x.code,'profile_url',x.profile_url,'expires_at',x.expires_at);
 elsif p_action='x_submit' then
  if not coalesce(cfg.x_manual_enabled,false) then return '{"status":"disabled"}'::jsonb; end if;
  select * into x from public.earn_x_challenges where id=(p_data->>'challenge_id')::uuid and wallet=p_wallet and season_id=s for update;
  if not found or x.expires_at<=now() or x.status='expired' then return '{"status":"expired"}'::jsonb; end if;
  if x.status in ('submitted','verified') then return jsonb_build_object('status',x.status); end if;
  perform public.create_airdrop_social_claim_atomic(s,p_wallet,'connect_x',x.handle,x.profile_url,null,null,100);
  select * into claim from public.airdrop_social_claims where wallet=p_wallet and season_id=s and task_type='connect_x' for update;
  update public.airdrop_social_claims set ownership_challenge_id=x.id,verification_method='manual_bio_challenge',review_state='pending',status=case when claim.status='verified' then claim.status else 'pending' end where id=claim.id;
  if claim.status<>'verified' then update public.airdrop_points_ledger set status='pending',verified_at=null where season_id=s and wallet=p_wallet and event_type='social_connect_x' and source_key=claim.id::text; end if;
  update public.earn_x_challenges set status='submitted',claim_id=claim.id where id=x.id;
  r:='{"status":"pending"}';
 elsif p_action='x_evidence' then
  if not coalesce(cfg.x_manual_enabled,false) then return '{"status":"disabled"}'::jsonb; end if;
  kind:=p_data->>'task';
  if kind not in ('repost','reply') then raise exception 'invalid-task'; end if;
  if not exists(select 1 from public.airdrop_x_identities where season_id=s and wallet=p_wallet and status='verified' and lower(x_handle)=lower(p_data->>'handle'))
   or exists(select 1 from public.earn_social_disconnects where wallet=p_wallet and disconnected) then raise exception 'verified-ownership-required'; end if;
  if coalesce((p_data->>'edit')::boolean,false) then
   r:=public.update_airdrop_social_claim_atomic(s,p_wallet,kind,p_data->>'handle',p_data->>'evidence');
  else
   r:=public.create_airdrop_social_claim_atomic(s,p_wallet,kind,p_data->>'handle','https://x.com/'||(p_data->>'handle'),p_data->>'evidence',null,case when kind='repost' then 75 else 50 end);
  end if;
  update public.airdrop_social_claims set campaign_url=p_data->>'campaign',verification_method='manual_campaign_evidence',review_state='pending'
   where wallet=p_wallet and season_id=s and task_type=kind and status<>'verified';
 elsif p_action='x_review' then
  if not coalesce(cfg.x_manual_enabled,false) then return '{"status":"disabled"}'::jsonb; end if;
  select * into claim from public.airdrop_social_claims where id=(p_data->>'claim_id')::uuid for update;
  if not found then raise exception 'unknown-claim'; end if;
  if length(btrim(coalesce(p_data->>'reason','')))<5 then raise exception 'reason-required'; end if;
  v_status:=p_data->>'decision';
  if v_status='verified' and not public.earn_eligible(claim.wallet,claim.season_id) then raise exception 'ineligible'; end if;
  if v_status not in ('verified','rejected','needs_review') then raise exception 'invalid-decision'; end if;
  if claim.task_type='connect_x' then
   select * into x from public.earn_x_challenges where id=claim.ownership_challenge_id for update;
   if v_status='verified' and (not found or x.status not in ('submitted','verified') or x.expires_at<=now() or not coalesce((p_data->>'ownership_confirmed')::boolean,false)) then raise exception 'ownership-challenge-required'; end if;
  elsif v_status='verified' then
   if not exists(select 1 from public.airdrop_x_identities where wallet=claim.wallet and season_id=claim.season_id and status='verified')
    or claim.evidence_url is null or claim.campaign_url is null or not coalesce((p_data->>'evidence_confirmed')::boolean,false) then raise exception 'evidence-review-required'; end if;
  end if;
  if claim.task_type='connect_x' and x.status=(case when v_status='verified' then 'verified' when v_status='rejected' then 'rejected' else 'needs_review' end) then return '{"status":"unchanged"}'::jsonb; end if;
  if claim.status<>'verified' or claim.task_type<>'connect_x' then
   perform public.review_airdrop_social_claim_atomic(claim.id,case when v_status='needs_review' then 'rejected' else v_status end,p_wallet,p_data->>'reason');
  end if;
  update public.airdrop_social_claims set review_state=case when v_status='verified' then 'approved' else v_status end,review_note=p_data->>'reason',reviewer_wallet=p_wallet,reviewed_at=now() where id=claim.id;
  if claim.task_type='connect_x' then
   update public.earn_x_challenges set status=v_status,review_reason=p_data->>'reason',reviewed_at=now() where id=x.id;
   if v_status='verified' then insert into public.earn_social_disconnects(wallet,provider,disconnected) values(claim.wallet,'x',false) on conflict(wallet,provider) do update set disconnected=false,updated_at=now(); end if;
  end if;
  select account_ref into a from public.earn_account_refs where wallet=claim.wallet;
  r:=jsonb_build_object('status',v_status);
 else raise exception 'invalid-action'; end if;
 if req is not null and p_action in ('telegram_link','telegram_unlink','telegram_result') then
  insert into public.earn_request_receipts(scope,request_key,body_digest,response) values(p_action,req,v_digest,r);
 end if;
 insert into public.earn_verification_audit(account_ref,event,related_ref,review_details)
 values(a,p_action,coalesce(p_data->>'job_id',p_data->>'claim_id'),
  case when p_action='x_review' then jsonb_build_object('reviewer',p_wallet,'decision',v_status,'reason',p_data->>'reason',
   'ownership_confirmed',coalesce((p_data->>'ownership_confirmed')::boolean,false),'evidence_confirmed',coalesce((p_data->>'evidence_confirmed')::boolean,false)) else null end);
 return r;
end $$;

-- Deny browser roles on new data and RPCs. Existing reward tables/functions retain their contracts.
do $perm$ declare t text; f record; begin
 foreach t in array array['earn_account_refs','earn_season_settings','earn_social_links','earn_link_tokens','earn_request_receipts','earn_rate_windows','earn_verification_jobs','earn_quest_claims','earn_x_challenges','earn_social_disconnects','earn_verification_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 grant usage,select on sequence public.earn_verification_audit_id_seq to service_role;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('earn_eligible','earn_three_day_progress','earn_award_quest','earn_dispatch') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $perm$;
insert into public.earn_season_settings(season_id) select id from public.airdrop_seasons on conflict do nothing;
