-- ============================================================================
-- ShipEngine Shipping — buyer-paid live rates + in-app label purchase
-- ----------------------------------------------------------------------------
-- Adds the pieces the ShipEngine integration needs:
--   1. seller_ship_from        — each seller's PRIVATE pickup/origin address.
--   2. seller_parcel_presets   — reusable insulated-box presets per seller.
--   3. orders.shipengine_*     — label / shipment / rate references + service.
--
-- Model: shipping is rated at CHECKOUT from the seller's origin to the buyer's
-- destination (distance-fair, buyer-paid). The seller later buys the label
-- in-app; the returned tracking number auto-populates the dispatch.
--
-- PRIVACY: seller_ship_from holds the precise pickup address. It is NEVER
-- exposed to buyers or the public. The marketplace's fuzzed/public facility
-- location lives elsewhere; this table is read only server-side (service role)
-- to rate shipments and buy labels.
-- ============================================================================

-- 1. SELLER SHIP-FROM ADDRESSES ---------------------------------------------
CREATE TABLE IF NOT EXISTS seller_ship_from (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,

  -- Contact + address (ShipEngine ship_from shape)
  name TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city_locality TEXT NOT NULL,
  state_province TEXT NOT NULL,   -- 2-letter US state code
  postal_code TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'US',
  address_residential_indicator TEXT DEFAULT 'unknown'
    CHECK (address_residential_indicator IN ('yes', 'no', 'unknown')),

  -- Once ShipEngine confirms the address is deliverable we cache the verdict
  -- so we don't re-validate on every checkout.
  is_validated BOOLEAN DEFAULT FALSE,
  validated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ship_from_wallet ON seller_ship_from(wallet_address);

-- 2. SELLER PARCEL PRESETS ---------------------------------------------------
-- Standard insulated live-fish boxes so rating is one click, not data entry.
-- Weight includes the estimated fish + water + heat/cold pack + box.
CREATE TABLE IF NOT EXISTS seller_parcel_presets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  label TEXT NOT NULL,               -- e.g. "Small breather bag", "Medium insulated"
  weight_oz NUMERIC NOT NULL,        -- total parcel weight in ounces
  length_in NUMERIC NOT NULL,
  width_in NUMERIC NOT NULL,
  height_in NUMERIC NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (wallet_address, label)
);

CREATE INDEX IF NOT EXISTS idx_parcel_presets_wallet ON seller_parcel_presets(wallet_address);

-- 3. ORDERS — ShipEngine references ------------------------------------------
-- The orders table (20260701_orders.sql) already carries tracking_number,
-- carrier, dispatch_timestamp, estimated_delivery, and arrival_status. These
-- columns tie an order to the specific ShipEngine shipment + purchased label
-- and record which service the buyer paid for (so the seller's later label
-- buy matches the quote).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipengine_shipment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipengine_label_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipengine_rate_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_service_code TEXT;   -- e.g. usps_priority_mail_express
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_carrier_id TEXT;      -- ShipEngine carrier_id used for the quote
ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_url TEXT;            -- downloadable label (pdf href)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_quote_cents INTEGER; -- what the buyer paid for shipping
ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_cost_cents INTEGER;     -- what the label actually cost

CREATE INDEX IF NOT EXISTS idx_orders_shipengine_label
  ON orders(shipengine_label_id) WHERE shipengine_label_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tracking
  ON orders(tracking_number) WHERE tracking_number IS NOT NULL;

-- 4. ROW LEVEL SECURITY ------------------------------------------------------
ALTER TABLE seller_ship_from ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_parcel_presets ENABLE ROW LEVEL SECURITY;

-- Origin addresses are sensitive: ONLY the service role (Vercel functions) may
-- read/write. Never expose to anon/public. The seller edits their address via
-- an authenticated API route that uses the service key.
CREATE POLICY "Service role full access on seller_ship_from"
  ON seller_ship_from FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on seller_parcel_presets"
  ON seller_parcel_presets FOR ALL
  USING (auth.role() = 'service_role');

-- A seller MAY read their own parcel presets (non-sensitive) via the JWT bridge.
CREATE POLICY "Sellers can read own parcel presets"
  ON seller_parcel_presets FOR SELECT
  USING (
    wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
  );

-- 5. UPDATED_AT TRIGGER (reuses update_updated_at_column from stripe migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_seller_ship_from_updated_at ON seller_ship_from;
CREATE TRIGGER update_seller_ship_from_updated_at
  BEFORE UPDATE ON seller_ship_from
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
