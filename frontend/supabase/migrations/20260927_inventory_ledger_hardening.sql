-- ============================================================================
-- Inventory ledger + permission hardening (independent review 2026-09-28).
-- Tier A: inventory and access control.
-- ============================================================================
-- 1. record_inventory_sale treated ANY existing sale_id as "already applied" and
--    returned early without checking it was the same sale. Because cash and card
--    share one sale_id namespace, a client could pre-insert `stripe:<pi>` and turn
--    the card webhook's decrement into a silent no-op (then the hold is released
--    and the fish can be sold again). A replay now must match listing AND seller;
--    anything else raises unique_violation. (record-sale also rejects the
--    `stripe:` prefix; this closes the class at the database.)
-- 2. adjust_inventory_by now leaves an audit row (rail 'adjustment') so stock
--    changes can be reconciled later.
-- 3. Browser roles lose write/execute they never needed. RLS already blocked
--    these, so no current exposure; this makes it explicit:
--      aquadex_listings_public view : anon/authenticated keep SELECT only
--      published_tanks, inventory_sale_events, canonical_reservations,
--      promotion_redemptions        : server-only (no browser privileges)
--      reserve_stock                : server-only
--    Every legitimate caller uses the service-role key (api/). Verified by grep:
--    no browser code touches these.
-- Idempotent. Function signatures unchanged, so existing grants carry over.
-- ============================================================================

begin;

-- ── 1. record_inventory_sale: replay must be the same sale ─────────────────
create or replace function public.record_inventory_sale(
  p_sale_id     text,
  p_listing_id  text,
  p_quantity    integer,
  p_seller      text,
  p_rail        text default 'cash',
  p_order_id    uuid default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_after   integer;
  v_existing_listing text;
  v_existing_seller  text;
  v_seller           text;
  v_remaining        integer;
  v_qty              integer := greatest(1, coalesce(p_quantity, 1));
  v_new_remaining    integer;
begin
  if p_sale_id is null or btrim(p_sale_id) = '' then
    raise exception 'sale_id is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_listing_id is null or p_seller is null then
    raise exception 'listing_id and seller are required' using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotency FIRST: a replayed sale is a pure read — but only if it is the
  -- same sale. A reused id for a different listing/seller is a conflict.
  select quantity_after, listing_id, seller_address
    into v_existing_after, v_existing_listing, v_existing_seller
  from public.inventory_sale_events where sale_id = p_sale_id;
  if found then
    if v_existing_listing <> p_listing_id or lower(v_existing_seller) <> lower(p_seller) then
      raise exception 'sale_id % already used for a different sale', p_sale_id using errcode = 'unique_violation';
    end if;
    return v_existing_after;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_listing_id, 0));

  -- Re-check inside the lock (two devices replaying the same offline sale).
  select quantity_after, listing_id, seller_address
    into v_existing_after, v_existing_listing, v_existing_seller
  from public.inventory_sale_events where sale_id = p_sale_id;
  if found then
    if v_existing_listing <> p_listing_id or lower(v_existing_seller) <> lower(p_seller) then
      raise exception 'sale_id % already used for a different sale', p_sale_id using errcode = 'unique_violation';
    end if;
    return v_existing_after;
  end if;

  select seller_address, quantity_remaining
    into v_seller, v_remaining
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

  v_remaining := coalesce(v_remaining, 0);
  if v_remaining < v_qty then
    raise exception 'oversell: % remaining, % requested for listing %',
      v_remaining, v_qty, p_listing_id using errcode = 'check_violation';
  end if;

  v_new_remaining := v_remaining - v_qty;

  update public.aquadex_listings
  set quantity_remaining = v_new_remaining,
      is_active = case when v_new_remaining = 0 then false else is_active end,
      updated_at = now()
  where id = p_listing_id;

  insert into public.inventory_sale_events
    (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  values
    (p_sale_id, p_listing_id, lower(p_seller), v_qty, v_new_remaining,
     coalesce(nullif(p_rail, ''), 'cash'), p_order_id);

  return v_new_remaining;
end;
$$;

-- ── 2. adjust_inventory_by: same behaviour, plus an audit row ──────────────
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

  -- Audit: direction and size are in the id (quantity is always >= 1 here).
  -- The 'adjust:' prefix can never collide with a sale id (record-sale rejects
  -- anything but plain client ids, and card ids are 'stripe:').
  insert into public.inventory_sale_events
    (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  values
    ('adjust:' || case when p_delta > 0 then '+' else '-' end || abs(p_delta)::text || ':' || gen_random_uuid()::text,
     p_listing_id, lower(p_seller), abs(p_delta), v_new, 'adjustment', null);

  return v_new;
end;
$$;

-- ── 3. Browser-role privilege cleanup ──────────────────────────────────────
revoke insert, update, delete, truncate, references, trigger
  on public.aquadex_listings_public from anon, authenticated;
grant select on public.aquadex_listings_public to anon, authenticated;

revoke all on public.published_tanks        from anon, authenticated;
revoke all on public.inventory_sale_events  from anon, authenticated;
revoke all on public.canonical_reservations from anon, authenticated;
revoke all on public.promotion_redemptions  from anon, authenticated;

revoke execute on function public.reserve_stock(text, text, integer, text, bigint, integer, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_stock(text, text, integer, text, bigint, integer, bigint, uuid)
  to service_role;

-- Post-conditions: the view is still readable, nothing else is.
do $$
declare v_bad text;
begin
  if not has_table_privilege('anon', 'public.aquadex_listings_public', 'select') then
    raise exception 'anon lost SELECT on aquadex_listings_public';
  end if;
  select string_agg(t || ':' || p, ', ') into v_bad
  from (values ('aquadex_listings_public'), ('published_tanks'), ('inventory_sale_events'),
               ('canonical_reservations'), ('promotion_redemptions')) as tbl(t)
  cross join (values ('insert'), ('update'), ('delete')) as priv(p)
  where has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p);
  if v_bad is not null then
    raise exception 'browser roles still have write privileges: %', v_bad;
  end if;
  if has_function_privilege('anon', 'public.reserve_stock(text,text,integer,text,bigint,integer,bigint,uuid)', 'execute') then
    raise exception 'anon can still execute reserve_stock';
  end if;
  if has_function_privilege('anon', 'public.record_inventory_sale(text,text,integer,text,text,uuid)', 'execute') then
    raise exception 'anon can execute record_inventory_sale';
  end if;
end;
$$;

commit;
