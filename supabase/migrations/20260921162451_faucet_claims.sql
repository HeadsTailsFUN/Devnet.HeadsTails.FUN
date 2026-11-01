-- Devnet test-token faucet cooldown ledger (server-side enforcement).
-- One row per claimant wallet. Written only with the service-role key from
-- the faucet API route. No browser access: RLS is enabled with NO public
-- policies, so anon/authenticated API callers cannot read or write rows.

create table public.faucet_claims (
  wallet text primary key,
  last_claimed_at timestamptz not null default now(),
  ip text,
  created_at timestamptz not null default now()
);

alter table public.faucet_claims enable row level security;

-- No policies: only the service role (bypasses RLS) may access this table.
-- Browser clients must never read or write faucet cooldown state directly.

create index faucet_claims_last_claimed_at_idx
  on public.faucet_claims (last_claimed_at desc);
