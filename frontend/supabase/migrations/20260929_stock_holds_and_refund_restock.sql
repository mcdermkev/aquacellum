-- ============================================================================
-- Stock gaps before real money (2026-09-29). Inventory + money adjacent.
-- ============================================================================
-- 1. Cash sales respect card holds.
--    A buyer mid-checkout holds units in canonical_reservations (reserve_stock),
--    but record_inventory_sale only compared against quantity_remaining, so a
--    booth cash sale could take a fish someone was paying for online.
--    record_inventory_sale gains p_respect_holds (default false). When true it
--    also subtracts ACTIVE holds (reserved-and-unexpired, committed, consumed —
--    exactly reserve_stock's definition) and raises 'held: …' if the sale would
--    eat into them. Same advisory lock key as reserve_stock (the listing id), so
--    the two serialise.
--    Only live booth taps pass true. The card webhook must NOT (it would count
--    its own committed hold), and an offline sale replayed later must NOT (that
--    fish already left the table; the card side is caught at handoff instead).
--
-- 2. Refunds put stock back.
--    restock_card_sale(pi) reverses the webhook's `stripe:<pi>` decrement once,
--    recording a `restock:<pi>` event (rail 'restock'). Returns NULL when there
--    is nothing to reverse (the card decrement never happened, e.g. oversold).
--    WHETHER to restock (full refund, fish never handed off) is decided by the
--    caller (api/_lib/cardSaleInventory.js); this function only makes it exact.
--
-- Idempotent. record_inventory_sale's signature changes, so the old overload is
-- dropped and grants are re-applied (server-only, as in
-- 20260926_server_only_rpc_lockdown.sql).
-- ============================================================================

begin;

-- ── 0. Ledger: allow the restock rail ──────────────────────────────────────
alter table public.inventory_sale_events drop constraint if exists inventory_sale_events_rail_check;
alter table public.inventory_sale_events
  add constraint inventory_sale_events_rail_check
  check (rail in ('cash', 'card', 'adjustment', 'restock'));

-- ── 1. record_inventory_sale with optional hold awareness ──────────────────
drop function if exists public.record_inventory_sale(text, text, integer, text, text, uuid);

create or replace function public.record_inventory_sale(
  p_sale_id        text,
  p_listing_id     text,
  p_quantity       integer,
  p_seller         text,
  p_rail           text    default 'cash',
  p_order_id       uuid    default null,
  p_respect_holds  boolean default false
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
  v_held             integer := 0;
  v_now_ms           bigint;
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

  if p_respect_holds then
    v_now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    select coalesce(sum(quantity), 0) into v_held
    from public.canonical_reservations
    where sku = p_listing_id
      and (state in ('committed', 'consumed')
           or (state = 'reserved' and expires_at_ms > v_now_ms));
    if v_remaining - v_held < v_qty then
      raise exception 'held: % remaining, % on hold for online checkout, % requested for listing %',
        v_remaining, v_held, v_qty, p_listing_id using errcode = 'check_violation';
    end if;
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

revoke execute on function public.record_inventory_sale(text, text, integer, text, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_inventory_sale(text, text, integer, text, text, uuid, boolean)
  to service_role;

-- ── 2. restock_card_sale: reverse a refunded card sale, once ───────────────
create or replace function public.restock_card_sale(
  p_payment_intent text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id    text;
  v_restock_id text;
  v_listing    text;
  v_seller     text;
  v_qty        integer;
  v_after      integer;
  v_remaining  integer;
  v_total      integer;
  v_new        integer;
begin
  if p_payment_intent is null or btrim(p_payment_intent) = '' then
    raise exception 'payment_intent is required' using errcode = 'invalid_parameter_value';
  end if;
  v_sale_id    := 'stripe:'  || p_payment_intent;
  v_restock_id := 'restock:' || p_payment_intent;

  -- Already reversed → the recorded result (replayed webhook).
  select quantity_after into v_after from public.inventory_sale_events where sale_id = v_restock_id;
  if found then return v_after; end if;

  -- Nothing was decremented for this payment → nothing to put back.
  select listing_id, seller_address, quantity into v_listing, v_seller, v_qty
  from public.inventory_sale_events where sale_id = v_sale_id and rail = 'card';
  if not found then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_listing, 0));

  select quantity_after into v_after from public.inventory_sale_events where sale_id = v_restock_id;
  if found then return v_after; end if;

  select quantity_remaining, quantity_total into v_remaining, v_total
  from public.aquadex_listings where id = v_listing for update;
  if not found then return null; end if;  -- listing deleted: nothing to restock

  v_new := coalesce(v_remaining, 0) + v_qty;

  update public.aquadex_listings
  set quantity_remaining = v_new,
      quantity_total     = greatest(coalesce(v_total, 0), v_new),
      is_active          = true,
      updated_at         = now()
  where id = v_listing;

  insert into public.inventory_sale_events
    (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  values
    (v_restock_id, v_listing, v_seller, v_qty, v_new, 'restock', null);

  return v_new;
end;
$$;

revoke execute on function public.restock_card_sale(text) from public, anon, authenticated;
grant execute on function public.restock_card_sale(text) to service_role;

-- ── Post-conditions ────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_inventory_sale' and p.pronargs <> 7
  ) then
    raise exception 'an old record_inventory_sale overload still exists';
  end if;
  if has_function_privilege('anon', 'public.record_inventory_sale(text,text,integer,text,text,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.record_inventory_sale(text,text,integer,text,text,uuid,boolean)', 'execute') then
    raise exception 'browser roles can execute record_inventory_sale';
  end if;
  if has_function_privilege('anon', 'public.restock_card_sale(text)', 'execute')
     or has_function_privilege('authenticated', 'public.restock_card_sale(text)', 'execute') then
    raise exception 'browser roles can execute restock_card_sale';
  end if;
end;
$$;

commit;
