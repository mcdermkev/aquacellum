-- ============================================================================
-- Canonical commerce schema (Tasks 1/3/4/5 wiring)
--
-- Introduces the single canonical order model that the marketplace state
-- machine, authorization boundary, payment ledger, and settlement coordinator
-- operate on. See docs/MARKETPLACE_STATE_MODEL.md.
--
-- ADDITIVE + CLEAN-SLATE: these are NEW tables alongside the legacy `orders` /
-- `fiat_settlements` tables; nothing is dropped here. Per the beta data posture
-- (plan Task 23), legacy rows are disposable test-money records and are NOT
-- migrated in place — the canonical tables start empty and are populated by the
-- new order service going forward. Legacy tables are removed at the pre-mainnet
-- cutover, not here.
--
-- CHECK constraints mirror the enums in:
--   frontend/src/services/marketplaceStateMachine.js  (states, methods, line items)
--   frontend/src/services/paymentLedger.js            (ledger entry types)
-- Keep them in sync.
-- ============================================================================

-- 1. CANONICAL ORDERS ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Participants (identity per docs §8; buyer resolved by Privy DID or wallet).
  buyer_user_id TEXT,          -- Privy DID captured at checkout (nullable for guests)
  buyer_wallet  TEXT,
  seller_wallet TEXT NOT NULL,

  -- Fulfillment method (marketplaceStateMachine FULFILLMENT_METHODS).
  method TEXT NOT NULL CHECK (method IN (
    'shipping', 'courier', 'prepaid_pickup', 'cash_pickup'
  )),

  -- Canonical order-level state (marketplaceStateMachine ORDER_STATES).
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN (
    'created', 'payment_pending', 'payment_protected', 'preparing',
    'in_transit', 'pickup_ready', 'delivered', 'review_window', 'non_delivery',
    'handoff_confirmed', 'claim_open', 'partially_resolved',
    'certificate_transferred', 'seller_paid', 'completed', 'refunded',
    'cancelled', 'reconciliation'
  )),

  -- Money (integer USD cents; see paymentLedger).
  seller_proceeds_cents INTEGER NOT NULL DEFAULT 0,
  gross_charged_cents   INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',

  -- Settlement / idempotency anchors.
  stripe_payment_intent TEXT,
  stripe_payment_hash   TEXT,   -- keccak256(paymentIntentId), on-chain idempotency
  handoff_challenge_id  TEXT,   -- signed one-time pickup/cash handoff challenge
  certificate_ref       TEXT,   -- recorded when the birth certificate transfers

  -- Trust flags.
  has_open_claim BOOLEAN NOT NULL DEFAULT FALSE,

  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One canonical order per Stripe PaymentIntent.
  CONSTRAINT uq_canonical_orders_pi UNIQUE (stripe_payment_intent)
);

CREATE INDEX IF NOT EXISTS idx_canonical_orders_buyer  ON canonical_orders(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_canonical_orders_seller ON canonical_orders(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_canonical_orders_state  ON canonical_orders(state);

-- 2. LINE ITEMS ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES canonical_orders(id) ON DELETE CASCADE,

  token_id BIGINT,             -- on-chain specimen id, when applicable
  listing_id TEXT,
  common_name TEXT,
  scientific_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,

  -- Per-item resolution (marketplaceStateMachine LINE_ITEM_STATES).
  line_state TEXT NOT NULL DEFAULT 'pending' CHECK (line_state IN (
    'pending', 'healthy', 'doa_claimed', 'refunded',
    'replacement_pending', 'replaced', 'denied'
  )),

  -- A replacement resolution links to its own (sub-)order (plan Task 17).
  replacement_suborder_id UUID REFERENCES canonical_orders(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_line_items_order ON canonical_order_line_items(order_id);

-- 3. LEDGER ENTRIES -----------------------------------------------------------
-- Append-only money/certificate events folded by paymentLedger.reduceLedger.
-- The (order_id, entry_type, entry_id) uniqueness enforces webhook-replay
-- de-duplication at the database level, matching the reducer's dedupe.
CREATE TABLE IF NOT EXISTS canonical_order_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES canonical_orders(id) ON DELETE CASCADE,

  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'charge_captured', 'refund',
    'transfer_initiated', 'transfer_succeeded', 'transfer_failed',
    'dispute_opened', 'dispute_won', 'dispute_lost', 'cancelled',
    'certificate_transferred'
  )),
  entry_id TEXT,               -- idempotency key within (order, type)
  amount_cents INTEGER NOT NULL DEFAULT 0,
  seller_portion_cents INTEGER,
  transfer_id TEXT,
  ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_canonical_ledger_dedupe UNIQUE (order_id, entry_type, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_ledger_order ON canonical_order_ledger(order_id);

-- 4. TRANSITION AUDIT + TRANSITION IDEMPOTENCY --------------------------------
-- Every state transition is recorded. (order_id, idempotency_key) uniqueness
-- makes replaying the same transition a no-op (a duplicate insert is rejected
-- and the order service treats it as already-applied).
CREATE TABLE IF NOT EXISTS canonical_order_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES canonical_orders(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_role TEXT,             -- buyer | seller | curator | operator | system
  actor_id TEXT,               -- Privy DID / wallet / service identifier
  idempotency_key TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_canonical_transition_idem UNIQUE (order_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_transitions_order ON canonical_order_transitions(order_id);

-- keep canonical_orders.updated_at fresh
CREATE OR REPLACE FUNCTION touch_canonical_order_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_canonical_orders ON canonical_orders;
CREATE TRIGGER trg_touch_canonical_orders
  BEFORE UPDATE ON canonical_orders
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- 5. ROW LEVEL SECURITY -------------------------------------------------------
-- Writes are service-role only (the Vercel order service). Buyers/sellers may
-- read their own orders; ledger/transition detail stays server-side.
ALTER TABLE canonical_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_order_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_order_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on canonical_orders"
  ON canonical_orders FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role full access on canonical_line_items"
  ON canonical_order_line_items FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role full access on canonical_ledger"
  ON canonical_order_ledger FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role full access on canonical_transitions"
  ON canonical_order_transitions FOR ALL USING (auth.role() = 'service_role');

-- Buyers/sellers read their own orders (wallet claim from the Privy→Supabase JWT bridge).
CREATE POLICY "owners can read their canonical orders"
  ON canonical_orders FOR SELECT
  USING (
    buyer_wallet  = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    OR seller_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address'
  );
