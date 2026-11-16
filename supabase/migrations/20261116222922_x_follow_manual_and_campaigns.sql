-- Explicit owner-requested policy: Follow on X is manually reviewed without a bio challenge.
-- Existing claim IDs, reward amounts, eligibility, audit history and uniqueness are retained.
insert into public.site_settings(key,value) values
 ('earn_x_reply_campaign_url','{"text":"https://x.com/HeadsTailsFun/status/2120586014045385081"}'),
 ('earn_x_repost_campaign_url','{"text":"https://x.com/HeadsTailsFun/status/2120586014045385081"}')
on conflict(key) do nothing;

create function public.earn_submit_x_follow(p_wallet text,p_handle text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s uuid; c public.airdrop_social_claims%rowtype; r jsonb; h text:=lower(btrim(p_handle));
begin
 perform pg_advisory_xact_lock(hashtextextended('headstails:earn-verification:v1',0));
 if p_wallet is null or h is null or h !~ '^[a-z0-9_]{1,15}$' then raise exception 'invalid-handle'; end if;
 select id into s from public.airdrop_seasons where active limit 1;
 if not exists(select 1 from public.earn_season_settings where season_id=s and x_manual_enabled) then return '{"status":"disabled"}'::jsonb; end if;
 select * into c from public.airdrop_social_claims where season_id=s and wallet=p_wallet and task_type='connect_x' for update;
 if found then
  if c.status='verified' and lower(c.x_handle)=h then return '{"status":"completed"}'::jsonb; end if;
  r:=public.update_airdrop_social_claim_atomic(s,p_wallet,'connect_x',h,null);
 else
  r:=public.create_airdrop_social_claim_atomic(s,p_wallet,'connect_x',h,'https://x.com/'||h,null,null,100);
 end if;
 update public.airdrop_social_claims set status='pending',review_state='pending',verification_method='manual_follow_review',
  ownership_challenge_id=null,reviewer_wallet=null,review_note=null,reviewed_at=null
  where season_id=s and wallet=p_wallet and task_type='connect_x' returning * into c;
 update public.airdrop_points_ledger set status='pending',verified_at=null
  where season_id=s and wallet=p_wallet and event_type='social_connect_x' and source_key=c.id::text;
 return jsonb_build_object('status','pending','claim_id',c.id);
end $$;
revoke all on function public.earn_submit_x_follow(text,text) from public,anon,authenticated;
grant execute on function public.earn_submit_x_follow(text,text) to service_role;

create function public.earn_submit_x_campaign(p_wallet text,p_task text,p_handle text,p_evidence text,p_campaign text,p_edit boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s uuid; c public.airdrop_social_claims%rowtype; configured text; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('headstails:earn-verification:v1',0));
 if p_task not in ('reply','repost') then raise exception 'invalid-task'; end if;
 select id into s from public.airdrop_seasons where active limit 1;
 if not exists(select 1 from public.earn_season_settings where season_id=s and x_manual_enabled) then return '{"status":"disabled"}'::jsonb; end if;
 select value->>'text' into configured from public.site_settings where key='earn_x_'||p_task||'_campaign_url' for share;
 if configured is null or configured='' or lower(configured)<>lower(p_campaign) then raise exception 'campaign-changed'; end if;
 if not exists(select 1 from public.airdrop_x_identities where season_id=s and wallet=p_wallet and status='verified' and lower(x_handle)=lower(p_handle))
  or exists(select 1 from public.earn_social_disconnects where wallet=p_wallet and provider='x' and disconnected) then raise exception 'verified-ownership-required'; end if;
 select * into c from public.airdrop_social_claims where season_id=s and wallet=p_wallet and task_type=p_task for update;
 if found and (c.status='verified' or (c.status='pending' and not p_edit)) then
  return jsonb_build_object('status','already-claimed','claim_id',c.id);
 end if;
 if c.id is not null then
  r:=public.update_airdrop_social_claim_atomic(s,p_wallet,p_task,p_handle,p_evidence);
 else
  r:=public.create_airdrop_social_claim_atomic(s,p_wallet,p_task,p_handle,'https://x.com/'||p_handle,p_evidence,null,case when p_task='reply' then 50 else 75 end);
 end if;
 update public.airdrop_social_claims set status='pending',review_state='pending',campaign_url=p_campaign,
  verification_method='manual_campaign_evidence',reviewer_wallet=null,review_note=null,reviewed_at=null
  where season_id=s and wallet=p_wallet and task_type=p_task returning * into c;
 update public.airdrop_points_ledger set status='pending',verified_at=null where season_id=s and wallet=p_wallet and event_type='social_'||p_task and source_key=c.id::text;
 return jsonb_build_object('status',case when p_edit then 'edited' else 'created' end,'claim_id',c.id);
end $$;
revoke all on function public.earn_submit_x_campaign(text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.earn_submit_x_campaign(text,text,text,text,text,boolean) to service_role;

create or replace function public.admin_review_earn_claim(p_claim uuid,p_decision text,p_reviewer text,p_reason text,p_ownership boolean,p_evidence boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.airdrop_social_claims%rowtype; x public.earn_x_challenges%rowtype; a uuid; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('headstails:earn-verification:v1',0));
 if p_decision not in ('verified','rejected','needs_review') or length(btrim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'invalid-review'; end if;
 select * into c from public.airdrop_social_claims where id=p_claim for update;
 if not found then raise exception 'unknown-claim'; end if;
 if p_decision='verified' then
  if not public.earn_eligible(c.wallet,c.season_id) then raise exception 'ineligible'; end if;
  if c.task_type='connect_x' and c.verification_method='manual_follow_review' then
   if not coalesce(p_evidence,false) then raise exception 'evidence-review-required'; end if;
  elsif c.task_type='connect_x' and not coalesce(p_ownership,false) then raise exception 'ownership-challenge-required'; end if;
  if c.task_type<>'connect_x' and not coalesce(p_evidence,false) then raise exception 'evidence-review-required'; end if;
 end if;
 if c.ownership_challenge_id is not null then
  select * into x from public.earn_x_challenges where id=c.ownership_challenge_id for update;
  if p_decision='verified' and (not found or x.status not in ('submitted','verified') or x.expires_at<=now()) then raise exception 'ownership-challenge-required'; end if;
 end if;
 if c.status='verified' and p_decision='verified' then return '{"status":"unchanged"}'::jsonb; end if;
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
  'ownership_confirmed',coalesce(p_ownership,false),'evidence_confirmed',coalesce(p_evidence,false),
  'mode',case when c.verification_method='manual_follow_review' then 'manual_follow_review' when c.ownership_challenge_id is null then 'legacy' else 'bio_challenge' end));
 insert into public.admin_audit_log(admin_wallet,action,target,metadata)
 values(p_reviewer,'earn.review-claim',c.id::text,jsonb_build_object('decision',p_decision,'reason',btrim(p_reason)));
 return jsonb_build_object('status',p_decision);
end $$;
revoke all on function public.admin_review_earn_claim(uuid,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_review_earn_claim(uuid,text,text,text,boolean,boolean) to service_role;
