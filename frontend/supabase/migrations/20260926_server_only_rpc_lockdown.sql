-- ============================================================================
-- Lock server-only SECURITY DEFINER RPCs away from browser roles. Tier A.
-- ============================================================================
-- Found 2026-09-26 while verifying the booth adjust RPC: these functions were
-- written with `revoke all ... from public; grant execute ... to service_role;`,
-- but Supabase grants EXECUTE on public-schema functions to `anon` and
-- `authenticated` DIRECTLY (default privileges), not via PUBLIC. Revoking from
-- PUBLIC therefore removed nothing, and anyone holding the public anon key could
-- call them over PostgREST:
--
--   record_inventory_sale       SECURITY DEFINER — decrement any seller's stock
--                               (p_seller is a public wallet address)
--   adjust_inventory_remaining  SECURITY DEFINER — set any seller's stock
--   adjust_inventory_by         SECURITY DEFINER — nudge any seller's stock
--   redeem_promotion            SECURITY DEFINER — burn a promotion's uses
--   increment_published_tank_views SECURITY DEFINER — inflate a view counter
--
-- Every legitimate caller is server code using the service-role key
-- (api/stripe.js, api/storefront-detail.js, api/_lib/cardSaleInventory.js);
-- no browser code, edge function, or worker calls them. service_role keeps
-- EXECUTE. Idempotent. Reversible with the matching GRANTs (do not).
-- ============================================================================

begin;

revoke execute on function public.record_inventory_sale(text, text, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.adjust_inventory_remaining(text, integer, text)            from public, anon, authenticated;
revoke execute on function public.adjust_inventory_by(text, integer, text)                   from public, anon, authenticated;
revoke execute on function public.redeem_promotion(uuid, text, integer, text, text, text)    from public, anon, authenticated;
revoke execute on function public.increment_published_tank_views(text)                       from public, anon, authenticated;

grant execute on function public.record_inventory_sale(text, text, integer, text, text, uuid) to service_role;
grant execute on function public.adjust_inventory_remaining(text, integer, text)            to service_role;
grant execute on function public.adjust_inventory_by(text, integer, text)                   to service_role;
grant execute on function public.redeem_promotion(uuid, text, integer, text, text, text)    to service_role;
grant execute on function public.increment_published_tank_views(text)                       to service_role;

-- Post-condition: fail the whole migration if any browser role can still call them.
do $$
declare
  v_leak text;
begin
  select string_agg(p.proname || ' -> ' || r.rolname, ', ')
    into v_leak
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  where n.nspname = 'public'
    and p.proname in ('record_inventory_sale', 'adjust_inventory_remaining', 'adjust_inventory_by',
                      'redeem_promotion', 'increment_published_tank_views')
    and has_function_privilege(r.rolname, p.oid, 'execute');
  if v_leak is not null then
    raise exception 'browser roles still have execute: %', v_leak;
  end if;
end;
$$;

commit;
