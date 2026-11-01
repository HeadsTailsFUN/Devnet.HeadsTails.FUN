-- V2 social: chain-derived player stats read model (one row per wallet).
-- Each settled match counts once per participant. Read-only for API routes.

create or replace view public.player_stats as
select
  s.wallet as wallet,
  count(*)::int as games_played,
  sum(case when s.winner_wallet = s.wallet then 1 else 0 end)::int as wins,
  sum(case when s.winner_wallet = s.wallet then 0 else 1 end)::int as losses,
  coalesce(
    sum(case when s.winner_wallet = s.wallet then s.heads_amount + s.tails_amount else 0 end),
    0
  ) as total_won_base_units
from (
  select heads_wallet as wallet, winner_wallet, heads_amount, tails_amount
  from public.matches
  union all
  select tails_wallet as wallet, winner_wallet, heads_amount, tails_amount
  from public.matches
) s
group by s.wallet;
