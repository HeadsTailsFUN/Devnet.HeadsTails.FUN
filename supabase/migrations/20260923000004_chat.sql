-- V2 social: global chat + user moderation + site settings.
-- Single global room for V1. Service-role writes via API routes only.

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  body text not null check (char_length(body) >= 1 and char_length(body) <= 280),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create table public.user_moderation (
  wallet text primary key,
  muted boolean not null default false,
  web_restricted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;
alter table public.user_moderation enable row level security;
alter table public.site_settings enable row level security;

-- No public policies: reads go through public API routes; writes are
-- authenticated server-side with the service-role key.

create index chat_messages_created_idx on public.chat_messages (created_at desc);
create index chat_messages_wallet_idx on public.chat_messages (wallet);

-- Realtime INSERT/UPDATE stream for the client (with polling fallback).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Safe defaults (controlled settings only; see admin UI scope).
insert into public.site_settings (key, value)
values
  ('chat_enabled', '{"enabled": true}'::jsonb),
  ('leaderboard_enabled', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;
