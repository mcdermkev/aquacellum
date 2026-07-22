-- ============================================================================
-- DOA claims + inventory reservations persistence (Tasks 13 & 17)
--
-- Backs the two pure cores that until now had no database:
--   frontend/src/services/reservationManager.js  (inventory reservation TTL)
--   frontend/src/services/doaClaims.js            (dead-on-arrival workflow)
--
-- Companion to the canonical commerce schema (20260720_canonical_commerce.sql)
-- and docs/MARKETPLACE_STATE_MODEL.md §5.5 (DOA) and §7 (reservation lifecycle).
--
-- ADDITIVE + CLEAN-SLATE: new tables only; nothing is dropped or migrated in
-- place (beta data posture, plan Task 23). CHECK constraints mirror the enums
-- in the cores — keep them in sync:
--   RESERVATION_STATES / RESERVATION_KIND  → reservationManager.js
--   CLAIM_STATUS                           → doaClaims.js
--   LINE_ITEM_STATES                       → marketplaceStateMachine.js (already
--                                            constrained on canonical_order_line_items)
--
-- TIME MODEL: the reservation core is wall-clock-injected and does all TTL math
-- in integer epoch milliseconds. To avoid lossy timestamp<->ms conversions in
-- the hot reserve path, the ms fields (created_at_ms, expires_at_ms, ttl_ms)
-- are the authoritative values the core reads; the timestamptz columns are
-- human-audit conveniences only.
-- ============================================================================

-- 1. INVENTORY RESERVATIONS ---------------------------------------------------
-- A reservation is a time-boxed hold on stock, never an indefinite lock
-- (MARKETPLACE_STATE_MODEL.md §7):
--   available → reserved (bounded TTL) → committed (no TTL) → consumed
--   reserved → released/expired ; committed → released
CREATE TABLE IF NOT EXISTS canonical_reservations (
  id TEXT PRIMARY KEY,                     -- caller-chosen id (matches core `id`)

  -- The unit being held: a specimen token id or a batch listing id, stringified
  -- (matches reservationManager `sku`). Availability is computed per sku.
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),

  -- Picks the default TTL (short for online, long/seller-configurable for cash).
  kind TEXT NOT NULL DEFAULT 'online' CHECK (kind IN ('online', 'cash')),

  -- Reservation lifecycle state (reservationManager RESERVATION_STATES).
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN (
    'reserved', 'committed', 'consumed', 'released', 'expired'
  )),

  -- Authoritative epoch-ms fields the core reads (see TIME MODEL above).
  created_at_ms BIGINT NOT NULL,
  ttl_ms BIGINT NOT NULL CHECK (ttl_ms > 0),
  expires_at_ms BIGINT,                    -- null once committed (no expiry)

  -- Optional link to the canonical order this hold belongs to (nullable: the
  -- hold is created when checkout begins, possibly before the order row).
  order_id UUID REFERENCES canonical_orders(id) ON DELETE SET NULL,

  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- audit convenience only
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_reservations_sku   ON canonical_reservations(sku);
CREATE INDEX IF NOT EXISTS idx_canonical_reservations_state ON canonical_reservations(state);
CREATE INDEX IF NOT EXISTS idx_canonical_reservations_order ON canonical_reservations(order_id);

-- keep updated_at fresh (reuses the trigger fn from the canonical commerce migration)
DROP TRIGGER IF EXISTS trg_touch_canonical_reservations ON canonical_reservations;
CREATE TRIGGER trg_touch_canonical_reservations
  BEFORE UPDATE ON canonical_reservations
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- 1a. ATOMIC RESERVE ----------------------------------------------------------
-- The reservationManager core computes availability and validates transitions
-- but explicitly defers the ATOMIC guarantee against concurrent checkouts of
-- the same unit to the database. This function is that guarantee: it serializes
-- all reservations of a given sku with a transaction-scoped advisory lock, sums
-- the currently-active holds (reserved-not-expired + committed + consumed),
-- and inserts the new hold only if total on-hand stock still covers it. Two
-- concurrent checkouts of the last unit therefore cannot both succeed.
--
-- `p_total_stock` is the on-hand count the caller derives from the listing /
-- inventory source; this function owns only the held-vs-available arithmetic.
-- Returns the number of units still available AFTER the (attempted) reserve, or
-- raises 'oversell' if the request cannot be satisfied.
CREATE OR REPLACE FUNCTION reserve_stock(
  p_id            TEXT,
  p_sku           TEXT,
  p_quantity      INTEGER,
  p_kind          TEXT,
  p_ttl_ms        BIGINT,
  p_total_stock   INTEGER,
  p_now_ms        BIGINT,
  p_order_id      UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_held    INTEGER;
  v_qty     INTEGER := GREATEST(1, p_quantity);
BEGIN
  -- Serialize concurrent reservations for this sku within the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_sku, 0));

  -- Sum active holds: reserved-and-not-expired, committed, or consumed.
  SELECT COALESCE(SUM(quantity), 0) INTO v_held
  FROM canonical_reservations
  WHERE sku = p_sku
    AND (
      state IN ('committed', 'consumed')
      OR (state = 'reserved' AND expires_at_ms > p_now_ms)
    );

  IF v_held + v_qty > p_total_stock THEN
    RAISE EXCEPTION 'oversell: % held + % requested > % on hand for sku %',
      v_held, v_qty, p_total_stock, p_sku
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO canonical_reservations
    (id, sku, quantity, kind, state, created_at_ms, ttl_ms, expires_at_ms, order_id)
  VALUES
    (p_id, p_sku, v_qty, p_kind, 'reserved', p_now_ms, p_ttl_ms, p_now_ms + p_ttl_ms, p_order_id);

  RETURN p_total_stock - (v_held + v_qty);
END;
$$;

-- 2. DOA CLAIMS ---------------------------------------------------------------
-- A dead-on-arrival claim freezes automatic release and resolves per line item
-- (MARKETPLACE_STATE_MODEL.md §5.5). Per-line resolution outcomes are recorded
-- as JSONB for audit; the money and certificate consequences land in
-- canonical_order_ledger and canonical_order_line_items respectively, and a
-- replacement resolution spawns a linked replacement sub-order in
-- canonical_orders (referenced via canonical_order_line_items.replacement_suborder_id).
CREATE TABLE IF NOT EXISTS canonical_doa_claims (
  id TEXT PRIMARY KEY,                     -- caller-chosen id (matches core `id`)
  order_id UUID NOT NULL REFERENCES canonical_orders(id) ON DELETE CASCADE,

  -- Claim lifecycle status (doaClaims CLAIM_STATUS).
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'resolved', 'denied', 'expired'
  )),

  -- Line items included in this claim (ids into canonical_order_line_items).
  affected_line_item_ids TEXT[] NOT NULL DEFAULT '{}',

  -- Structured evidence captured at open time (photos[], description, optional
  -- packaging/temperature notes). Validated against the platform minimum by the
  -- core before the row is written.
  evidence JSONB NOT NULL DEFAULT '{}',

  -- Per-line resolution decisions recorded at resolve time (audit trail):
  -- { "<lineItemId>": { "outcome": "refund|replace|deny", "refundCents": ..,
  --   "sellerPortionCents": .., "replacementSubOrderId": ".." }, ... }
  resolutions JSONB,

  -- Authoritative epoch-ms deadlines the core reads.
  opened_at_ms BIGINT NOT NULL,
  seller_response_deadline_at_ms BIGINT NOT NULL,
  claim_window_deadline_at_ms BIGINT NOT NULL,
  resolved_at_ms BIGINT,

  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- audit convenience only
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_doa_claims_order  ON canonical_doa_claims(order_id);
CREATE INDEX IF NOT EXISTS idx_canonical_doa_claims_status ON canonical_doa_claims(status);

-- At most one OPEN claim per order (a second claim reuses/extends the first).
-- Partial unique index: only 'open' rows are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_doa_open_per_order
  ON canonical_doa_claims(order_id)
  WHERE status = 'open';

DROP TRIGGER IF EXISTS trg_touch_canonical_doa_claims ON canonical_doa_claims;
CREATE TRIGGER trg_touch_canonical_doa_claims
  BEFORE UPDATE ON canonical_doa_claims
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- 3. ROW LEVEL SECURITY -------------------------------------------------------
-- Writes are service-role only (the Vercel order/claim services). Reservations
-- and claim internals stay server-side; buyers/sellers see claim status through
-- the order projection, not these tables directly.
ALTER TABLE canonical_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_doa_claims   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on canonical_reservations"
  ON canonical_reservations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role full access on canonical_doa_claims"
  ON canonical_doa_claims FOR ALL USING (auth.role() = 'service_role');
