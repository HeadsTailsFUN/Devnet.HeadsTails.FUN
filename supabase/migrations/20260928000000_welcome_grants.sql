-- One-time Devnet welcome-token grant ledger with a recoverable lifecycle.
-- Identity is (wallet, mint): one grant per wallet PER Devnet test mint,
-- not permanently one grant per wallet across every future mint.
-- Apply with: supabase db push  (or run in the Supabase SQL editor).
-- No database reset required (create-table-if-not-exists + additive columns).
--
-- Lifecycle: pending -> submitted(signature) -> completed | failed.
-- - Only the atomic-insert winner transfers: two simultaneous requests
--   produce at most one successful transfer (PK race).
-- - If sendRawTransaction returns a signature but confirmation is unknown,
--   the signature is PERSISTED (submitted) and re-checked via
--   getSignatureStatuses; a replacement is sent ONLY when the previous
--   transaction is authoritatively failed/expired and can no longer land.
-- - A wallet is NEVER marked completed without receiving tokens; stale
--   pending/submitted rows are taken over and retried, never stranded.
-- RLS enabled with NO public policies: service role only (same as faucet_claims).

create table if not exists public.welcome_grants (
  wallet text not null,
  mint text not null,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'completed', 'failed')),
  signature text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (wallet, mint)
);

alter table public.welcome_grants enable row level security;

-- No policies: only the service role (bypasses RLS) may access this table.

create index if not exists welcome_grants_status_idx on public.welcome_grants (status);
