-- Reset the Devnet global chat and retain only the 50 newest message rows.
begin;
set local lock_timeout = '5s';

lock table public.chat_messages in share row exclusive mode;
do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.send_chat_message_atomic(text,text,uuid)'::regprocedure
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = current_user
      and md5(replace(p.prosrc, E'\r\n', E'\n')) = 'b32ff613ff2148057ce1d2d9be94e767'
  ) then
    raise exception 'Unexpected global chat send routine';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint
    where contype = 'f' and confrelid = 'public.chat_messages'::regclass
  ) then
    raise exception 'Unexpected foreign key to chat_messages';
  end if;
end;
$guard$;

create schema headstails_chat;
revoke all on schema headstails_chat from public, anon, authenticated, service_role;

-- Retain short-lived request identity and send timing independently of chat
-- content so pruning cannot reset the existing rate limits or retry safety.
create table headstails_chat.send_receipts (
  wallet text not null,
  client_id uuid not null,
  accepted_at timestamptz not null,
  primary key (wallet, client_id)
);
alter table headstails_chat.send_receipts enable row level security;
revoke all on headstails_chat.send_receipts from public, anon, authenticated, service_role;
create index chat_receipts_accepted_idx on headstails_chat.send_receipts (accepted_at);
create index chat_receipts_wallet_accepted_idx on headstails_chat.send_receipts (wallet, accepted_at);

insert into headstails_chat.send_receipts (wallet, client_id, accepted_at)
select wallet, client_id, created_at from public.chat_messages
where client_id is not null and created_at > clock_timestamp() - interval '10 minutes';

create function headstails_chat.serialize_inserts()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('headstails-global-chat-retention', 0));
  return null;
end;
$$;

create function headstails_chat.retain_recent_messages()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from headstails_chat.send_receipts
  where accepted_at <= clock_timestamp() - interval '10 minutes';

  insert into headstails_chat.send_receipts (wallet, client_id, accepted_at)
  select wallet, client_id, created_at from inserted_messages where client_id is not null
  on conflict (wallet, client_id) do nothing;

  delete from public.chat_messages where id in (
    select id from public.chat_messages order by created_at desc, id desc offset 50
  );
  return null;
end;
$$;
revoke all on function headstails_chat.serialize_inserts(), headstails_chat.retain_recent_messages()
from public, anon, authenticated, service_role;

create trigger chat_serialize_insert before insert on public.chat_messages
for each statement execute function headstails_chat.serialize_inserts();
create trigger chat_retain_recent after insert on public.chat_messages
referencing new table as inserted_messages
for each statement execute function headstails_chat.retain_recent_messages();

create or replace function public.send_chat_message_atomic(p_wallet text,p_body text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chat_burst_state%rowtype; r public.chat_messages%rowtype; t timestamptz:=clock_timestamp(); n integer;
begin
 if p_wallet is null or p_client_id is null or p_body is null or char_length(p_body) not between 1 and 280 then raise exception 'invalid-message'; end if;
 perform pg_advisory_xact_lock(hashtextextended('headstails-chat:'||p_wallet,0));
 t:=clock_timestamp();
 -- Replay of a successful request never consumes another burst slot or inserts twice.
 select * into r from public.chat_messages where wallet=p_wallet and client_id=p_client_id;
 if found then return jsonb_build_object('status','sent','message',jsonb_build_object('id',r.id,'wallet',r.wallet,'body',r.body,'created_at',r.created_at),'reused',true); end if;
 if exists(select 1 from headstails_chat.send_receipts
  where wallet=p_wallet and client_id=p_client_id and accepted_at>t-interval '10 minutes') then
  return jsonb_build_object('status','sent','message',null,'reused',true);
 end if;
 if exists(select 1 from public.user_moderation where wallet=p_wallet and (muted or web_restricted)) then return jsonb_build_object('status','restricted'); end if;
 if exists(select 1 from public.site_settings where key='chat_enabled' and value->>'enabled'='false') then return jsonb_build_object('status','disabled'); end if;
 insert into public.chat_burst_state(wallet) values(p_wallet) on conflict do nothing;
 select * into strict s from public.chat_burst_state where wallet=p_wallet for update;
 if s.blocked_until>t then return jsonb_build_object('status','cooldown','retryAfterMs',ceil(extract(epoch from(s.blocked_until-t))*1000)); end if;
 if s.last_accepted_at>t-interval '1 second' then return jsonb_build_object('status','cooldown','retryAfterMs',ceil(extract(epoch from(s.last_accepted_at+interval '1 second'-t))*1000)); end if;
 select count(*) into n from headstails_chat.send_receipts where wallet=p_wallet and accepted_at>t-interval '1 minute';
 if n>=20 then return jsonb_build_object('status','cooldown','retryAfterMs',60000); end if;
 -- A ten-second idle gap or completed cooldown starts a fresh burst.
 n:=case when s.last_accepted_at is null or s.last_accepted_at<t-interval '10 seconds' or s.burst_count=3 then 1 else s.burst_count+1 end;
 insert into public.chat_messages(wallet,body,client_id,created_at) values(p_wallet,p_body,p_client_id,t) returning * into r;
 update public.chat_burst_state set last_accepted_at=t,burst_count=n,blocked_until=case when n=3 then t+interval '3 seconds' else null end where wallet=p_wallet;
 return jsonb_build_object('status','sent','message',jsonb_build_object('id',r.id,'wallet',r.wallet,'body',r.body,'created_at',r.created_at),'cooldownMs',case when n=3 then 3000 else 0 end);
end $$;

-- One-time reset, committed together with the retention guard.
delete from public.chat_messages;
commit;
