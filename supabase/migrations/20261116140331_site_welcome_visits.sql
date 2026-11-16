-- New, isolated presentation preference; no changes to wallets, rewards or game tables.
create table public.site_welcome_visits (
  ip_digest text primary key check (ip_digest ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default statement_timestamp()
);
alter table public.site_welcome_visits enable row level security;
revoke all on public.site_welcome_visits from public, anon, authenticated;
grant select, insert on public.site_welcome_visits to service_role;

create function public.claim_site_welcome_visit(p_ip_digest text)
returns boolean language sql volatile security invoker set search_path = '' as $$
  with first_visit as (
    insert into public.site_welcome_visits(ip_digest) values (p_ip_digest)
    on conflict (ip_digest) do nothing returning 1
  ) select exists(select 1 from first_visit);
$$;
revoke all on function public.claim_site_welcome_visit(text) from public, anon, authenticated;
grant execute on function public.claim_site_welcome_visit(text) to service_role;
comment on table public.site_welcome_visits is 'Landing first-visit preference only. HMAC-SHA256 digest of trusted ingress IP; no raw IP, wallet identity or user agent.';
notify pgrst, 'reload schema';
