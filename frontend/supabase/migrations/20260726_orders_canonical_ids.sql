-- ============================================================================
-- Orders → canonical id read-through (Task 16/17/18 follow-up, Tier A / Opus)
--
-- Surfaces the canonical order id + its line-item ids onto the legacy `orders`
-- row (the one the buyer's client already syncs). This is what lets the
-- buyer-facing "report a problem" flow (ArrivalModal, Task 18) open a
-- STRUCTURED DOA claim (?action=doa-open) against the real
-- canonical_order_line_items instead of only the legacy dispute path.
--
-- Populated at webhook time (payment_intent.succeeded) right after
-- recordCanonicalOrderProtected creates the canonical order + its line items —
-- see frontend/api/stripe.js. Only written when CANONICAL_SETTLEMENT_ENABLED is
-- on; NULL/empty otherwise, in which case the client guard stays inert and the
-- legacy dispute path is used (no behavior change).
--
-- ADDITIVE + nullable: no backfill, no constraint, no RLS change (orders RLS
-- already exists). Existing rows keep NULL and simply use the legacy path.
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS canonical_order_id UUID;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS canonical_line_item_ids JSONB NOT NULL DEFAULT '[]';

-- Map back from a canonical order to its legacy orders row when needed.
CREATE INDEX IF NOT EXISTS idx_orders_canonical_order_id
  ON orders(canonical_order_id) WHERE canonical_order_id IS NOT NULL;

-- ============================================================================
-- Done! orders now carries canonical_order_id + canonical_line_item_ids for the
-- buyer-facing structured DOA claim read-through.
-- ============================================================================
