-- ============================================================================
-- Orders — Persistent marketplace order tracking
-- Stores all order types (shipping escrow, batch, fiat, cash handshake)
-- with full state machine, syncs across devices via Supabase Realtime.
-- ============================================================================

-- 1. ORDERS TABLE — Core order storage
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Order classification
  order_type TEXT NOT NULL CHECK (order_type IN (
    'shipping', 'batch', 'fiat', 'cash_handshake', 'instant'
  )),

  -- Participants
  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,

  -- Status state machine
  -- shipping: locked → dispatched → released | disputed → resolved_released | refunded
  -- batch: pending → released | refunded
  -- fiat: pending → settled | failed
  -- cash_handshake: pending → settled
  -- instant: completed
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'locked', 'dispatched', 'released', 'completed',
    'disputed', 'resolved_released', 'refunded', 'failed', 'settled'
  )),

  -- Financials (stored in USD cents for precision)
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  shipping_fee_cents INTEGER DEFAULT 0,
  platform_fee_cents INTEGER DEFAULT 0,
  tier_discount_cents INTEGER DEFAULT 0,
  credits_applied_cents INTEGER DEFAULT 0,
  total_paid_cents INTEGER NOT NULL DEFAULT 0,

  -- Items (JSON array of order line items)
  -- Each: { tokenId?, listingId?, commonName, scientificName?, quantity?, priceCents }
  items JSONB NOT NULL DEFAULT '[]',

  -- Shipping details
  tracking_number TEXT,
  dispatch_timestamp TIMESTAMPTZ,
  carrier TEXT, -- 'usps', 'ups', 'fedex', 'other'
  estimated_delivery TIMESTAMPTZ,

  -- Batch-specific
  quantity INTEGER,
  fulfillment_type TEXT CHECK (fulfillment_type IN ('shipping', 'in_person')),

  -- Fiat-specific (Stripe)
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,

  -- Cash handshake
  commitment_hash TEXT,

  -- Arrival flow
  arrival_status TEXT CHECK (arrival_status IN ('transit', 'arrived', 'acclimated')),
  arrived_at TIMESTAMPTZ,
  acclimation_notes TEXT,
  assigned_tank_id TEXT,

  -- Dispute / resolution
  dispute_reason TEXT,
  dispute_opened_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT, -- wallet of curator who resolved
  resolution_notes TEXT,

  -- XP earned from this order (for buyer and seller)
  buyer_xp_earned INTEGER DEFAULT 0,
  seller_xp_earned INTEGER DEFAULT 0,

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Local reference (maps to Dexie marketOrders.key for sync)
  local_key TEXT,
  -- On-chain reference
  tx_hash TEXT,
  on_chain_token_id INTEGER,
  on_chain_purchase_id INTEGER
);

-- 2. ORDER STATUS HISTORY — Audit trail for every state transition
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT, -- wallet address of who triggered the change
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ORDER WATCHLIST — Species price-drop alerts (XP-gated: Pelagic+)
CREATE TABLE IF NOT EXISTS order_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  species_id INTEGER,
  species_name TEXT NOT NULL,
  scientific_name TEXT,
  max_price_cents INTEGER, -- alert if listing drops below this
  is_active BOOLEAN DEFAULT true,
  last_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, species_name)
);

-- 4. INDEXES for efficient queries
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_type_status ON orders(order_type, status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_status ON orders(buyer_wallet, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON orders(seller_wallet, status);
CREATE INDEX IF NOT EXISTS idx_orders_local_key ON orders(local_key) WHERE local_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_stripe ON orders(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_arrival ON orders(buyer_wallet, arrival_status) WHERE arrival_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_status_history_order ON order_status_history(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_wallet ON order_watchlist(wallet_address, is_active);
CREATE INDEX IF NOT EXISTS idx_watchlist_species ON order_watchlist(species_name, is_active) WHERE is_active = true;

-- 5. ROW LEVEL SECURITY
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_watchlist ENABLE ROW LEVEL SECURITY;

-- Orders: buyer and seller can both read their own orders
CREATE POLICY "Users can read their own orders"
  ON orders FOR SELECT
  USING (
    buyer_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
    OR seller_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
  );

-- Orders: system (service role) can insert — orders are created server-side or via sync
CREATE POLICY "Service can insert orders"
  ON orders FOR INSERT
  WITH CHECK (true);

-- Orders: participants can update their own orders (status transitions)
CREATE POLICY "Participants can update orders"
  ON orders FOR UPDATE
  USING (
    buyer_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
    OR seller_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
  );

-- Status history: readable by order participants
CREATE POLICY "Users can read their order history"
  ON order_status_history FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders
      WHERE buyer_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
         OR seller_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
    )
  );

CREATE POLICY "Service can insert status history"
  ON order_status_history FOR INSERT
  WITH CHECK (true);

-- Watchlist: users manage their own
CREATE POLICY "Users can manage their watchlist"
  ON order_watchlist FOR ALL
  USING (wallet_address = current_setting('request.headers', true)::json->>'x-wallet-address');

-- 6. UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

-- 7. STATUS CHANGE TRIGGER — Auto-records history on every status transition
CREATE OR REPLACE FUNCTION record_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
    VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      current_setting('request.headers', true)::json->>'x-wallet-address',
      NEW.metadata->>'last_change_reason'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_status_history
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION record_order_status_change();

-- 8. ORDER ANALYTICS VIEW — Aggregated seller stats (XP-gated: Pelagic+)
CREATE OR REPLACE VIEW order_analytics AS
SELECT
  seller_wallet,
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE status IN ('released', 'completed', 'settled')) AS completed_orders,
  COUNT(*) FILTER (WHERE status = 'disputed') AS disputed_orders,
  COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_orders,
  COALESCE(SUM(total_paid_cents) FILTER (WHERE status IN ('released', 'completed', 'settled')), 0) AS total_revenue_cents,
  COALESCE(AVG(total_paid_cents) FILTER (WHERE status IN ('released', 'completed', 'settled')), 0)::INTEGER AS avg_order_value_cents,
  COALESCE(
    AVG(EXTRACT(EPOCH FROM (dispatch_timestamp - created_at)) / 3600)
    FILTER (WHERE dispatch_timestamp IS NOT NULL), 0
  )::INTEGER AS avg_dispatch_hours,
  COALESCE(
    AVG(EXTRACT(EPOCH FROM (arrived_at - dispatch_timestamp)) / 3600)
    FILTER (WHERE arrived_at IS NOT NULL AND dispatch_timestamp IS NOT NULL), 0
  )::INTEGER AS avg_delivery_hours,
  MIN(created_at) AS first_order_at,
  MAX(created_at) AS last_order_at
FROM orders
GROUP BY seller_wallet;

-- Buyer analytics view
CREATE OR REPLACE VIEW buyer_order_analytics AS
SELECT
  buyer_wallet,
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE status IN ('released', 'completed', 'settled')) AS completed_orders,
  COUNT(DISTINCT seller_wallet) AS unique_sellers,
  COALESCE(SUM(total_paid_cents) FILTER (WHERE status IN ('released', 'completed', 'settled')), 0) AS total_spent_cents,
  COALESCE(SUM(buyer_xp_earned), 0) AS total_xp_earned,
  COUNT(*) FILTER (WHERE order_type = 'shipping') AS shipping_orders,
  COUNT(*) FILTER (WHERE order_type = 'batch') AS batch_orders,
  COUNT(*) FILTER (WHERE order_type = 'cash_handshake') AS handshake_orders,
  MIN(created_at) AS first_order_at,
  MAX(created_at) AS last_order_at
FROM orders
GROUP BY buyer_wallet;

-- 9. HELPER: Upsert order from local sync
CREATE OR REPLACE FUNCTION upsert_order_from_sync(
  p_local_key TEXT,
  p_order_type TEXT,
  p_buyer_wallet TEXT,
  p_seller_wallet TEXT,
  p_status TEXT,
  p_subtotal_cents INTEGER,
  p_shipping_fee_cents INTEGER,
  p_total_paid_cents INTEGER,
  p_items JSONB,
  p_tracking_number TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT NULL,
  p_fulfillment_type TEXT DEFAULT NULL,
  p_stripe_session_id TEXT DEFAULT NULL,
  p_on_chain_token_id INTEGER DEFAULT NULL,
  p_on_chain_purchase_id INTEGER DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID AS $$
DECLARE
  v_order_id UUID;
BEGIN
  -- Try to find existing order by local_key
  SELECT id INTO v_order_id FROM orders WHERE local_key = p_local_key;

  IF v_order_id IS NOT NULL THEN
    -- Update existing — only advance status (never go backwards)
    UPDATE orders SET
      status = CASE
        WHEN p_status IN ('released', 'completed', 'settled', 'refunded', 'failed') THEN p_status
        WHEN status = 'pending' THEN p_status
        ELSE status
      END,
      tracking_number = COALESCE(p_tracking_number, tracking_number),
      updated_at = NOW()
    WHERE id = v_order_id;
  ELSE
    -- Insert new
    INSERT INTO orders (
      local_key, order_type, buyer_wallet, seller_wallet, status,
      subtotal_cents, shipping_fee_cents, total_paid_cents, items,
      tracking_number, quantity, fulfillment_type,
      stripe_session_id, on_chain_token_id, on_chain_purchase_id,
      created_at
    ) VALUES (
      p_local_key, p_order_type, p_buyer_wallet, p_seller_wallet, p_status,
      p_subtotal_cents, p_shipping_fee_cents, p_total_paid_cents, p_items,
      p_tracking_number, p_quantity, p_fulfillment_type,
      p_stripe_session_id, p_on_chain_token_id, p_on_chain_purchase_id,
      p_created_at
    )
    RETURNING id INTO v_order_id;
  END IF;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql;

-- 10. ENABLE REALTIME for orders table (live status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE orders;


-- 11. DATABASE WEBHOOK — Trigger order-notifications Edge Function on status changes.
-- This is configured in the Supabase Dashboard under Database > Webhooks, pointing to:
--   URL: {SUPABASE_URL}/functions/v1/order-notifications
--   Events: INSERT, UPDATE
--   Table: orders
--
-- If using pg_net (available on Supabase Pro+), you can automate via trigger:
CREATE OR REPLACE FUNCTION notify_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
BEGIN
  -- Only fire on INSERT or when status actually changed
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    v_payload := jsonb_build_object(
      'type', TG_OP,
      'table', 'orders',
      'record', to_jsonb(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
    );

    -- pg_net HTTP POST to Edge Function (non-blocking)
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/order-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := v_payload
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create the trigger if pg_net is available (Supabase Pro+)
-- On free tier, use the Dashboard webhook configuration instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    EXECUTE 'CREATE TRIGGER orders_notify_on_change
      AFTER INSERT OR UPDATE ON orders
      FOR EACH ROW
      EXECUTE FUNCTION notify_order_status_change()';
  END IF;
END $$;
