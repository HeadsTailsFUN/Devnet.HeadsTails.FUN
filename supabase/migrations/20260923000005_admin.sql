-- V2 admin: members, audit log. site_settings table already exists.
-- Service-role writes via API routes only. No public policies.

create table public.admin_members (
  wallet text primary key,
  role text not null check (role = 'MODERATOR'),
  added_by text,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_wallet text not null,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;
alter table public.admin_audit_log enable row level security;

-- No public policies: all access through authenticated server routes.

create index admin_audit_log_admin_idx on public.admin_audit_log (admin_wallet);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
