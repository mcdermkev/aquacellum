-- ============================================================================
-- Reward credit functions are server-only
-- ============================================================================
-- apply_credits_at_checkout(p_wallet, p_amount, p_order_id) and
-- expire_old_credits() were SECURITY INVOKER and executable by anon and
-- authenticated. apply_credits_at_checkout takes the wallet from its argument,
-- so it would spend any wallet's credits for whoever calls it. Today that call
-- fails (profiles_guard_server_columns blocks browser roles from changing
-- reward_credits) and no app code calls it (checked 2026-10-05: the only caller,
-- useApplyCredits, was never used and is removed in the same change). 0 wallets
-- hold credits and credit_transactions is empty.
--
-- Credits, if they are ever spent, must be applied by the server during
-- checkout (api/stripe.js, service_role) with the wallet taken from the
-- verified session. This migration makes both functions callable by
-- service_role only and pins their search_path.
--
-- REVERSIBILITY:
--   grant execute on function public.apply_credits_at_checkout(text, numeric, text) to anon, authenticated;
--   grant execute on function public.expire_old_credits() to anon, authenticated;
-- ============================================================================

begin;

revoke all on function public.apply_credits_at_checkout(text, numeric, text) from public, anon, authenticated;
revoke all on function public.expire_old_credits() from public, anon, authenticated;
grant execute on function public.apply_credits_at_checkout(text, numeric, text) to service_role;
grant execute on function public.expire_old_credits() to service_role;

alter function public.apply_credits_at_checkout(text, numeric, text) set search_path = public, pg_temp;
alter function public.expire_old_credits() set search_path = public, pg_temp;

do $$
begin
  if has_function_privilege('anon', 'public.apply_credits_at_checkout(text, numeric, text)', 'execute')
     or has_function_privilege('authenticated', 'public.apply_credits_at_checkout(text, numeric, text)', 'execute')
     or has_function_privilege('anon', 'public.expire_old_credits()', 'execute')
     or has_function_privilege('authenticated', 'public.expire_old_credits()', 'execute') then
    raise exception 'browser roles can still execute a credit function';
  end if;
  if not has_function_privilege('service_role', 'public.apply_credits_at_checkout(text, numeric, text)', 'execute') then
    raise exception 'service_role lost execute on apply_credits_at_checkout';
  end if;
end;
$$;

commit;
