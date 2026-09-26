-- ============================================================================
-- Repair: stock backfill missed listings whose `data` is a JSON *string*
-- Booth build, Tier A (inventory of record). MUST apply BEFORE
-- 20260918_public_view_quantity_remaining.sql.
-- ============================================================================
-- ── THE BUG (found in the pre-apply check against production, 2026-08-29) ───
-- 20260916_inventory_of_record.sql backfilled stock with `data->>'quantity'`.
-- cloudSync writes `data` as JSON.stringify(listing), so a row's jsonb can be a
-- STRING SCALAR holding JSON (the 20260728 view already normalizes for exactly
-- this). Against a string scalar `->>` returns NULL, so every such batch row fell
-- through to `WHEN is_batch THEN 0`.
--
-- Live result: all 7 active batch listings (8000001–8000007, the curated
-- showcase) have quantity_total = quantity_remaining = 0 while their blob says
-- 2 or 4. Consequences today and after the view migration:
--   * record_inventory_sale raises 'oversell' for every booth sale of them;
--   * once the public view exposes quantityRemaining, catalogQuery's cart check
--     (`quantityRemaining ?? quantity`) reads 0 and refuses add-to-cart on every
--     active batch listing on the public marketplace.
--
-- The BEFORE INSERT seed trigger has the same flaw, so new string-blob batch
-- listings would also land at 0. Fixed here too.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
-- The re-backfill only touches rows that are provably the bug's output and have
-- never been sold through the ledger:
--   is_batch, string-scalar blob, total = remaining = 0, a numeric blob quantity,
--   and NO inventory_sale_events row for the listing.
-- A listing genuinely sold down to 0 always has a sale event, so it is never
-- "restored". A post-condition check aborts the whole transaction if any
-- affected row is left at 0.
--
-- Idempotent: a second run matches nothing.
-- ============================================================================

begin;

-- Normalizes `data` to a jsonb object: object as-is, string scalar parsed, anything
-- else (or unparseable text) -> '{}'. Never raises, because the seed trigger calls
-- it on every listing insert and a bad blob must not block listing creation.
-- Left with default EXECUTE on purpose: the trigger runs as the inserting role
-- (browser key), and the function reads no tables.
create or replace function public.aquadex_listing_data_object(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_data is null then
    return '{}'::jsonb;
  elsif jsonb_typeof(p_data) = 'object' then
    return p_data;
  elsif jsonb_typeof(p_data) = 'string' then
    begin
      p_data := (p_data #>> '{}')::jsonb;
    exception when others then
      return '{}'::jsonb;
    end;
    return case when jsonb_typeof(p_data) = 'object' then p_data else '{}'::jsonb end;
  end if;
  return '{}'::jsonb;
end;
$$;

-- Seed trigger: same contract as 20260916, reading the normalized blob.
create or replace function public.seed_listing_quantity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_qty  text;
  v_seed integer;
begin
  if new.quantity_remaining is not null and new.quantity_total is not null then
    return new;
  end if;

  v_qty := public.aquadex_listing_data_object(new.data) ->> 'quantity';
  v_seed := case
    when v_qty ~ '^[0-9]+$' then v_qty::int
    when new.is_batch then 0        -- a batch with no readable quantity sells nothing
    else 1                          -- a single specimen is exactly one fish
  end;

  new.quantity_total     := coalesce(new.quantity_total, v_seed);
  new.quantity_remaining := coalesce(new.quantity_remaining, v_seed);
  return new;
end;
$$;
-- trg_seed_listing_quantity already points at this function; no trigger change.

-- Re-backfill exactly the rows the original backfill got wrong.
with parsed as (
  select
    l.id,
    public.aquadex_listing_data_object(l.data) ->> 'quantity' as qty_text
  from public.aquadex_listings l
  where l.is_batch
    and jsonb_typeof(l.data) = 'string'
    and l.quantity_total = 0
    and l.quantity_remaining = 0
    and not exists (
      select 1 from public.inventory_sale_events e where e.listing_id = l.id
    )
),
candidates as (
  -- CASE guards the cast: SQL does not promise the regex filter runs first.
  select id, case when qty_text ~ '^[0-9]{1,9}$' then qty_text::int end as qty
  from parsed
)
update public.aquadex_listings l
set quantity_total     = c.qty,
    quantity_remaining = c.qty
from candidates c
where l.id = c.id
  and c.qty > 0;
-- updated_at deliberately untouched: this corrects a derived column, it is not a
-- listing edit, and the public pages show updated_at to buyers.

-- Post-condition: no never-sold batch listing may still disagree with its blob.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.aquadex_listings l
  where l.is_batch
    and l.quantity_remaining = 0
    and (public.aquadex_listing_data_object(l.data) ->> 'quantity') ~ '^[1-9][0-9]*$'
    and not exists (
      select 1 from public.inventory_sale_events e where e.listing_id = l.id
    );
  if v_bad > 0 then
    raise exception 'stock repair incomplete: % batch listing(s) still at 0 with blob stock', v_bad;
  end if;
end;
$$;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--   select id, quantity_total, quantity_remaining,
--          public.aquadex_listing_data_object(data)->>'quantity' as blob_qty
--   from public.aquadex_listings where is_batch order by id;
-- Expect total = remaining = blob_qty for 8000001–8000007.
--
-- REVERSIBILITY: the prior values were all 0 and derivable (is_batch, string blob,
-- no sale events). Restoring them would re-break sales, so there is no reason to;
-- the previous seed_listing_quantity body is in 20260916_inventory_of_record.sql.
