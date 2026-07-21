-- ============================================================================
-- Packing capacity + packing profiles (Task 11)
--
-- Replaces the flat "fixed box slots" cap (on-chain MAX_BATCH_CHECKOUT_SIZE = 6)
-- with seller-controlled parcel capacity, and gives each listing a packing
-- profile. Additive only — extends existing tables with nullable columns so
-- current rows keep working (the packing engine applies sane defaults when a
-- field is null). See docs/MARKETPLACE_IMPLEMENTATION_PLAN.md Task 11.
--
-- Field semantics consumed by frontend/src/services/packingEngine.js.
-- ============================================================================

-- 1. Extend seller parcel presets with usable capacity (distinct from the
--    existing total-parcel weight_oz, which includes fish + water + pack + box).
ALTER TABLE seller_parcel_presets
  ADD COLUMN IF NOT EXISTS usable_weight_oz     NUMERIC,  -- livestock payload weight the box can carry
  ADD COLUMN IF NOT EXISTS max_bags             INTEGER,  -- how many bags fit in this box
  ADD COLUMN IF NOT EXISTS usable_volume_in3    NUMERIC,  -- interior volume available for bags
  ADD COLUMN IF NOT EXISTS thermal_pack_space_in3 NUMERIC, -- volume reserved for heat/cold packs
  ADD COLUMN IF NOT EXISTS max_livestock        INTEGER,  -- hard cap on specimens per box (seller override)
  ADD COLUMN IF NOT EXISTS separation_rules     JSONB NOT NULL DEFAULT '{}'; -- seller co-bagging overrides

-- 2. Give each listing a packing profile (bag count, packed weight, volume,
--    thermal-pack requirement, max-per-bag, separation flag). Stored as JSONB
--    so the seller can override the species-derived defaults per listing.
--    aquadex_listings is the primary listing store (root supabase migration).
ALTER TABLE aquadex_listings
  ADD COLUMN IF NOT EXISTS packing_profile JSONB;

-- Shape of packing_profile (all optional; engine fills defaults):
-- {
--   "bagCount": 1,
--   "packedWeightOz": 20,
--   "volumeIn3": 120,
--   "requiresThermalPack": true,
--   "maxPerBag": 4,
--   "separationRequired": false   -- true => this species must ship in its own bag(s)
-- }

COMMENT ON COLUMN aquadex_listings.packing_profile IS
  'Per-listing packing profile (Task 11). Null => packingEngine derives defaults from species size/temperament.';
