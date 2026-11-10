-- Keep player and welcome limits intact. The pinned Devnet signer pays the
-- ORAO and account costs of every match, so its limit is separate from players.
create or replace function public.reserve_devnet_expense(
  p_operation_key text,p_wallet text,p_kind text,p_lamports bigint,
  p_wallet_cap bigint,p_global_cap bigint,p_drain_reserve bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  limits public.devnet_token_releases%rowtype;
  cap_result text;
  wallet_cap bigint;
begin
  if p_kind='faucet' then raise exception 'use-versioned-hts-entitlement' using errcode='55000'; end if;
  if p_lamports is null or p_lamports<0 or p_wallet_cap is null or p_wallet_cap<=0
    or p_global_cap is null or p_global_cap<=0 or p_drain_reserve is null
    or p_drain_reserve<0 or p_drain_reserve>p_global_cap then
    raise exception 'invalid-expense' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(734278126);
  update public.devnet_expenses set status='failed',charged_lamports=0,updated_at=now()
    where status='reserved' and raw_transaction is null and lease_expires_at<now();
  if not exists(select 1 from public.devnet_expenses where operation_key=p_operation_key and status<>'failed') then
    select * into limits from public.devnet_token_releases where entitlement_version='hts-v1';
    if not found then raise exception 'hts-operational-limits-unconfigured' using errcode='55000'; end if;
    wallet_cap := limits.wallet_cap_lamports;
    if limits.enabled
      and limits.mint='HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4'
      and p_wallet='3PYi3jBXeQngna6WcjMGQcCz9wxp5oEBaSr7EZ1urPGw' then
      -- Retain the last 0.01 SOL of the service allowance for existing payouts.
      if p_kind='settle' then wallet_cap := 250000000;
      elsif p_kind in ('match','advance') then wallet_cap := 240000000;
      end if;
    end if;
    cap_result := public.hts_budget_result(p_wallet,p_lamports,
      least(p_wallet_cap,wallet_cap),least(p_global_cap,limits.global_cap_lamports),
      case when p_kind='settle' then p_drain_reserve else greatest(p_drain_reserve,limits.drain_reserve_lamports) end);
    if cap_result is not null then return jsonb_build_object('status',cap_result); end if;
  end if;
  return public.reserve_devnet_expense_b2_internal(p_operation_key,p_wallet,p_kind,p_lamports,p_wallet_cap,p_global_cap,p_drain_reserve);
end;
$$;
