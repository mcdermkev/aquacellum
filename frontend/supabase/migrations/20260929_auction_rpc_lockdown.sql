-- ============================================================================
-- Auction settlement RPCs are server-only (2026-09-29). Money + ownership.
-- ============================================================================
-- These SECURITY DEFINER functions were executable by anon/authenticated (the
-- Postgres default grant to PUBLIC). Any browser could call
--   mark_auction_settlement_paid(id, 'pi_fake')  → mark a lot paid without paying
--   transfer_auction_lot(id)                      → then take the fish
-- and forfeit/record-failure other people's settlements.
--
-- Only api/stripe.js (service role) calls them. At the time of this migration
-- there were 0 settlements, 0 bids and 0 saved cards, so nothing was exposed.
--
-- Not changed here (still called from the browser today, reviewed separately
-- in the public auctions work): settle_tide_auction, sweep_overdue_auction_settlements.
-- ============================================================================

begin;

revoke execute on function public.mark_auction_settlement_paid(uuid, text)   from public, anon, authenticated;
revoke execute on function public.transfer_auction_lot(uuid)                 from public, anon, authenticated;
revoke execute on function public.record_auction_payment_failure(uuid, text) from public, anon, authenticated;
revoke execute on function public.forfeit_auction_settlement(uuid, text)     from public, anon, authenticated;

grant execute on function public.mark_auction_settlement_paid(uuid, text)   to service_role;
grant execute on function public.transfer_auction_lot(uuid)                 to service_role;
grant execute on function public.record_auction_payment_failure(uuid, text) to service_role;
grant execute on function public.forfeit_auction_settlement(uuid, text)     to service_role;

-- sweep_overdue_auction_settlements calls forfeit_auction_settlement internally.
-- It is SECURITY DEFINER (runs as its owner), so revoking the browser grant on
-- forfeit does not break the sweep.

do $$
declare v_bad text;
begin
  select string_agg(p.proname || ':' || r.rolname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  where n.nspname = 'public'
    and p.proname in ('mark_auction_settlement_paid', 'transfer_auction_lot',
                      'record_auction_payment_failure', 'forfeit_auction_settlement')
    and has_function_privilege(r.rolname, p.oid, 'execute');
  if v_bad is not null then
    raise exception 'browser roles can still execute: %', v_bad;
  end if;
end;
$$;

commit;
