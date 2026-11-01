-- Devnet-only SOL sponsor ledger (QA gas sponsorship overlay).
-- Separate from the project-token faucet (faucet_claims) and from game funds.
-- Written only with the service-role key from the sponsor API routes.
-- No browser access: RLS enabled with NO public policies.
-- Mainnet must never use this table; routes fail closed on mainnet signals.

create table public.sponsor_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  kind text not null check (kind in ('PRE_FUND', 'REIMBURSEMENT')),
  game_action text not null check (game_action in ('join', 'cancel', 'match', 'claim', 'settle')),
  game_signature text,
  sponsor_signature text,
  amount_lamports bigint not null check (amount_lamports >= 0),
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'failed')),
  idempotency_key text not null unique,
  ip text,
  created_at timestamptz not null default now()
);

alter table public.sponsor_ledger enable row level security;

-- No policies: only the service role (bypasses RLS) may access this table.

create index sponsor_ledger_wallet_idx on public.sponsor_ledger (wallet);
create index sponsor_ledger_game_sig_idx on public.sponsor_ledger (game_signature);
create index sponsor_ledger_created_at_idx on public.sponsor_ledger (created_at desc);
