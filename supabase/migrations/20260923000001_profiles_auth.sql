-- V2 social: wallet-ownership sessions + public profiles (off-chain only).
-- No game data touched. Service-role writes only (RLS, no public policies).

create table public.auth_nonces (
  nonce text primary key,
  wallet text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.auth_sessions (
  token_hash text primary key,
  wallet text not null,
  expires_at timestamptz not null,
  ip text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  wallet text primary key,
  username text,
  username_normalized text unique,
  avatar_path text,
  manual_rank_override text check (manual_rank_override in ('AUTO', 'ROOKIE', 'PLAYER', 'VETERAN', 'LEGEND')),
  username_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auth_nonces enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.profiles enable row level security;

-- No public policies: browser reads go through authenticated/public API
-- routes with the service-role key; browsers never touch these tables.

create index auth_nonces_wallet_idx on public.auth_nonces (wallet);
create index auth_nonces_expires_idx on public.auth_nonces (expires_at);
create index auth_sessions_wallet_idx on public.auth_sessions (wallet);
create index auth_sessions_expires_idx on public.auth_sessions (expires_at);
create index profiles_username_normalized_idx on public.profiles (username_normalized);
