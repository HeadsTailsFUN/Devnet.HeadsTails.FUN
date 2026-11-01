-- V2 social: public asset buckets (avatars, site-assets).
-- Public READ for rendering. All writes via service-role API routes.
-- No anon/authenticated insert/update/delete policies.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('site-assets', 'site-assets', true)
on conflict (id) do update set public = excluded.public;

-- Public read-only access to both buckets.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id in ('avatars', 'site-assets'));
