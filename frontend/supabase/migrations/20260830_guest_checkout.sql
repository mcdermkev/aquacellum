-- ============================================================================
-- Guest checkout support (additive, safe to re-run).
--
-- Enables no-login checkout for local-pickup / batch orders. Funds are still
-- captured and HELD in the platform balance (real escrow); the order is tracked
-- by an unguessable `guest_ref` (emailed to the buyer) and RELEASED to the
-- seller when the seller confirms the in-person handoff. A guest has no wallet
-- and no on-chain buyer identity, which is fine for batch/pickup (NFT-free /
-- deferred settlement).
--
-- Apply in the Supabase SQL editor (DDL can't go through PostgREST).
-- ============================================================================

BEGIN;

-- ── fiat_settlements: allow a guest (no wallet), the 'pickup' type, and the
--    buyer's email + guest_ref handle ──────────────────────────────────────
ALTER TABLE fiat_settlements ALTER COLUMN buyer_wallet DROP NOT NULL;

ALTER TABLE fiat_settlements DROP CONSTRAINT IF EXISTS fiat_settlements_purchase_type_check;
ALTER TABLE fiat_settlements ADD CONSTRAINT fiat_settlements_purchase_type_check
  CHECK (purchase_type IN ('specimen', 'shipping', 'batch', 'multi', 'pickup'));

ALTER TABLE fiat_settlements ADD COLUMN IF NOT EXISTS buyer_email TEXT;
ALTER TABLE fiat_settlements ADD COLUMN IF NOT EXISTS guest_ref TEXT;

-- ── orders: a guest order has no buyer_wallet; it is identified by guest_ref
--    (the emailed magic-link token) + buyer_email ─────────────────────────
ALTER TABLE orders ALTER COLUMN buyer_wallet DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_ref TEXT;

-- Lookups by the emailed guest_ref (order page) — partial, only guest rows.
CREATE INDEX IF NOT EXISTS idx_orders_guest_ref
  ON orders(guest_ref) WHERE guest_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiat_settlements_guest_ref
  ON fiat_settlements(guest_ref) WHERE guest_ref IS NOT NULL;

COMMIT;
