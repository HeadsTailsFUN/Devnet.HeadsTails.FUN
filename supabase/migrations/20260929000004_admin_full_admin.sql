-- Devnet web-admin role schema. This migration grants no wallet membership.

alter table public.admin_members drop constraint if exists admin_members_role_check;
alter table public.admin_members
  add constraint admin_members_role_check check (role in ('MODERATOR', 'FULL_ADMIN'));
