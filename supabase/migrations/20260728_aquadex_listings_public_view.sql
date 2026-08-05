-- ============================================================================
-- aquadex_listings_public — display-safe projection for anonymous browsing
-- Fish Finder Rework, Task 14 (Tier A)
-- ============================================================================
-- ⚠️  NOT YET APPLIED. Review, then apply deliberately (see "TO APPLY" below).
--     Creating this view is additive and breaks nothing on its own; it is the
--     PREREQUISITE for the RLS lockdown, applied 2026-07-29 as
--     supabase/migrations/20260729_aquadex_listings_rls_lockdown.sql.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `aquadex_listings.data` is a JSON dump of the whole local listing object
-- (cloudSync.js `listingToRow`). The `listings_select_public` policy
-- (supabase/migrations/20260619_tighten_cloud_sync_rls.sql) lets the `anon`
-- role read those rows wholesale, so anything a listing wizard writes into the
-- blob is public the moment it ships — a fail-OPEN boundary with no review
-- step. Today that includes the seller's packing profile, DOA/health terms, and
-- care notes.
--
-- This view is the fail-CLOSED boundary: it rebuilds `data` from an explicit
-- allowlist of the fields the public pages actually render. Adding a public
-- field becomes a deliberate migration, not a side effect.
--
-- Scope honesty — this does NOT make listings secret, and is not claimed to:
--   * Listings are a public storefront. Price/species/quantity are MEANT to be
--     browsable while logged out; `marketplace.html` exists for that.
--   * `seller_address` stays exposed. It is already readable off-chain by
--     anyone via `AquadexMarketplace.listings(tokenId)` (marketplace.html reads
--     it that way itself), and three public surfaces key on it. Hiding it here
--     while publishing it on-chain would buy nothing. A resolved display name
--     is added ALONGSIDE it.
--   * There is no location column to fuzz — Decision D3 deleted fabricated
--     seller coordinates at the source. Real pickup coordinates live in
--     `pickup_locations` and are revealed order-scoped only.
-- The win is the reviewed field list, i.e. bulk scraping yields a bounded set.
--
-- ── COLUMN COMPATIBILITY (deliberate) ───────────────────────────────────────
-- Column names match `aquadex_listings` exactly (id, seller_address,
-- species_id, common_name, price, is_batch, is_active, created_at, updated_at,
-- data) so every anonymous reader repoints with a table-name swap and no
-- parsing changes:
--   frontend/marketplace.html  fetchCloudListings()
--   frontend/species.html      (3 call sites)
--   frontend/store.html        (storefront listings)
--
-- ── SECURITY MODEL ──────────────────────────────────────────────────────────
-- `security_invoker = false` (set explicitly rather than relying on the
-- Postgres default) means the view reads the base table with the VIEW OWNER's
-- rights, so it keeps working after the base table's anon SELECT policy is
-- dropped. That is the whole point: the view becomes the only anon read path.
-- The view is read-only (no INSERT/UPDATE/DELETE granted).
--
-- Unaffected by this and by the follow-up lockdown, because `service_role`
-- bypasses RLS entirely:
--   frontend/api/species.js        fetchActiveListings (availability aggregate)
--   frontend/api/storefront-detail.js
--   frontend/api/stripe.js         authoritative price validation (money-critical)
--
-- ── TO APPLY ────────────────────────────────────────────────────────────────
--   1. supabase db push   (or paste into the Supabase SQL editor)
--   2. Verify anon can read the view:
--        curl "https://<REF>.supabase.co/rest/v1/aquadex_listings_public?is_active=eq.true&select=data,seller_address&limit=1" \
--          -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      Expect a row whose `data` contains ONLY allowlisted keys (no
--      packingProfile / description / healthStatus / doaGuarantee / tankSizeMin).
--   3. Deploy the frontend repoint, smoke-test marketplace.html / species.html /
--      store.html while LOGGED OUT.
--   4. Only then consider the RLS lockdown (separate staged file).
--
-- REVERSIBILITY: `drop view if exists public.aquadex_listings_public;`
-- Safe while the base table still has its anon SELECT policy (i.e. before the
-- lockdown); after the lockdown, dropping this view removes public browsing.
-- ============================================================================

-- `data` is a jsonb column, but the writer hands PostgREST a JSON *string*
-- (`JSON.stringify(listing)` in cloudSync.js `listingToRow`). Depending on how
-- the value was cast on insert, a row's jsonb can therefore hold either an
-- object or a string scalar containing JSON. The JS readers already handle both
-- (`typeof r.data === 'string' ? JSON.parse(r.data) : r.data`); `->` does not —
-- against a string scalar every field would silently come back NULL and the
-- public pages would render empty cards. Normalize first so the allowlist reads
-- from an object either way.
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
  -- Resolved seller display name (never a substitute for seller_address — see
  -- the note above). NULL when the seller has no profile; the public pages
  -- already fall back to their deterministic `generateAlias(address)`.
  p.display_name as seller_display_name,
  -- ── The allowlist ────────────────────────────────────────────────────────
  -- Additive on purpose. A subtractive form (`l.data - 'description' - ...`)
  -- would be fail-open: any newly-written field would leak until someone
  -- remembered to subtract it.
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
    -- Care envelope shown on public cards
    'careLevel',        l.data_obj -> 'careLevel',
    'minTemp',          l.data_obj -> 'minTemp',
    'maxTemp',          l.data_obj -> 'maxTemp',
    'minPh',            l.data_obj -> 'minPh',
    'maxPh',            l.data_obj -> 'maxPh',
    -- Card imagery
    'photoUrl',         l.data_obj -> 'photoUrl'
  ) as data
from normalized l
left join public.profiles p
  on lower(p.wallet_address) = lower(l.seller_address);

comment on view public.aquadex_listings_public is
  'Display-safe projection of aquadex_listings for anonymous browsing (Fish Finder T14). Rebuilds the data blob from an explicit allowlist so new listing fields are never public by default. Mirrors PUBLIC_LISTING_DATA_FIELDS in frontend/src/services/publicListingProjection.js.';

-- Read-only access for browser roles. No write grants: writes continue to go to
-- the base table through the existing listings_*_own / _own_jwt policies.
grant select on public.aquadex_listings_public to anon, authenticated;
