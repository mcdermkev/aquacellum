-- ============================================================================
-- Seller promotions — codes + automatic discounts (Task 21B, Tier B/Sonnet)
--
-- Backs the pure engine in frontend/src/services/promotionEngine.js
-- (evaluatePromotion/bestPromotion) and the seller authoring CRUD folded into
-- frontend/api/storefront-detail.js (?action=promotions).
--
-- IMPORTANT — money boundary (see docs/TASK_21B_PROMOTIONS_SPEC.md): this
-- migration and everything built against it in this commit is presentation +
-- authoring only. Nothing here applies a discount to a real charge —
-- `used_count` is never incremented by this table's own writes, and no
-- trigger touches `orders`/`canonical_orders`/Stripe. Wiring a promotion into
-- the actual checkout charge (frontend/api/stripe.js handleCreateCheckout) is
-- a separately-reviewed Tier A/Opus change.
--
-- `funding` is mandatory and load-bearing: 'seller_funded' will (in the Tier A
-- checkout step) reduce the goods total and therefore the platform-fee base
-- and seller proceeds; 'platform_funded' will reduce only the buyer's total
-- without touching seller payout. Both are just data here — this migration
-- makes no payment decision.
--
-- ADDITIVE + CLEAN-SLATE, matching the canonical-commerce migration style:
-- reuses the shared touch_canonical_order_updated_at() trigger function
-- rather than defining a new one. Reads are NOT public (promo codes should
-- not be publicly enumerable) — the authoring API is seller-scoped and
-- session-authed; a future checkout-time lookup step (Tier A) will need its
-- own authorized read path, not a public RLS policy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS seller_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  -- NULL code = automatic promotion (applies without a buyer-entered code).
  code TEXT,

  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  -- bps (basis points, 0-10000) for 'percent'; integer USD cents for 'fixed'.
  value INT NOT NULL CHECK (value >= 0),

  scope TEXT NOT NULL CHECK (scope IN ('store', 'collection', 'listing')),
  -- Ordered array of scope-target refs: store_sections.id strings for
  -- 'collection' scope, getListingKey() strings for 'listing' scope; empty/
  -- ignored for 'store' scope (applies to the whole cart).
  scope_refs JSONB NOT NULL DEFAULT '[]',

  min_subtotal_cents INT NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),

  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,

  usage_limit INT CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),

  -- Whose money the discount comes from — see header. Mandatory.
  funding TEXT NOT NULL CHECK (funding IN ('seller_funded', 'platform_funded')),

  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_promotions_window CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

-- One active code per seller (case-insensitive), only enforced when a code
-- is actually set — automatic (code IS NULL) promotions are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_promotions_wallet_code
  ON seller_promotions(wallet_address, lower(code))
  WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_promotions_wallet
  ON seller_promotions(wallet_address, active);

-- Reuse the shared trigger function defined in 20260720_canonical_commerce.sql.
DROP TRIGGER IF EXISTS trg_touch_seller_promotions ON seller_promotions;
CREATE TRIGGER trg_touch_seller_promotions
  BEFORE UPDATE ON seller_promotions
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- Row Level Security -----------------------------------------------------
ALTER TABLE seller_promotions ENABLE ROW LEVEL SECURITY;

-- Service-role only — no public read policy. Promo codes are not publicly
-- enumerable; the seller-scoped, session-authed API (?action=promotions) is
-- the sole reader/writer for this beta. A future checkout-time validation
-- step (Tier A) reads through the service role too, not a public policy.
CREATE POLICY "service_role full access on seller_promotions"
  ON seller_promotions FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Done! seller_promotions is ready for the ?action=promotions API route.
-- ============================================================================
