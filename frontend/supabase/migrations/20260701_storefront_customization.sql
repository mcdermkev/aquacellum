-- ============================================================================
-- Storefront Customization — Self-service branding + store policies
-- Adds full-URL image columns (avatar/banner) and seller-defined policies
-- (shipping, dead-on-arrival, in-person handshake) to breeder_profiles.
--
-- Note on storage: the app uploads images to Supabase Storage (bucket
-- `reef-media`) and stores the resulting PUBLIC URL — not an IPFS CID. The
-- original avatar_cid/banner_cid columns are retained for backward compat,
-- but avatar_url/banner_url are now the source of truth. The API/normalizer
-- prefer the URL columns and fall back to the CID (via the Pinata gateway).
--
-- Run this in your Supabase SQL Editor (Dashboard → SQL → New Query).
-- ============================================================================

ALTER TABLE breeder_profiles
  ADD COLUMN IF NOT EXISTS avatar_url       TEXT,  -- full public URL (pulled from app profile)
  ADD COLUMN IF NOT EXISTS banner_url       TEXT,  -- full public URL (uploaded banner/background)
  ADD COLUMN IF NOT EXISTS shipping_policy  TEXT,  -- how the breeder ships (methods, days, live arrival)
  ADD COLUMN IF NOT EXISTS doa_policy       TEXT,  -- dead-on-arrival guarantee / claim window
  ADD COLUMN IF NOT EXISTS handshake_policy TEXT;  -- in-person / local pickup meetup rules

-- Keep the policy fields to a sane length (defense in depth; API also validates).
ALTER TABLE breeder_profiles
  ADD CONSTRAINT chk_shipping_policy_len  CHECK (shipping_policy  IS NULL OR char_length(shipping_policy)  <= 1500),
  ADD CONSTRAINT chk_doa_policy_len       CHECK (doa_policy       IS NULL OR char_length(doa_policy)       <= 1500),
  ADD CONSTRAINT chk_handshake_policy_len CHECK (handshake_policy IS NULL OR char_length(handshake_policy) <= 1500);

-- ============================================================================
-- Done! breeder_profiles now supports self-service branding and store policies.
-- ============================================================================
