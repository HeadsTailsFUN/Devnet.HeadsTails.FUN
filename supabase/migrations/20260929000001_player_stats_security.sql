-- Security cleanup: player_stats must execute as the invoker (Postgres 15+),
-- and browser roles must not hold direct access. The only intended path is:
-- browser -> /api/leaderboard -> server service role -> player_stats.
-- View columns and calculations are unchanged.

alter view public.player_stats set (security_invoker = true);

revoke all on table public.player_stats from anon;
revoke all on table public.player_stats from authenticated;

-- service_role access is preserved (explicit grant for clarity).
grant select on table public.player_stats to service_role;
