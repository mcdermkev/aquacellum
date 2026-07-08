-- ============================================================================
-- Shipping margin ledger + analytics
-- ----------------------------------------------------------------------------
-- The platform buys every shipping label centrally (postage drawn from its
-- ShipEngine balance) and keeps the buyer's shipping payment. Each buyer quote
-- is (carrier rate + flat handling fee), so the platform makes the handling fee
-- on every shipment, plus/minus any rate drift between quote and label buy.
--
-- This ledger records one row per label purchased (written by
-- /api/stripe?action=ship-label), independent of the order-sync layer, so
-- shipping P&L is always reconcilable:
--   buyer_shipping_cents  — what the buyer paid for shipping (carrier + handling)
--   label_cost_cents      — actual postage the platform paid
--   handling_fee_cents    — the INTENDED platform margin (e.g. 200 = $2)
--   margin_cents          — REALIZED margin = buyer_shipping_cents - label_cost_cents
-- Realized vs intended diverge only when the carrier rate moved between the
-- checkout quote and the label purchase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipping_label_purchases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID,                       -- FK-ish to orders.id (nullable; ledger is authoritative on its own)
  seller_wallet TEXT NOT NULL,
  token_id BIGINT,
  stripe_payment_intent TEXT,
  carrier TEXT,                        -- 'usps' | 'ups' | 'fedex' | 'other'
  service_code TEXT,
  shipengine_label_id TEXT,
  tracking_number TEXT,
  buyer_shipping_cents INTEGER,        -- what the buyer paid for shipping
  label_cost_cents INTEGER,            -- actual postage paid by the platform
  handling_fee_cents INTEGER,          -- intended platform margin (flat)
  margin_cents INTEGER,                -- realized margin = buyer_shipping - label_cost
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ship_labels_seller ON shipping_label_purchases(seller_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ship_labels_created ON shipping_label_purchases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ship_labels_tracking ON shipping_label_purchases(tracking_number) WHERE tracking_number IS NOT NULL;

-- Service role only (written + read by Vercel functions / platform dashboards).
ALTER TABLE shipping_label_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on shipping_label_purchases"
  ON shipping_label_purchases FOR ALL
  USING (auth.role() = 'service_role');

-- ── Platform shipping P&L, rolled up by month ──────────────────────────────
CREATE OR REPLACE VIEW shipping_margin_analytics AS
SELECT
  date_trunc('month', created_at)                              AS month,
  COUNT(*)                                                     AS labels_bought,
  COALESCE(SUM(buyer_shipping_cents), 0)                       AS shipping_collected_cents,
  COALESCE(SUM(label_cost_cents), 0)                           AS postage_paid_cents,
  COALESCE(SUM(handling_fee_cents), 0)                         AS intended_margin_cents,
  COALESCE(SUM(margin_cents), 0)                               AS realized_margin_cents,
  COALESCE(ROUND(AVG(margin_cents)), 0)                        AS avg_margin_per_shipment_cents
FROM shipping_label_purchases
GROUP BY date_trunc('month', created_at)
ORDER BY month DESC;

-- ── All-time platform shipping totals (single row) ─────────────────────────
CREATE OR REPLACE VIEW shipping_margin_totals AS
SELECT
  COUNT(*)                                                     AS labels_bought,
  COALESCE(SUM(buyer_shipping_cents), 0)                       AS shipping_collected_cents,
  COALESCE(SUM(label_cost_cents), 0)                           AS postage_paid_cents,
  COALESCE(SUM(handling_fee_cents), 0)                         AS intended_margin_cents,
  COALESCE(SUM(margin_cents), 0)                               AS realized_margin_cents,
  COALESCE(ROUND(AVG(margin_cents)), 0)                        AS avg_margin_per_shipment_cents
FROM shipping_label_purchases;
