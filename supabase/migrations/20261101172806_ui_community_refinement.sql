-- Additive Devnet community preferences, accepted-message burst gate and read-only reactions.
begin;
alter table public.profiles add column team_preference text check(team_preference in ('HEADS','TAILS'));
alter table public.profiles add column team_prompt_completed boolean not null default false;
alter table public.chat_messages add column client_id uuid;
create unique index chat_messages_wallet_client_unique on public.chat_messages(wallet,client_id) where client_id is not null;
create index chat_messages_recent_order on public.chat_messages(created_at desc,id desc) where deleted_at is null;
-- All accepted sends must traverse the atomic gate, including old server versions.
-- Keep existing SELECT/UPDATE moderation privileges; remove INSERT only.
revoke insert on public.chat_messages from public,anon,authenticated,service_role;
do $$
declare columns text;
begin
 select string_agg(quote_ident(attname),',') into columns from pg_attribute
 where attrelid='public.chat_messages'::regclass and attnum>0 and not attisdropped;
 execute 'revoke insert ('||columns||') on public.chat_messages from public,anon,authenticated,service_role';
end $$;
create table public.chat_burst_state(wallet text primary key, last_accepted_at timestamptz, burst_count integer not null default 0 check(burst_count between 0 and 3), blocked_until timestamptz);
alter table public.chat_burst_state enable row level security;
revoke all on public.chat_burst_state from public,anon,authenticated,service_role;
create function public.send_chat_message_atomic(p_wallet text,p_body text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chat_burst_state%rowtype; r public.chat_messages%rowtype; t timestamptz:=clock_timestamp(); n integer; retry integer;
begin
 if p_wallet is null or p_client_id is null or p_body is null or char_length(p_body) not between 1 and 280 then raise exception 'invalid-message'; end if;
 perform pg_advisory_xact_lock(hashtextextended('headstails-chat:'||p_wallet,0));
 t:=clock_timestamp();
 -- Replay of a successful request never consumes another burst slot or inserts twice.
 select * into r from public.chat_messages where wallet=p_wallet and client_id=p_client_id;
 if found then return jsonb_build_object('status','sent','message',jsonb_build_object('id',r.id,'wallet',r.wallet,'body',r.body,'created_at',r.created_at),'reused',true); end if;
 if exists(select 1 from public.user_moderation where wallet=p_wallet and (muted or web_restricted)) then return jsonb_build_object('status','restricted'); end if;
 if exists(select 1 from public.site_settings where key='chat_enabled' and value->>'enabled'='false') then return jsonb_build_object('status','disabled'); end if;
 insert into public.chat_burst_state(wallet) values(p_wallet) on conflict do nothing;
 select * into strict s from public.chat_burst_state where wallet=p_wallet for update;
 if s.blocked_until>t then return jsonb_build_object('status','cooldown','retryAfterMs',ceil(extract(epoch from(s.blocked_until-t))*1000)); end if;
 if s.last_accepted_at>t-interval '1 second' then return jsonb_build_object('status','cooldown','retryAfterMs',ceil(extract(epoch from(s.last_accepted_at+interval '1 second'-t))*1000)); end if;
 select count(*) into n from public.chat_messages where wallet=p_wallet and created_at>t-interval '1 minute';
 if n>=20 then return jsonb_build_object('status','cooldown','retryAfterMs',60000); end if;
 -- A ten-second idle gap or completed cooldown starts a fresh burst.
 n:=case when s.last_accepted_at is null or s.last_accepted_at<t-interval '10 seconds' or s.burst_count=3 then 1 else s.burst_count+1 end;
 insert into public.chat_messages(wallet,body,client_id,created_at) values(p_wallet,p_body,p_client_id,t) returning * into r;
 update public.chat_burst_state set last_accepted_at=t,burst_count=n,blocked_until=case when n=3 then t+interval '3 seconds' else null end where wallet=p_wallet;
 return jsonb_build_object('status','sent','message',jsonb_build_object('id',r.id,'wallet',r.wallet,'body',r.body,'created_at',r.created_at),'cooldownMs',case when n=3 then 3000 else 0 end);
end $$;
revoke all on function public.send_chat_message_atomic(text,text,uuid) from public,anon,authenticated;
grant execute on function public.send_chat_message_atomic(text,text,uuid) to service_role;
create function public.hts_result_reaction(p_wallet text,p_match text,p_mint text,p_program text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.matches%rowtype; side text; won boolean; n bigint;
begin
 select * into r from public.matches where cluster='devnet' and program_id=p_program and token_mint=p_mint and onchain_match_id=p_match and settled_at is not null and (heads_wallet=p_wallet or tails_wallet=p_wallet);
 if not found then return jsonb_build_object('pending',true); end if;
 side:=case when r.heads_wallet=p_wallet then 'HEADS' else 'TAILS' end; won:=r.winner_wallet=p_wallet;
 select count(*) into n from public.matches m where m.cluster='devnet' and m.program_id=p_program and m.token_mint=p_mint and m.settled_at is not null
 and (case when side='HEADS' then m.heads_wallet else m.tails_wallet end)=p_wallet
 and (m.winner_wallet=p_wallet)=won
 and (m.settled_at,coalesce(m.settled_slot,0),m.onchain_match_id::numeric)<=(r.settled_at,coalesce(r.settled_slot,0),r.onchain_match_id::numeric);
 return jsonb_build_object('side',side,'win',won,'ordinal',n);
end $$;
revoke all on function public.hts_result_reaction(text,text,text,text) from public,anon,authenticated;
grant execute on function public.hts_result_reaction(text,text,text,text) to service_role;
-- Abort atomically if inherited/provider grants leave a direct-send bypass.
do $ui_guard$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'public.chat_messages','INSERT')
     or has_any_column_privilege(role_name,'public.chat_messages','INSERT') then
   raise exception 'Direct chat INSERT remains available to %',role_name;
  end if;
  if has_table_privilege(role_name,'public.chat_burst_state','SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'Private burst state remains accessible to %',role_name;
  end if;
 end loop;
 if has_function_privilege('anon','public.send_chat_message_atomic(text,text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.send_chat_message_atomic(text,text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.hts_result_reaction(text,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.hts_result_reaction(text,text,text,text)','EXECUTE') then
  raise exception 'Unexpected public community RPC execution';
 end if;
end $ui_guard$;
commit;
