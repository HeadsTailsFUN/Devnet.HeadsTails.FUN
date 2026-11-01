-- Social claim edits: handle / reply-URL updates without duplicate rewards.
-- Additive only. One wallet keeps one X identity per season; verified X
-- stays unique per season. Editing a VERIFIED handle/claim returns it to
-- Pending review; ledger history is preserved (same event row -> pending),
-- never a second reward row.
--
-- update_airdrop_social_claim_atomic(p_season_id, p_wallet, p_task_type,
--   p_handle, p_evidence_url)
-- Returns {"status":"edited"|"unchanged","claim_id":...}.
-- Errors (raise): invalid-task, invalid-handle, no-identity, no-claim,
--   wallet-bound, x-taken.

create or replace function public.update_airdrop_social_claim_atomic(
  p_season_id uuid,
  p_wallet text,
  p_task_type text,
  p_handle text,
  p_evidence_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_handle_norm text;
  v_ident public.airdrop_x_identities%rowtype;
  v_claim public.airdrop_social_claims%rowtype;
  v_event text;
begin
  if p_task_type not in ('connect_x', 'repost', 'reply') then
    raise exception 'invalid-task' using errcode = '22023';
  end if;
  if p_handle is null or btrim(p_handle) = '' then
    raise exception 'invalid-handle' using errcode = '22023';
  end if;
  v_handle_norm := lower(btrim(btrim(p_handle), '@'));
  if v_handle_norm !~ '^[a-z0-9_]{1,32}$' then
    raise exception 'invalid-handle' using errcode = '22023';
  end if;
  v_event := 'social_' || p_task_type;

  select * into v_ident from public.airdrop_x_identities
   where season_id = p_season_id and wallet = p_wallet for update;
  if not found then
    raise exception 'no-identity' using errcode = 'P0002';
  end if;

  select * into v_claim from public.airdrop_social_claims
   where season_id = p_season_id and wallet = p_wallet and task_type = p_task_type for update;
  if not found then
    raise exception 'no-claim' using errcode = 'P0002';
  end if;

  if p_task_type = 'connect_x' then
    -- Same handle: nothing to do (never a second reward).
    if lower(v_ident.x_handle) = v_handle_norm then
      return jsonb_build_object('status', 'unchanged', 'claim_id', v_claim.id);
    end if;
    -- Verified X cannot belong to another wallet in this season.
    if exists (
      select 1 from public.airdrop_x_identities
       where season_id = p_season_id and status = 'verified' and wallet <> p_wallet
         and (lower(x_handle) = v_handle_norm
              or (v_ident.x_user_id is not null and x_user_id = v_ident.x_user_id))
    ) then
      raise exception 'x-taken' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.airdrop_social_claims
       where season_id = p_season_id and status = 'verified' and wallet <> p_wallet
         and lower(x_handle) = v_handle_norm
    ) then
      raise exception 'x-taken' using errcode = 'P0001';
    end if;
    -- New handle -> identity back to Pending review (history preserved).
    update public.airdrop_x_identities
       set x_handle = p_handle,
           x_profile_url = 'https://x.com/' || v_handle_norm,
           status = 'pending', verified_at = null, updated_at = now()
     where id = v_ident.id;
    update public.airdrop_social_claims
       set x_handle = p_handle,
           x_profile_url = 'https://x.com/' || v_handle_norm,
           status = 'pending', reviewer_wallet = null, review_note = null, reviewed_at = null
     where id = v_claim.id;
    update public.airdrop_points_ledger
       set status = 'pending', verified_at = null
     where season_id = p_season_id and wallet = p_wallet
       and event_type = v_event and source_key = v_claim.id::text;
  else
    -- Reply/repost: identity handle must stay wallet-bound; only evidence
    -- changes. Same URL: nothing to do.
    if lower(v_ident.x_handle) <> v_handle_norm and lower(v_claim.x_handle) <> v_handle_norm then
      raise exception 'wallet-bound' using errcode = 'P0001';
    end if;
    if coalesce(v_claim.evidence_url, '') = coalesce(nullif(btrim(p_evidence_url), ''), '') then
      return jsonb_build_object('status', 'unchanged', 'claim_id', v_claim.id);
    end if;
    update public.airdrop_social_claims
       set evidence_url = nullif(btrim(p_evidence_url), ''),
           status = 'pending', reviewer_wallet = null, review_note = null, reviewed_at = null
     where id = v_claim.id;
    update public.airdrop_points_ledger
       set status = 'pending', verified_at = null
     where season_id = p_season_id and wallet = p_wallet
       and event_type = v_event and source_key = v_claim.id::text;
  end if;

  return jsonb_build_object('status', 'edited', 'claim_id', v_claim.id);
end;
$func$;

-- RPC permissions: service_role only. Role guards keep this file runnable
-- on clean Postgres without Supabase roles.
do $perm$
declare
  f record;
begin
  for f in
    select * from (values
      ('update_airdrop_social_claim_atomic', 'uuid,text,text,text,text')
    ) as t(fname, fsig)
  loop
    execute format('revoke all on function public.%I(%s) from public', f.fname, f.fsig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%I(%s) from anon', f.fname, f.fsig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function public.%I(%s) from authenticated', f.fname, f.fsig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%I(%s) to service_role', f.fname, f.fsig);
    end if;
  end loop;
end
$perm$;
