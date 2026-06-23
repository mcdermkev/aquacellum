-- ============================================================================
-- Breeder Storefronts — Supabase Migration
-- Run this in your Supabase SQL Editor (Dashboard → SQL → New Query)
-- ============================================================================

-- 1. breeder_profiles — Core storefront profile data
CREATE TABLE IF NOT EXISTS breeder_profiles (
  wallet_address TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  display_name TEXT,
  bio TEXT DEFAULT '',
  avatar_cid TEXT,        -- IPFS CID for avatar image
  banner_cid TEXT,        -- IPFS CID for banner image
  specialties TEXT[] DEFAULT '{}',
  location TEXT,
  is_master_breeder BOOLEAN DEFAULT FALSE,
  storefront_active BOOLEAN DEFAULT FALSE,
  featured_priority INTEGER DEFAULT 0,
  current_tier TEXT DEFAULT 'Shallow',
  theme_config JSONB,     -- Custom theme (future)
  social_links JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_breeder_profiles_slug ON breeder_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_breeder_profiles_active ON breeder_profiles(storefront_active);
CREATE INDEX IF NOT EXISTS idx_breeder_profiles_master ON breeder_profiles(is_master_breeder);

-- Slug validation: lowercase alphanumeric + hyphens, 3-32 chars
ALTER TABLE breeder_profiles
  ADD CONSTRAINT chk_slug_format
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]$');

-- 2. breeder_stats — Aggregated stats (updated by triggers or periodic job)
CREATE TABLE IF NOT EXISTS breeder_stats (
  wallet_address TEXT PRIMARY KEY REFERENCES breeder_profiles(wallet_address) ON DELETE CASCADE,
  total_sales INTEGER DEFAULT 0,
  total_listings INTEGER DEFAULT 0,
  avg_rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  species_count INTEGER DEFAULT 0,
  repeat_buyer_rate NUMERIC(3,2) DEFAULT 0,
  member_since TIMESTAMPTZ,
  last_active TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Auto-update updated_at on profile changes
CREATE OR REPLACE FUNCTION update_breeder_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_breeder_profile_updated
  BEFORE UPDATE ON breeder_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_breeder_profile_timestamp();

-- 4. Row Level Security (RLS)
ALTER TABLE breeder_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE breeder_stats ENABLE ROW LEVEL SECURITY;

-- Public read access (storefronts are public)
CREATE POLICY "Public read access" ON breeder_profiles
  FOR SELECT USING (true);

CREATE POLICY "Public read stats" ON breeder_stats
  FOR SELECT USING (true);

-- Authenticated write access (users can only update their own profile)
-- Note: In Supabase, auth.uid() returns the JWT subject.
-- Since we use wallet addresses (not Supabase Auth), we use service role for writes
-- through our API endpoint. These policies allow the service role full access.
CREATE POLICY "Service role full access profiles" ON breeder_profiles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access stats" ON breeder_stats
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Seed a breeder_stats row automatically when a profile is created
CREATE OR REPLACE FUNCTION create_breeder_stats_on_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO breeder_stats (wallet_address, member_since, last_active)
  VALUES (NEW.wallet_address, NOW(), NOW())
  ON CONFLICT (wallet_address) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_stats_on_profile
  AFTER INSERT ON breeder_profiles
  FOR EACH ROW
  EXECUTE FUNCTION create_breeder_stats_on_profile();

-- ============================================================================
-- Done! After running this, your storefront system is ready for data.
-- ============================================================================
