-- GAMEPLAY V3: durable auto-settlement + room isolation read model.
-- Safe additive migration only. No destructive reset. Preserves users,
-- profiles, chat, admin, matches, history, moderation, sponsor ledger.

-- 1. Backfill historical rows as $1 (previous public gameplay only had $1).
update public.matches set tier_usd = 1 where tier_usd is null;

-- 2. Verifiability columns for Recent Flips (all nullable, backfilled by indexer).
alter table public.matches
  add column if not exists match_pda text,
  add column if not exists randomness_account text,
  add column if not exists match_signature text,
  add column if not exists settlement_signature text,
  add column if not exists orao_fulfillment_signature text;

-- Keep settlement_signature in sync with the canonical transaction_signature
-- for rows indexed before V3 (read path prefers settlement_signature).
update public.matches
  set settlement_signature = transaction_signature
  where settlement_signature is null and transaction_signature is not null;

create index if not exists matches_tier_usd_idx on public.matches (tier_usd);
create index if not exists matches_match_pda_idx on public.matches (match_pda);

-- 3. Durable settlement jobs: trigger bookkeeping for auto-settlement.
-- Chain stays authoritative; this table only ensures the workflow exists
-- across deploy restarts / lost triggers. Service-role only (no public RLS).
create table if not exists public.settlement_jobs (
  match_id text primary key,
  tier_usd integer,
  status text not null default 'queued'
    check (status in ('queued', 'pending', 'in-progress', 'settled', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settlement_jobs enable row level security;
-- No policies: only the service role (bypasses RLS) may access this table.

create index if not exists settlement_jobs_status_idx
  on public.settlement_jobs (status, next_attempt_at);
