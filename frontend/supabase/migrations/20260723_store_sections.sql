-- ============================================================================
-- Store sections — Featured collections & customizable storefront layout
-- (Task 21A, Tier B/Sonnet, no Opus review gate)
--
-- Gives sellers control over how their storefront is arranged: featured
-- listings, named collections, and toggleable custom sections. Backs the
-- pure core in frontend/src/services/storeMerchandising.js
-- (assembleStorefrontLayout/normalizeSection/validateSectionDraft) and the
-- new `?action=sections` route on frontend/api/storefront-detail.js.
--
-- Alternative considered: a structured `theme_config.sections` JSONB column
-- on breeder_profiles (that column already exists, unused, as "Custom theme
-- (future)"). Rejected in favor of a dedicated table — a table gives
-- per-section ordering/indexing via a real column and an index, and keeps
-- the profile row small as sellers add sections over time.
--
-- ADDITIVE + CLEAN-SLATE, matching the canonical-commerce migrations: new
-- table only, reuses the shared touch_canonical_order_updated_at() trigger
-- function from 20260720_canonical_commerce.sql rather than defining a new
-- one, and uses real service-role RLS for writes (not the older
-- USING(true)/WITH CHECK(true) pattern from the original breeder_profiles
-- migration). Reads are public — storefronts are public, mirroring
-- breeder_profiles' own "Public read access" policy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  type TEXT NOT NULL CHECK (type IN ('featured', 'collection', 'custom')),
  title TEXT,

  -- Ordered array of getListingKey() strings (e.g. "batch-12" / "single-45"),
  -- not raw numeric ids — see storeMerchandising.js header for why.
  listing_refs JSONB NOT NULL DEFAULT '[]',

  sort_order INT NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_store_sections_title_len CHECK (title IS NULL OR char_length(title) <= 60)
);

CREATE INDEX IF NOT EXISTS idx_store_sections_wallet_sort
  ON store_sections(wallet_address, sort_order);

-- Reuse the shared trigger function defined in 20260720_canonical_commerce.sql.
DROP TRIGGER IF EXISTS trg_touch_store_sections ON store_sections;
CREATE TRIGGER trg_touch_store_sections
  BEFORE UPDATE ON store_sections
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- Row Level Security -----------------------------------------------------
ALTER TABLE store_sections ENABLE ROW LEVEL SECURITY;

-- Public read (storefronts are public).
CREATE POLICY "public read access on store_sections"
  ON store_sections FOR SELECT USING (true);

-- Service-role write only — the API authorizes the owner wallet from the
-- verified Privy session token (never the request body) before writing.
CREATE POLICY "service_role full access on store_sections"
  ON store_sections FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Done! store_sections is ready for the ?action=sections API route.
-- ============================================================================
