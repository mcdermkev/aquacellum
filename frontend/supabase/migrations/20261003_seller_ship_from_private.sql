-- ============================================================================
-- seller_ship_from: seller return addresses are not public
-- ============================================================================
-- Policy "Seller ship-from is public" was SELECT USING (true) for {public}, and
-- anon/authenticated held table SELECT, so any visitor with the anon key could
-- read every seller's name, phone, street address and postal code. The table is
-- empty today (0 rows), so nothing has leaked yet, but the first seller to save
-- a ship-from address would have published it.
--
-- Only the server reads or writes this table (api/stripe.js loadShipFrom and the
-- ship-from upsert, both service_role). No browser code or public page queries
-- it, so removing browser access breaks nothing.
--
-- REVERSIBILITY:
--   create policy "Seller ship-from is public" on public.seller_ship_from
--     for select using (true);
--   grant select on public.seller_ship_from to anon, authenticated;
-- ============================================================================

begin;

drop policy if exists "Seller ship-from is public" on public.seller_ship_from;

revoke all on table public.seller_ship_from from anon, authenticated;
grant select, insert, update, delete on table public.seller_ship_from to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.seller_ship_from', 'select')
     or has_table_privilege('authenticated', 'public.seller_ship_from', 'select') then
    raise exception 'browser roles can still read seller_ship_from';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'seller_ship_from'
                and cmd in ('SELECT', 'ALL') and qual = 'true') then
    raise exception 'a public-true read policy remains on seller_ship_from';
  end if;
end;
$$;

commit;
