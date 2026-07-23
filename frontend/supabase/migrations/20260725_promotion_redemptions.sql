-- ============================================================================
-- Promotion redemptions — idempotent usage tracking for applied discounts
-- (Task 21B, Tier A / Opus — the money-critical checkout wiring)
--
-- The Tier B commit (20260724_promotions.sql) deliberately left `used_count`
-- untouched by any write, because incrementing it is a checkout-time,
-- money-critical concern. This migration adds the mechanism the Tier A
-- checkout step uses to increment it EXACTLY ONCE per successful charge, safe
-- against Stripe webhook replay.
--
-- Design: a redemption row is inserted once per PaymentIntent (UNIQUE), and the
-- `used_count` bump happens in the SAME transaction as the insert, only when
-- the insert actually created a new row. A replayed webhook re-runs the RPC,
-- hits the unique constraint, inserts nothing, and increments nothing — so the
-- count can never double-count a single order. The redemption row also serves
-- as the durable record of WHICH promotion applied to an order (for receipts
-- and the seller's own reporting), keyed by the Stripe PaymentIntent.
--
-- This table/RPC never move money themselves — they record that a discount
-- (already computed by the pure promotionEngine and applied to the Stripe
-- charge in handleCreateCheckout) was consumed. The actual charge/payout math
-- lives in api/stripe.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES seller_promotions(id) ON DELETE CASCADE,

  -- One redemption per Stripe PaymentIntent — the idempotency key. A replayed
  -- payment_intent.succeeded webhook cannot create a second redemption or a
  -- second used_count increment for the same order.
  payment_intent_id TEXT NOT NULL UNIQUE,

  seller_wallet TEXT NOT NULL,
  buyer_wallet TEXT,

  -- The discount actually applied to the charge, and whose money funded it.
  -- Snapshotted here so receipts/reporting don't have to re-derive it from the
  -- (mutable) promotion row.
  discount_cents INT NOT NULL CHECK (discount_cents >= 0),
  funding TEXT NOT NULL CHECK (funding IN ('seller_funded', 'platform_funded')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promotion
  ON promotion_redemptions(promotion_id);

CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_seller
  ON promotion_redemptions(seller_wallet);

-- ─── Atomic, idempotent redeem RPC ──────────────────────────────────────────
-- Inserts the redemption row and bumps seller_promotions.used_count in one
-- transaction. Returns TRUE only when a NEW redemption was recorded (so the
-- caller knows the increment happened); FALSE on a replay (row already existed).
--
-- SECURITY DEFINER so it runs with the table owner's rights under the service
-- role; callers reach it only through the service-role key (same posture as
-- reserve_stock).
CREATE OR REPLACE FUNCTION redeem_promotion(
  p_promotion_id UUID,
  p_payment_intent TEXT,
  p_discount_cents INT,
  p_funding TEXT,
  p_seller_wallet TEXT,
  p_buyer_wallet TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO promotion_redemptions (
    promotion_id, payment_intent_id, seller_wallet, buyer_wallet, discount_cents, funding
  )
  VALUES (
    p_promotion_id, p_payment_intent, p_seller_wallet, p_buyer_wallet,
    GREATEST(p_discount_cents, 0), p_funding
  )
  ON CONFLICT (payment_intent_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    -- Only bump the count when we actually recorded a new redemption. The bump
    -- is unconditional on usage_limit here: the redemption is the source of
    -- truth for "this promo was used on a real, paid order", and the eval-time
    -- limit check in promotionEngine is the gate before checkout. Recording an
    -- accurate count matters more than re-enforcing the soft cap post-charge.
    UPDATE seller_promotions
       SET used_count = used_count + 1
     WHERE id = p_promotion_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Row Level Security -----------------------------------------------------
ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Service-role only — redemptions are written by the checkout webhook (service
-- role) and read by seller reporting through the seller-scoped, session-authed
-- API. No public/anon access.
CREATE POLICY "service_role full access on promotion_redemptions"
  ON promotion_redemptions FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Done! promotion_redemptions + redeem_promotion() back the Tier A checkout
-- discount wiring in frontend/api/stripe.js.
-- ============================================================================
