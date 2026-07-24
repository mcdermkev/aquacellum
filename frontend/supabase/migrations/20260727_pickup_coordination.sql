-- ============================================================================
-- Local Pickup Coordination (Task 25, Tier B/Sonnet build, mandatory Opus
-- review gate before "done" — see docs/TASK_25_PICKUP_COORDINATION_SPEC.md §8)
--
-- Backs the pure core in frontend/src/services/pickupCoordination.js
-- (validatePickupLocationDraft/resolveAvailableSlots/validateProposedTime/
-- arrangementStatusView) and the new ?action=pickup-locations /
-- pickup-for-order / pickup-arrange / pickup-confirm routes on
-- frontend/api/storefront-detail.js. Reuses the shared
-- touch_canonical_order_updated_at() trigger function from
-- 20260720_canonical_commerce.sql rather than defining a new one, matching
-- the house style established by 20260723_store_sections.sql /
-- 20260724_promotions.sql.
--
-- GUARDRAIL 1 (spec §0.1): neither table below ever holds inventory or
-- changes an order's payment/escrow/settlement state. The prepaid-pickup
-- order already committed money via the existing Stripe-held-payment path
-- (unchanged by this feature) — pickup_locations/pickup_arrangements are
-- pure logistics metadata: where and when the already-paid handoff happens.
-- No code path in this migration or its API layer may write to `orders`,
-- `canonical_orders`, `fiat_settlements`, or any inventory/reservation
-- table.
--
-- RLS DESIGN NOTE (deliberate contrast with store_sections' public-read
-- policy): pickup_locations is service-role-only for BOTH read AND write —
-- NOT public-read. Exact coordinates must only be revealed post-purchase to
-- the buyer/seller on that specific order (spec Guardrail 2); pre-purchase
-- discovery only ever sees the fuzzed radar (LocalBreederMap.jsx), which
-- never queries this table. All legitimate reads (the seller's own setup UI,
-- and the order-scoped buyer reveal) flow through the API, which enforces
-- session-derived wallet auth and the order-scoped reveal gate — so there is
-- no public/anon read policy to leak the real address.
-- ============================================================================

-- 1. PICKUP LOCATIONS ---------------------------------------------------------
-- Seller-owned public meet spots. Distinct from ShipFromSetup's PRIVATE
-- ship-from address (never exposed to buyers) — these are seller-chosen
-- PUBLIC meet spots, revealed to a buyer only after they've purchased a
-- prepaid-pickup order that resolves to one of them (via pickup_arrangements).
CREATE TABLE IF NOT EXISTS pickup_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  label TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address_text TEXT,
  notes TEXT,

  -- Array of availability windows the buyer schedules against. Shape (see
  -- pickupCoordination.js resolveAvailableSlots for the authoritative
  -- reader): { dow: 0-6 (recurring) | date: 'YYYY-MM-DD', start: 'HH:mm',
  -- end: 'HH:mm', tz: IANA }. Validated server-side by
  -- validatePickupLocationDraft before every write — this column accepts
  -- whatever already-validated JSON the API hands it.
  availability JSONB NOT NULL DEFAULT '[]',

  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_pickup_locations_label_len CHECK (char_length(label) <= 80),
  CONSTRAINT chk_pickup_locations_notes_len CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT chk_pickup_locations_lat CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  CONSTRAINT chk_pickup_locations_lng CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180))
);

CREATE INDEX IF NOT EXISTS idx_pickup_locations_wallet_sort
  ON pickup_locations(wallet_address, sort_order);

DROP TRIGGER IF EXISTS trg_touch_pickup_locations ON pickup_locations;
CREATE TRIGGER trg_touch_pickup_locations
  BEFORE UPDATE ON pickup_locations
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- 2. PICKUP ARRANGEMENTS -------------------------------------------------------
-- The coordination sidecar, keyed by order, never joined into settlement
-- (Guardrail 1). `order_ref` is the canonical `orders.id` (uuid, as text) —
-- the API resolves whatever identity the buyer surface passes (orderId or
-- a legacy ref like local_key/stripe_session_id) down to this one stable
-- value before reading/writing here, so every arrangement row always keys
-- off the same identity regardless of which order shape called it.
CREATE TABLE IF NOT EXISTS pickup_arrangements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref TEXT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  pickup_location_id UUID REFERENCES pickup_locations(id) ON DELETE SET NULL,

  proposed_time TIMESTAMPTZ,
  confirmed_time TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN (
    'none', 'proposed', 'confirmed', 'completed', 'cancelled'
  )),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_arrangements_order  ON pickup_arrangements(order_ref);
CREATE INDEX IF NOT EXISTS idx_pickup_arrangements_buyer  ON pickup_arrangements(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_pickup_arrangements_seller ON pickup_arrangements(seller_wallet);

-- One arrangement per order — arrange/confirm both upsert this single row
-- rather than accumulating a history (v1 has no slot-locking/cancellation
-- state machine beyond `cancelled`, per spec §7 out-of-scope).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pickup_arrangements_order_ref
  ON pickup_arrangements(order_ref);

DROP TRIGGER IF EXISTS trg_touch_pickup_arrangements ON pickup_arrangements;
CREATE TRIGGER trg_touch_pickup_arrangements
  BEFORE UPDATE ON pickup_arrangements
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- 3. ROW LEVEL SECURITY -------------------------------------------------------
-- Service-role only for BOTH tables, both read and write (see RLS design
-- note above) — the API enforces session-derived wallet auth and the
-- order-scoped reveal gate; there is no public/anon policy on either table.
ALTER TABLE pickup_locations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_arrangements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on pickup_locations"
  ON pickup_locations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role full access on pickup_arrangements"
  ON pickup_arrangements FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Done! pickup_locations / pickup_arrangements are ready for the
-- ?action=pickup-locations / pickup-for-order / pickup-arrange /
-- pickup-confirm API routes.
-- ============================================================================
