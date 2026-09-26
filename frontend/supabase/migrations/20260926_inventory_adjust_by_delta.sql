-- ============================================================================
-- Booth +/- stock adjust, applied as a DELTA under the sale lock
-- (BOOTH_BUILD_SPEC.md §6 Workstream E: "+/− adjust"). Tier A: inventory.
-- ============================================================================
-- Why not the existing adjust_inventory_remaining (20260916)? It SETS an absolute
-- count. A phone that read "4" and taps + would write 5 even if a second phone at
-- the same booth sold one in between — silently erasing a recorded sale. A delta
-- applied inside the same advisory lock record_inventory_sale uses cannot race a
-- sale: the two serialise, and each sees the other's result.
--
-- Contract:
--   * seller mismatch  -> insufficient_privilege
--   * unknown listing  -> no_data_found
--   * |p_delta| must be 1..1000 (a tap is ±1; the cap stops a typo zeroing stock)
--   * result clamps at 0 (a "−" on an empty line is a no-op, not an error)
--   * reaching 0 retires the listing (is_active=false), same as a sale
--   * a positive delta re-activates it (restocking a sold-out line puts it back
--     on sale — same rule as adjust_inventory_remaining); a negative delta never
--     re-activates a paused listing
--   * quantity_total never drops below the new remaining
--   * NULL remaining (never backfilled) is treated as 0, like the sale RPC
-- Returns the new quantity_remaining.
--
-- Additive: one new function, no table changes. Idempotent to re-run.
-- ============================================================================

begin;

create or replace function public.adjust_inventory_by(
  p_listing_id text,
  p_delta      integer,
  p_seller     text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller    text;
  v_remaining integer;
  v_total     integer;
  v_new       integer;
begin
  if p_listing_id is null or p_seller is null then
    raise exception 'listing_id and seller are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception 'delta must be between -1000 and 1000 and non-zero' using errcode = 'invalid_parameter_value';
  end if;

  -- Same lock key as record_inventory_sale / adjust_inventory_remaining.
  perform pg_advisory_xact_lock(hashtextextended(p_listing_id, 0));

  select seller_address, quantity_remaining, quantity_total
    into v_seller, v_remaining, v_total
  from public.aquadex_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'listing % not found', p_listing_id using errcode = 'no_data_found';
  end if;
  if lower(v_seller) <> lower(p_seller) then
    raise exception 'listing % does not belong to %', p_listing_id, p_seller
      using errcode = 'insufficient_privilege';
  end if;

  v_new := greatest(0, coalesce(v_remaining, 0) + p_delta);

  update public.aquadex_listings
  set quantity_remaining = v_new,
      quantity_total     = greatest(coalesce(v_total, 0), v_new),
      is_active = case
        when v_new = 0   then false
        when p_delta > 0 then true
        else is_active
      end,
      updated_at = now()
  where id = p_listing_id;

  return v_new;
end;
$$;

-- Server (service role) only. Supabase grants EXECUTE to anon/authenticated
-- directly, so revoking from PUBLIC alone is not enough (see
-- 20260926_server_only_rpc_lockdown.sql, which found that on the older RPCs).
revoke all on function public.adjust_inventory_by(text, integer, text) from public, anon, authenticated;
grant execute on function public.adjust_inventory_by(text, integer, text) to service_role;

commit;
