-- Read-only, server-only activity reporting. Existing game/reward writers are unchanged.
create view public.admin_earn_activity_events with (security_invoker=true) as
with ledger as (
 select l.season_id,l.wallet,
   case when l.event_type='win_bonus_match' then 'gameplay_match' else l.event_type end as event_type,
   l.source_key,min(l.id::text) as id,min(l.created_at) as occurred_at,
   case when bool_or(l.status='pending') then 'pending' when bool_or(l.status='verified') then 'verified' else 'rejected' end as status,
   sum(l.points)::bigint as points,coalesce(sum(l.points) filter(where l.status='verified'),0)::bigint as verified_points,
   bool_or(l.metadata->>'outcome'='win' or l.event_type='win_bonus_match') as win,
   bool_or(l.metadata->>'outcome'='loss') as loss,
   max(l.metadata->>'reason') as reason
 from public.airdrop_points_ledger l
 group by l.season_id,l.wallet,case when l.event_type='win_bonus_match' then 'gameplay_match' else l.event_type end,l.source_key
), claims as (
 select c.*,case when c.status not in ('verified','rejected') and x.expires_at<=now() then 'expired'
   when coalesce(c.review_state,c.status)='approved' then 'verified' else coalesce(c.review_state,c.status) end as effective_status
 from public.airdrop_social_claims c left join public.earn_x_challenges x on x.id=c.ownership_challenge_id
)
select 'ledger:'||l.id as id,l.season_id,l.wallet,
 case when l.event_type='gameplay_match' then case when l.win then 'win' when l.loss then 'loss' else 'other' end
   when l.event_type='referral_qualify_referrer' then 'referral_inviter'
   when l.event_type='referral_qualify_invitee' then 'referral_invitee'
   when l.event_type='referral_game' then 'referral_recurring'
   when l.event_type in ('social_connect_x','social_repost','social_reply') then substr(l.event_type,8)
   when l.event_type like 'quest_%' then substr(l.event_type,7)
   when l.event_type='manual_adjustment' then 'adjustment' else 'other' end as activity,
 coalesce(c.effective_status,l.status) as status,coalesce(c.created_at,l.occurred_at) as occurred_at,
 l.points,l.verified_points,case when c.id is not null then 'social_claim' else 'ledger' end as source_type,
 l.source_key,jsonb_strip_nulls(jsonb_build_object('eventType',l.event_type,'reason',coalesce(c.review_note,l.reason),
   'claimId',c.id,'xHandle',c.x_handle,'profileUrl',c.x_profile_url,'evidenceUrl',c.evidence_url,
   'campaignUrl',c.campaign_url,'reviewedAt',c.reviewed_at)) as details
from ledger l left join claims c on c.id::text=l.source_key and c.season_id=l.season_id and c.wallet=l.wallet
  and l.event_type='social_'||c.task_type
union all
select 'claim:'||c.id,c.season_id,c.wallet,c.task_type,c.effective_status,c.created_at,0::bigint,0::bigint,
 'social_claim',c.id::text,jsonb_strip_nulls(jsonb_build_object('claimId',c.id,'xHandle',c.x_handle,
 'profileUrl',c.x_profile_url,'evidenceUrl',c.evidence_url,'campaignUrl',c.campaign_url,'reason',c.review_note,'reviewedAt',c.reviewed_at))
from claims c where not exists(select 1 from ledger l where l.season_id=c.season_id and l.wallet=c.wallet and l.source_key=c.id::text and l.event_type='social_'||c.task_type)
union all
select 'quest:'||q.id,q.season_id,q.wallet,q.quest,q.status,q.created_at,0::bigint,0::bigint,
 'quest_claim',q.id::text,jsonb_build_object('verifiedAt',q.verified_at)
from public.earn_quest_claims q where not exists(select 1 from ledger l where l.season_id=q.season_id and l.wallet=q.wallet and l.event_type='quest_'||q.quest)
union all
select 'job:'||j.job_id,j.season_id,j.wallet,'telegram_'||j.chat,
 case when j.completed_at is null then case when j.expires_at<=now() then 'expired' else 'pending' end
   when j.result_status='VERIFIED' then 'verified' when j.result_status='NOT_MEMBER' then 'rejected'
   when j.result_status='PENDING' then 'needs_review' else 'unavailable' end,
 j.requested_at,0::bigint,0::bigint,'membership_check',j.job_id,
 jsonb_build_object('checkStatus',j.result_status,'checkedAt',j.checked_at,'expiresAt',j.expires_at)
from public.earn_verification_jobs j
where not (coalesce(j.result_status='VERIFIED',false) and exists(select 1 from public.earn_quest_claims q where q.season_id=j.season_id and q.wallet=j.wallet and q.quest='telegram_'||j.chat and q.status='verified'))
union all
select 'challenge:'||x.id,x.season_id,x.wallet,'connect_x',case when x.expires_at<=now() then 'expired' else 'in_progress' end,
 x.created_at,0::bigint,0::bigint,'ownership_challenge',x.id::text,
 jsonb_build_object('profileUrl',x.profile_url,'xHandle',x.handle,'expiresAt',x.expires_at)
from public.earn_x_challenges x where x.claim_id is null
union all
select 'connection:'||l.id,s.id,l.wallet,l.provider||'_connection',case when l.active then 'connected' else 'disconnected' end,
 coalesce(l.unlinked_at,l.linked_at),0::bigint,0::bigint,'connection',l.id::text,
 jsonb_build_object('provider',l.provider,'membership',l.membership_status,'linkedAt',l.linked_at,'unlinkedAt',l.unlinked_at)
from public.earn_social_links l join public.airdrop_seasons s on l.linked_at>=s.starts_at and (s.ends_at is null or l.linked_at<s.ends_at)
union all
select 'referral:'||a.invitee_wallet||':'||v.activity,s.id,v.wallet,v.activity,
 case a.status when 'qualified' then 'verified' when 'blocked' then 'rejected' else 'pending' end,coalesce(a.qualified_at,a.attributed_at),
 0::bigint,0::bigint,'referral',a.invitee_wallet,jsonb_build_object('referrer',a.referrer_wallet,'invitee',a.invitee_wallet,'referralStatus',a.status,'reason',a.qualification_reason)
from public.referral_attributions a join public.airdrop_seasons s on a.attributed_at>=s.starts_at and (s.ends_at is null or a.attributed_at<s.ends_at)
cross join lateral (values(a.referrer_wallet,'referral_inviter'),(a.invitee_wallet,'referral_invitee')) v(wallet,activity)
where not exists(select 1 from ledger l where l.season_id=s.id and l.wallet=v.wallet and l.source_key=a.invitee_wallet
 and l.event_type=case v.activity when 'referral_inviter' then 'referral_qualify_referrer' else 'referral_qualify_invitee' end);
revoke all on public.admin_earn_activity_events from public,anon,authenticated;
grant select on public.admin_earn_activity_events to service_role;

create function public.admin_earn_activity_report(
 p_season uuid,p_query text default '',p_activity text default 'all',p_state text default 'all',
 p_sort text default 'events',p_direction text default 'desc',p_page integer default 1,p_limit integer default 25,
 p_wallet text default null,p_from timestamptz default null,p_to timestamptz default null,p_mode text default 'users'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; lim integer:=least(100,greatest(1,p_limit)); off integer:=(greatest(1,p_page)-1)*least(100,greatest(1,p_limit));
begin
 if p_mode='reviews' then
  with rows as materialized (
   select c.*,p.username,x.code,x.expires_at,x.status as challenge_status,
    case when c.status not in ('verified','rejected') and x.expires_at<=now() then 'expired'
     else coalesce(c.review_state,case when c.status='verified' then 'approved' else c.status end) end as review_state_effective
   from public.airdrop_social_claims c left join public.profiles p on p.wallet=c.wallet
   left join public.earn_x_challenges x on x.id=c.ownership_challenge_id
   where c.season_id=p_season and (p_wallet is null or c.wallet=p_wallet)
    and (p_activity='all' or c.task_type=p_activity)
    and (p_query='' or position(lower(p_query) in lower(c.wallet||' '||coalesce(p.username,'')||' '||coalesce(c.x_handle,'')))>0)
  ), filtered as materialized (select * from rows where p_state='all' or review_state_effective=p_state),
  page as (select * from filtered order by case when p_direction='asc' then created_at end asc,case when p_direction<>'asc' then created_at end desc,id limit lim offset off)
  select jsonb_build_object('total',(select count(*) from filtered),'page',greatest(1,p_page),'pageSize',lim,'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (
   select c.id,c.wallet,c.username,c.task_type,c.x_handle,c.x_profile_url,c.evidence_url,c.campaign_url,c.status,c.review_state_effective as "reviewState",c.created_at,c.reviewed_at,c.review_note,c.verification_method,
    case when c.ownership_challenge_id is null then null else jsonb_build_object('code',c.code,'expires_at',c.expires_at,'status',c.challenge_status) end as challenge,
    coalesce((select jsonb_agg(jsonb_build_object('points',l.points,'status',l.status,'created_at',l.created_at)) from public.airdrop_points_ledger l where l.season_id=p_season and l.wallet=c.wallet and l.source_key=c.id::text),'[]') as rewards,
    coalesce((select jsonb_agg(jsonb_build_object('status',h.status,'created_at',h.created_at,'review_reason',h.review_reason) order by h.created_at desc) from public.earn_x_challenges h where h.season_id=p_season and h.claim_id=c.id),'[]') as history,
    coalesce((select jsonb_agg(jsonb_build_object('created_at',a.created_at,'review_details',a.review_details) order by a.created_at desc) from public.earn_verification_audit a where a.related_ref=c.id::text and a.event='x_review'),'[]') as reviews
   from page c
  ) r),'[]')) into result;
  return result;
 end if;
 if p_mode='events' then
  with filtered as materialized (
   select * from public.admin_earn_activity_events e where e.season_id=p_season and e.wallet=p_wallet
    and (p_activity='all' or e.activity=p_activity) and (p_state='all' or e.status=p_state)
    and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to)
  ), page as (select * from filtered order by occurred_at desc,id limit lim offset off)
  select jsonb_build_object('total',(select count(*) from filtered),'page',greatest(1,p_page),'pageSize',lim,
   'activities',coalesce((select jsonb_object_agg(c.activity,jsonb_build_object('events',c.events)) from (select activity,count(*) as events from filtered group by activity) c),'{}'),
   'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]')) into result;
  return result;
 end if;
 with e as materialized (
  select * from public.admin_earn_activity_events e where e.season_id=p_season
   and (p_activity='all' or e.activity=p_activity) and (p_state='all' or e.status=p_state)
   and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to)
 ), wallets as (
  select wallet from e union select wallet from public.profiles where p_activity='all' and p_state='all' and p_from is null and p_to is null
 ), counts as (
  select wallet,activity,count(*) as events,count(*) filter(where status='verified') as verified,
   count(*) filter(where status in ('pending','needs_review','in_progress')) as pending,
   count(*) filter(where status in ('rejected','expired','unavailable')) as rejected,sum(verified_points) as points,max(occurred_at) as last_activity
  from e group by wallet,activity
 ), stats as (
  select wallet,sum(events) as events,sum(verified) as verified,sum(pending) as pending,sum(rejected) as rejected,
   sum(points) as points,max(last_activity) as last_activity,
   jsonb_object_agg(activity,jsonb_build_object('events',events,'verified',verified,'pending',pending,'points',points)) as activities
  from counts group by wallet
 ), users as materialized (
  select w.wallet,p.username,x.x_handle as "xHandle",coalesce(s.events,0) as events,coalesce(s.verified,0) as verified,
   coalesce(s.pending,0) as pending,coalesce(s.rejected,0) as rejected,coalesce(s.points,0) as points,s.last_activity as "lastActivity",coalesce(s.activities,'{}') as activities,
   exists(select 1 from public.reward_exclusions r where r.wallet=w.wallet and r.active) as excluded
  from wallets w left join public.profiles p on p.wallet=w.wallet left join stats s on s.wallet=w.wallet
  left join lateral (select c.x_handle from public.airdrop_social_claims c where c.wallet=w.wallet and c.season_id=p_season order by (c.status='verified') desc,c.created_at desc limit 1) x on true
  where (p_wallet is null or w.wallet=p_wallet) and (p_query='' or position(lower(p_query) in lower(w.wallet||' '||coalesce(p.username,'')||' '||coalesce(x.x_handle,'')))>0)
 ), page as (
  select * from users order by
   case when p_sort='events' and p_direction='desc' then events end desc,
   case when p_sort='events' and p_direction='asc' then events end asc,
   case when p_sort='verified' and p_direction='desc' then verified end desc,
   case when p_sort='verified' and p_direction='asc' then verified end asc,
   case when p_sort='pending' and p_direction='desc' then pending end desc,
   case when p_sort='pending' and p_direction='asc' then pending end asc,
   case when p_sort='points' and p_direction='desc' then points end desc,
   case when p_sort='points' and p_direction='asc' then points end asc,
   case when p_sort='last_activity' and p_direction='desc' then "lastActivity" end desc nulls last,
   case when p_sort='last_activity' and p_direction='asc' then "lastActivity" end asc nulls last,
   wallet limit lim offset off
 ) select jsonb_build_object('total',(select count(*) from users),'page',greatest(1,p_page),'pageSize',lim,
  'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),
  'summary',(select jsonb_build_object('users',count(*),'events',coalesce(sum(events),0),'verified',coalesce(sum(verified),0),'pending',coalesce(sum(pending),0),'points',coalesce(sum(points),0)) from users)) into result;
 return result;
end $$;
revoke all on function public.admin_earn_activity_report(uuid,text,text,text,text,text,integer,integer,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.admin_earn_activity_report(uuid,text,text,text,text,text,integer,integer,text,timestamptz,timestamptz,text) to service_role;

-- Staff review remains available for existing requests while new submissions are paused.
-- No feature/season activation is changed. The route authenticates OWNER/FULL_ADMIN.
create function public.admin_review_earn_claim(p_claim uuid,p_decision text,p_reviewer text,p_reason text,p_ownership boolean,p_evidence boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.airdrop_social_claims%rowtype; x public.earn_x_challenges%rowtype; a uuid; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('headstails:earn-verification:v1',0));
 if p_decision not in ('verified','rejected','needs_review') or length(btrim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'invalid-review'; end if;
 select * into c from public.airdrop_social_claims where id=p_claim for update;
 if not found then raise exception 'unknown-claim'; end if;
 if p_decision='verified' then
  if not public.earn_eligible(c.wallet,c.season_id) then raise exception 'ineligible'; end if;
  if c.task_type='connect_x' and not coalesce(p_ownership,false) then raise exception 'ownership-challenge-required'; end if;
  if c.task_type<>'connect_x' and not coalesce(p_evidence,false) then raise exception 'evidence-review-required'; end if;
 end if;
 if c.ownership_challenge_id is not null then
  select * into x from public.earn_x_challenges where id=c.ownership_challenge_id for update;
  if p_decision='verified' and (not found or x.status not in ('submitted','verified') or x.expires_at<=now()) then raise exception 'ownership-challenge-required'; end if;
 end if;
 if c.status='verified' and p_decision='verified' then return '{"status":"unchanged"}'::jsonb; end if;
 -- needs_review preserves an existing approved credit, like the original dispatcher.
 if c.status<>'verified' or p_decision<>'needs_review' then
  r:=public.review_airdrop_social_claim_atomic(c.id,case when p_decision='needs_review' then 'rejected' else p_decision end,p_reviewer,btrim(p_reason));
 end if;
 update public.airdrop_social_claims set review_state=case when p_decision='verified' then 'approved' else p_decision end,
  review_note=btrim(p_reason),reviewer_wallet=p_reviewer,reviewed_at=now() where id=c.id;
 if c.ownership_challenge_id is not null then
  update public.earn_x_challenges set status=p_decision,review_reason=btrim(p_reason),reviewed_at=now() where id=c.ownership_challenge_id;
 end if;
 if c.task_type='connect_x' and p_decision='verified' then
  insert into public.earn_social_disconnects(wallet,provider,disconnected) values(c.wallet,'x',false)
  on conflict(wallet,provider) do update set disconnected=false,updated_at=now();
 end if;
 insert into public.earn_account_refs(wallet) values(c.wallet) on conflict do nothing;
 select account_ref into a from public.earn_account_refs where wallet=c.wallet;
 insert into public.earn_verification_audit(account_ref,event,related_ref,review_details)
 values(a,'x_review',c.id::text,jsonb_build_object('reviewer',p_reviewer,'decision',p_decision,'reason',btrim(p_reason),
  'ownership_confirmed',coalesce(p_ownership,false),'evidence_confirmed',coalesce(p_evidence,false),'mode',case when c.ownership_challenge_id is null then 'legacy' else 'bio_challenge' end));
 insert into public.admin_audit_log(admin_wallet,action,target,metadata)
 values(p_reviewer,'earn.review-claim',c.id::text,jsonb_build_object('decision',p_decision,'reason',btrim(p_reason)));
 return jsonb_build_object('status',p_decision);
end $$;
revoke all on function public.admin_review_earn_claim(uuid,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_review_earn_claim(uuid,text,text,text,boolean,boolean) to service_role;
