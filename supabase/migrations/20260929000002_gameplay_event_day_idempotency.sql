-- Gameplay event-day idempotency (additive; replaces the 4-arg overload).
-- The old award_gameplay_match_atomic(uuid,text,text,boolean) locked and
-- capped on PROCESSING time (now()) and wrote NO marker when capped, so a
-- cross-UTC-day replay could add stale points to a new day's cap (and a
-- capped match never counted for referral qualification).
--
-- New signature takes the authoritative event time (matches.settled_at,
-- derived from Solana blockTime — never client time):
--   award_gameplay_match_atomic(uuid,text,text,boolean,timestamptz)
-- - Cap day = UTC date of p_settled_at. Lock key = season+wallet+event day.
-- - The gameplay_match marker is ALWAYS inserted (even 0 points when fully
--   capped), so a replay forever returns 'exists' and a capped match still
--   counts as an eligible settled game for referrals.
-- - A partially awarded match (winner bonus omitted for lack of cap room)
--   is FINAL for its event day: no later replay may top up the bonus.
-- - NULL p_settled_at fails closed (exception, no invented time).
-- The obsolete 4-arg overload is dropped below; service_role-only execute
-- is re-applied to the new signature (anon/authenticated/PUBLIC revoked).

create or replace function public.award_gameplay_match_atomic(
  p_season_id uuid,
  p_wallet text,
  p_match_id text,
  p_is_winner boolean,
  p_settled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_event_day text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_current integer;
  v_allow integer;
  v_entry_allow integer;
  v_game_pts integer := 0;
  v_bonus_pts integer := 0;
begin
  if p_settled_at is null then
    raise exception 'missing-settled-at' using errcode = '22023';
  end if;
  v_event_day := ((p_settled_at at time zone 'UTC')::date)::text;
  v_day_start := date_trunc('day', p_settled_at at time zone 'UTC') at time zone 'UTC';
  v_day_end := v_day_start + interval '1 day';

  perform pg_advisory_xact_lock(
    hashtext('gameplay-day:' || p_season_id::text || ':' || p_wallet || ':' || v_event_day)
  );

  -- Durable per-match marker: a replay of ANY processed match ends here.
  -- No bonus top-up on later days, ever.
  if exists (
    select 1 from public.airdrop_points_ledger
     where season_id = p_season_id and wallet = p_wallet
       and event_type = 'gameplay_match' and source_key = p_match_id
  ) then
    return jsonb_build_object('status', 'exists');
  end if;

  -- Event-day cap: rows stamped with this event day, plus legacy rows
  -- (pre-migration, no event_day metadata) whose processing day matches.
  select coalesce(sum(points), 0) into v_current from public.airdrop_points_ledger
   where season_id = p_season_id and wallet = p_wallet
     and category in ('gameplay', 'win_bonus') and status = 'verified'
     and ((metadata->>'event_day' = v_event_day)
          or (metadata->>'event_day' is null
              and created_at >= v_day_start and created_at < v_day_end));
  v_allow := greatest(0, 200 - v_current);
  v_entry_allow := v_allow;

  -- Marker is ALWAYS written, even at 0 points when fully capped.
  v_game_pts := least(2, v_allow);
  insert into public.airdrop_points_ledger
    (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
  values (p_season_id, p_wallet, 'gameplay', 'gameplay_match', p_match_id,
          v_game_pts, 'verified', now(),
          jsonb_build_object('matchId', p_match_id,
            'outcome', case when p_is_winner then 'win' else 'loss' end,
            'event_day', v_event_day,
            'capped', v_allow <= 0))
  on conflict (season_id, wallet, event_type, source_key) do nothing;
  v_allow := v_allow - v_game_pts;

  -- Winner bonus only from the SAME event day's remaining room. When the
  -- room is gone the bonus is omitted FOREVER (marker above makes replays
  -- return 'exists', never a top-up).
  if p_is_winner and v_allow > 0 then
    v_bonus_pts := least(3, v_allow);
    insert into public.airdrop_points_ledger
      (season_id, wallet, category, event_type, source_key, points, status, verified_at, metadata)
    values (p_season_id, p_wallet, 'win_bonus', 'win_bonus_match', p_match_id,
            v_bonus_pts, 'verified', now(),
            jsonb_build_object('matchId', p_match_id, 'event_day', v_event_day))
    on conflict (season_id, wallet, event_type, source_key) do nothing;
    v_allow := v_allow - v_bonus_pts;
  end if;

  -- Fully capped at entry: marker written above at 0 points.
  if v_entry_allow <= 0 then
    return jsonb_build_object('status', 'capped', 'day_total', v_current, 'event_day', v_event_day);
  end if;
  if v_game_pts < 2 or (p_is_winner and v_bonus_pts < 3) then
    return jsonb_build_object('status', 'partial', 'gameplay', v_game_pts, 'win_bonus', v_bonus_pts,
      'event_day', v_event_day);
  end if;
  return jsonb_build_object('status', 'awarded', 'gameplay', v_game_pts, 'win_bonus', v_bonus_pts,
    'event_day', v_event_day);
end;
$func$;

-- Remove the obsolete processing-time overload (4 args). Any lingering
-- caller fails loudly instead of silently using stale-day semantics.
drop function if exists public.award_gameplay_match_atomic(uuid, text, text, boolean);

-- RPC permissions: service_role only. Role guards keep this file runnable
-- on clean Postgres without Supabase roles.
do $perm$
declare
  f record;
begin
  for f in
    select * from (values
      ('award_gameplay_match_atomic', 'uuid,text,text,boolean,timestamptz')
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
