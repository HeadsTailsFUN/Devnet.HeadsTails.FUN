-- Devnet only. Team points are derived from the verified, unique match
-- history and slot-scoped choices; no per-fan writes on settlement.
begin;

alter table public.airdrop_seasons add column team_points_start_at timestamptz;

do $$
begin
  update public.airdrop_seasons set team_points_start_at = statement_timestamp()
    where key = 'DEVNET_BETA' and active;
  if not found then
    raise exception 'Expected an active DEVNET_BETA season';
  end if;
end;
$$;

create table public.airdrop_team_choices (
  season_id uuid not null references public.airdrop_seasons(id),
  wallet text not null references public.profiles(wallet),
  after_slot bigint not null check (after_slot >= 0),
  team text check (team in ('HEADS', 'TAILS')),
  primary key (season_id, wallet, after_slot)
);

alter table public.airdrop_team_choices enable row level security;
revoke all on public.airdrop_team_choices from public, anon, authenticated;
grant select, insert, update on public.airdrop_team_choices to service_role;

-- Existing preferences qualify from activation, without backdating rewards.
insert into public.airdrop_team_choices (season_id, wallet, after_slot, team)
select s.id, p.wallet, 0, p.team_preference
from public.airdrop_seasons s cross join public.profiles p
where s.key = 'DEVNET_BETA' and s.active and p.team_preference is not null;

create index matches_hts_team_points_idx on public.matches (result, settled_at, created_slot)
where cluster = 'devnet'
  and program_id = 'AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k'
  and token_mint = 'HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
  and created_slot is not null;

create function public.save_devnet_community_team(p_wallet text, p_team text, p_after_slot bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_season uuid;
  v_slot bigint;
  v_team text;
begin
  if p_after_slot is null or p_after_slot <= 0 or (p_team is not null and p_team not in ('HEADS', 'TAILS')) then
    return false;
  end if;
  select id into v_season from public.airdrop_seasons
    where key = 'DEVNET_BETA' and active and team_points_start_at is not null;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_wallet, 129));
  select after_slot, team into v_slot, v_team from public.airdrop_team_choices
    where season_id = v_season and wallet = p_wallet order by after_slot desc limit 1;
  if v_slot > p_after_slot then return false; end if;

  insert into public.profiles (wallet, team_preference, team_prompt_completed)
    values (p_wallet, p_team, true) on conflict (wallet) do update
    set team_preference = excluded.team_preference, team_prompt_completed = true;
  if p_team is distinct from v_team then
    insert into public.airdrop_team_choices (season_id, wallet, after_slot, team)
      values (v_season, p_wallet, p_after_slot, p_team)
      on conflict (season_id, wallet, after_slot) do update set team = excluded.team;
  end if;
  return true;
end;
$$;

create function public.devnet_community_team_points(p_season uuid, p_wallets text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  with choices as (
    select c.wallet, c.team, c.after_slot,
      lead(c.after_slot) over (partition by c.wallet order by c.after_slot) as until_slot
    from public.airdrop_team_choices c
    where c.season_id = p_season and c.wallet = any(p_wallets)
      and not exists (select 1 from public.admin_members a where a.wallet = c.wallet)
      and not exists (select 1 from public.reward_exclusions x where x.wallet = c.wallet and x.active)
  ), totals as (
    select c.wallet, count(*) as points
    from public.airdrop_seasons s join choices c on c.team is not null
    join public.matches m on m.result = c.team
      and m.settled_at >= greatest(s.starts_at, s.team_points_start_at)
      and (s.ends_at is null or m.settled_at < s.ends_at)
      and m.created_slot > c.after_slot
      and (c.until_slot is null or m.created_slot <= c.until_slot)
    where s.id = p_season and s.key = 'DEVNET_BETA' and s.team_points_start_at is not null
      and m.cluster = 'devnet'
      and m.program_id = 'AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k'
      and m.token_mint = 'HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
      and m.tier_usd in (1, 10)
      and m.heads_wallet <> m.tails_wallet
      and m.winner_wallet = case m.result when 'HEADS' then m.heads_wallet else m.tails_wallet end
    group by c.wallet
  )
  select coalesce(jsonb_object_agg(wallet, points), '{}'::jsonb) from totals;
$$;

revoke all on function public.save_devnet_community_team(text, text, bigint),
  public.devnet_community_team_points(uuid, text[]) from public, anon, authenticated;
grant execute on function public.save_devnet_community_team(text, text, bigint),
  public.devnet_community_team_points(uuid, text[]) to service_role;

-- Rename exactly the prefixed usernames. Guard against unique collisions,
-- reserved names and invalid suffixes; never rename unrelated accounts.
lock table public.profiles in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.profiles p
    cross join lateral (select regexp_replace(p.username, '^(QA_BOT_)+', '') as name) n
    where p.username ~ '^QA_BOT_' and (
      n.name !~ '^[A-Za-z0-9_]{3,18}$'
      or lower(n.name) in ('admin','administrator','moderator','mod','headstails','heads','tails','support','system','official')
      or exists (
        select 1 from public.profiles other where other.wallet <> p.wallet
        and lower(n.name) in (other.username_normalized, lower(regexp_replace(other.username, '^(QA_BOT_)+', '')))
      )
    )
  ) then raise exception 'A prefixed username cannot be renamed safely'; end if;
end;
$$;
update public.profiles
set username = regexp_replace(username, '^(QA_BOT_)+', ''),
    username_normalized = lower(regexp_replace(username, '^(QA_BOT_)+', ''))
where username ~ '^QA_BOT_';

-- These tables have no client access policies. Remove provider default
-- grants as a second boundary and retain intentional public match reads.
revoke all on public.auth_nonces, public.auth_sessions, public.admin_members,
  public.admin_audit_log, public.profiles, public.airdrop_seasons,
  public.airdrop_points_ledger, public.airdrop_social_claims,
  public.airdrop_x_identities, public.reward_exclusions
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.matches
  from public, anon, authenticated;

commit;
