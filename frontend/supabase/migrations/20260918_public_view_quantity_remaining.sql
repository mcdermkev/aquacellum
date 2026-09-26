-- ============================================================================
-- aquadex_listings_public — expose live stock (quantity_remaining)
-- Booth build follow-up (BOOTH_BUILD_SPEC.md §5), Tier A: public data boundary
-- ============================================================================
-- Supersedes the view definition in
-- supabase/migrations/20260728_aquadex_listings_public_view.sql. That file is
-- already applied and is left untouched; this migration is now the CURRENT
-- definition of the view. publicListingProjection.test.js resolves the latest
-- migration in supabase/migration-order.json that defines the view and checks
-- its allowlist against PUBLIC_LISTING_DATA_FIELDS.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- One field is added to the public allowlist: `quantityRemaining`, sourced from
-- the real column `aquadex_listings.quantity_remaining` (inventory of record,
-- 20260916_inventory_of_record.sql), NOT from the `data` blob. The column is the
-- authority — it is decremented atomically by the record-sale RPC, whereas the
-- blob is overwritten wholesale by cloudSync and would drift.
--
-- The same value is also exposed as a top-level `quantity_remaining` column so
-- the view stays name-compatible with the base table. It is APPENDED after
-- `data`: `create or replace view` can only add columns at the end; inserting
-- one mid-list fails with "cannot change name of view column".
--
-- Stock counts are meant to be public (see the 20260728 scope note: price,
-- species and quantity are browsable while logged out). NULL is preserved —
-- rows the backfill missed read as "unknown", never as zero/sold-out.
--
-- REVERSIBILITY: re-run the 20260728 definition after
--   `drop view public.aquadex_listings_public;` (a replace cannot drop the
-- appended column). Note the drop briefly removes anon browsing, since the
-- base table's anon SELECT policy was removed by the 20260729 lockdown.
-- ============================================================================

begin;

-- Defensive only: 20260916_inventory_of_record.sql creates this column and runs
-- earlier in supabase/migration-order.json.
alter table public.aquadex_listings add column if not exists quantity_remaining integer;

create or replace view public.aquadex_listings_public
with (security_invoker = false) as
with normalized as (
  select
    r.*,
    case
      when jsonb_typeof(r.data) = 'string' then (r.data #>> '{}')::jsonb
      when jsonb_typeof(r.data) = 'object' then r.data
      else '{}'::jsonb
    end as data_obj
  from public.aquadex_listings r
)
select
  l.id,
  l.seller_address,
  l.species_id,
  l.common_name,
  l.price,
  l.is_batch,
  l.is_active,
  l.created_at,
  l.updated_at,
  p.display_name as seller_display_name,
  -- ── The allowlist ────────────────────────────────────────────────────────
  -- Additive on purpose; never subtract known-bad keys (fail-open).
  --
  -- KEEP IN SYNC with PUBLIC_LISTING_DATA_FIELDS in
  -- frontend/src/services/publicListingProjection.js — publicListingProjection.test.js
  -- parses this block and fails the build if the two lists diverge.
  jsonb_build_object(
    -- Identity / routing
    'id',               l.data_obj -> 'id',
    'tokenId',          l.data_obj -> 'tokenId',
    'listingId',        l.data_obj -> 'listingId',
    'spawnId',          l.data_obj -> 'spawnId',
    'isBatch',          l.data_obj -> 'isBatch',
    'active',           l.data_obj -> 'active',
    'createdAt',        l.data_obj -> 'createdAt',
    -- Seller (already public on-chain)
    'seller',           l.data_obj -> 'seller',
    -- Species identity
    'speciesId',        l.data_obj -> 'speciesId',
    'commonName',       l.data_obj -> 'commonName',
    'scientificName',   l.data_obj -> 'scientificName',
    -- Lineage (public on-chain; rendered as parentage badges)
    'sireId',           l.data_obj -> 'sireId',
    'damId',            l.data_obj -> 'damId',
    -- Commerce. Integer cents are canonical; the dollar strings are what the
    -- public pages read today.
    'price',            l.data_obj -> 'price',
    'priceCentsUSD',    l.data_obj -> 'priceCentsUSD',
    'shippingFee',      l.data_obj -> 'shippingFee',
    'shippingFeeCents', l.data_obj -> 'shippingFeeCents',
    'isShipping',       l.data_obj -> 'isShipping',
    'quantity',         l.data_obj -> 'quantity',
    -- Live stock from the inventory-of-record column, not the blob.
    'quantityRemaining', to_jsonb(l.quantity_remaining),
    -- Care envelope shown on public cards
    'careLevel',        l.data_obj -> 'careLevel',
    'minTemp',          l.data_obj -> 'minTemp',
    'maxTemp',          l.data_obj -> 'maxTemp',
    'minPh',            l.data_obj -> 'minPh',
    'maxPh',            l.data_obj -> 'maxPh',
    -- Card imagery
    'photoUrl',         l.data_obj -> 'photoUrl'
  ) as data,
  -- Appended (see header): replace-view can only add columns at the end.
  l.quantity_remaining
from normalized l
left join public.profiles p
  on lower(p.wallet_address) = lower(l.seller_address);

comment on view public.aquadex_listings_public is
  'Display-safe projection of aquadex_listings for anonymous browsing (Fish Finder T14; live stock added by the booth build). Rebuilds the data blob from an explicit allowlist so new listing fields are never public by default. Mirrors PUBLIC_LISTING_DATA_FIELDS in frontend/src/services/publicListingProjection.js.';

-- Replace-view preserves existing grants; restated so this file is a complete,
-- self-describing definition. Read-only: no write grants.
grant select on public.aquadex_listings_public to anon, authenticated;

commit;

-- ── VERIFY (after apply, as anon) ───────────────────────────────────────────
--   select id, quantity_remaining, data->'quantityRemaining'
--   from public.aquadex_listings_public where is_active limit 3;
-- Expect the two values to match, and NULL (not 0) for un-backfilled rows.
