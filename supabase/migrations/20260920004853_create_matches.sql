-- Phase 2 indexer read model: resolved flip matches (public chain data mirror).
-- Authoritative gameplay state (queue order, escrow, randomness, payouts)
-- stays on Solana. This table is an idempotent event-sourced read model.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  cluster text not null default 'devnet',
  program_id text not null default '',
  onchain_match_id text not null,
  transaction_signature text not null,
  event_index integer not null default 0,
  heads_wallet text not null,
  tails_wallet text not null,
  -- Token base units. NUMERIC only: never float semantics on-chain values.
  heads_amount numeric not null,
  tails_amount numeric not null,
  token_mint text not null,
  tier_usd integer not null default 1,
  result text not null check (result in ('HEADS', 'TAILS')),
  winner_wallet text not null,
  created_slot bigint,
  settled_slot bigint,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  -- Idempotent indexing: same chain event can never insert twice.
  constraint matches_event_identity
    unique (cluster, transaction_signature, event_index),
  -- One row per on-chain match per program deployment.
  constraint matches_onchain_identity
    unique (cluster, program_id, onchain_match_id)
);

create index matches_settled_at_idx on public.matches (settled_at desc);
create index matches_onchain_match_id_idx on public.matches (onchain_match_id);
create index matches_winner_wallet_idx on public.matches (winner_wallet);
create index matches_cluster_idx on public.matches (cluster);

-- Browser clients get read-only access to resolved public history.
-- Indexer/service writes use the server-side service-role key (bypasses RLS).
alter table public.matches enable row level security;

create policy "matches_public_read"
  on public.matches
  for select
  to anon, authenticated
  using (true);
