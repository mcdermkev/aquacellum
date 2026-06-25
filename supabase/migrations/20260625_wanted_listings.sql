-- ============================================================================
-- Migration: Wanted Listings (Marketplace "Looking For" Board)
--
-- Lets users post species they want to buy. Creates demand signals even when
-- marketplace inventory is thin (common during early beta with small user base).
--
-- Columns:
--   id            — UUID primary key
--   wallet_address — poster's wallet (FK to profiles)
--   species_name  — what they're looking for (free text, may match catalog)
--   species_id    — optional link to catalog species (for auto-matching)
--   max_price_eth — max they'd pay (optional, in ETH)
--   notes         — free text (e.g. "looking for a breeding pair", "juvenile only")
--   is_active     — soft delete (user can mark as fulfilled)
--   created_at    — when posted
--   fulfilled_at  — when marked as found
-- ============================================================================

CREATE TABLE IF NOT EXISTS wanted_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  species_name TEXT NOT NULL,
  species_id INTEGER,
  max_price_eth TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wanted_active ON wanted_listings(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wanted_wallet ON wanted_listings(wallet_address, is_active);
CREATE INDEX IF NOT EXISTS idx_wanted_species ON wanted_listings(species_id) WHERE species_id IS NOT NULL;

-- RLS
ALTER TABLE wanted_listings ENABLE ROW LEVEL SECURITY;

-- Anyone can read active wanted listings (browsing)
CREATE POLICY "wanted_select_public"
  ON wanted_listings FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Users can read their own (including inactive)
CREATE POLICY "wanted_select_own"
  ON wanted_listings FOR SELECT
  TO authenticated
  USING (wallet_address = lower(auth.jwt()->>'wallet_address'));

-- Only authenticated users can insert their own
CREATE POLICY "wanted_insert_own"
  ON wanted_listings FOR INSERT
  TO authenticated
  WITH CHECK (wallet_address = lower(auth.jwt()->>'wallet_address'));

-- Only owner can update (mark fulfilled, edit)
CREATE POLICY "wanted_update_own"
  ON wanted_listings FOR UPDATE
  TO authenticated
  USING (wallet_address = lower(auth.jwt()->>'wallet_address'));

-- Only owner can delete
CREATE POLICY "wanted_delete_own"
  ON wanted_listings FOR DELETE
  TO authenticated
  USING (wallet_address = lower(auth.jwt()->>'wallet_address'));

-- Anon fallback for header-based auth (pre-JWT-bridge clients)
CREATE POLICY "wanted_insert_anon"
  ON wanted_listings FOR INSERT
  TO anon
  WITH CHECK (
    wallet_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

CREATE POLICY "wanted_update_anon"
  ON wanted_listings FOR UPDATE
  TO anon
  USING (
    wallet_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

CREATE POLICY "wanted_delete_anon"
  ON wanted_listings FOR DELETE
  TO anon
  USING (
    wallet_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );
