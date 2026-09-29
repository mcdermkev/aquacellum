-- ============================================================================
-- aquadex_listings_public — expose coral frag listing details
-- Saltwater phase 3: coral frag listings (frontend/src/services/fragListing.js)
-- ============================================================================
-- Supersedes the view definition in
-- frontend/supabase/migrations/20260918_public_view_quantity_remaining.sql. That
-- file is applied and left untouched; this migration is now the CURRENT
-- definition. publicListingProjection.test.js resolves the latest migration in
-- supabase/migration-order.json that defines the view and checks its allowlist
-- against PUBLIC_LISTING_DATA_FIELDS / PUBLIC_FRAG_DATA_FIELDS.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- Two keys are added to the rebuilt `data` blob, nothing is removed:
--
--   listingKind  "coral_frag" marks a frag listing (absent/null on fish).
--   frag         a NESTED object rebuilt from an explicit subkey allowlist, never
--                passed through whole. Each value is type/enum checked here,
--                because a seller writes their own row's blob and the view is the
--                only enforcement point anon reads through:
--                  sizeValue       number
--                  sizeUnit        polyps | heads | cm | in
--                  mount           plug | disc | rock | none
--                  wysiwyg         boolean
--                  origin          aquacultured | maricultured | wild
--                  motherPhotoUrl  https URL, <= 2048 chars (no base64, no http)
--                Invalid or missing subkeys are dropped (jsonb_strip_nulls).
--                `grownUnder` is seller free text and stays withheld, like
--                `description`; signed-in buyers read it from the full blob.
--
-- No column changes: `data` keeps its position and `quantity_remaining` stays
-- the last column, so `create or replace view` applies cleanly.
--
-- REVERSIBILITY: re-run 20260918_public_view_quantity_remaining.sql. Same
-- columns, so a plain replace restores the previous blob.
-- ============================================================================

begin;

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
    'photoUrl',         l.data_obj -> 'photoUrl',
    -- Coral frags. KEEP the nested keys IN SYNC with PUBLIC_FRAG_DATA_FIELDS.
    'listingKind',      l.data_obj -> 'listingKind',
    'frag', case when jsonb_typeof(l.data_obj -> 'frag') = 'object' then jsonb_strip_nulls(jsonb_build_object(
        'sizeValue',      case when jsonb_typeof(l.data_obj #> '{frag,sizeValue}') = 'number' then l.data_obj #> '{frag,sizeValue}' end,
        'sizeUnit',       case when (l.data_obj #>> '{frag,sizeUnit}') in ('polyps', 'heads', 'cm', 'in') then l.data_obj #> '{frag,sizeUnit}' end,
        'mount',          case when (l.data_obj #>> '{frag,mount}') in ('plug', 'disc', 'rock', 'none') then l.data_obj #> '{frag,mount}' end,
        'wysiwyg',        case when jsonb_typeof(l.data_obj #> '{frag,wysiwyg}') = 'boolean' then l.data_obj #> '{frag,wysiwyg}' end,
        'origin',         case when (l.data_obj #>> '{frag,origin}') in ('aquacultured', 'maricultured', 'wild') then l.data_obj #> '{frag,origin}' end,
        'motherPhotoUrl', case when jsonb_typeof(l.data_obj #> '{frag,motherPhotoUrl}') = 'string' and (l.data_obj #>> '{frag,motherPhotoUrl}') ~* '^https://[^[:space:]]+$' and length(l.data_obj #>> '{frag,motherPhotoUrl}') <= 2048 then l.data_obj #> '{frag,motherPhotoUrl}' end
      )) end
  ) as data,
  -- Appended in 20260918: replace-view can only add columns at the end.
  l.quantity_remaining
from normalized l
left join public.profiles p
  on lower(p.wallet_address) = lower(l.seller_address);

comment on view public.aquadex_listings_public is
  'Display-safe projection of aquadex_listings for anonymous browsing (Fish Finder T14; live stock added by the booth build; coral frag details added by saltwater phase 3). Rebuilds the data blob from an explicit allowlist so new listing fields are never public by default. Mirrors PUBLIC_LISTING_DATA_FIELDS in frontend/src/services/publicListingProjection.js.';

-- Replace-view preserves existing grants; restated so this file is a complete,
-- self-describing definition. Read-only: no write grants.
grant select on public.aquadex_listings_public to anon, authenticated;

commit;

-- ── VERIFY (after apply, as anon) ───────────────────────────────────────────
--   select id, data->'listingKind', data->'frag'
--   from public.aquadex_listings_public where data->>'listingKind' = 'coral_frag' limit 3;
-- Expect only the six allowlisted frag subkeys, and no grownUnder.
