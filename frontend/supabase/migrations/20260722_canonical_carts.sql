-- ============================================================================
-- Persistent cart — authenticated-account server mirror (Task 10)
--
-- Backs the pure core:
--   frontend/src/services/cartModel.js  (single-seller cart model)
--
-- Guest carts live in Dexie only (frontend/src/db.js `cart` table, v22).
-- Authenticated accounts additionally persist here so the cart survives a
-- device switch. One row per account (single-seller invariant means one
-- cart == one seller, so there is nothing to key by seller here).
--
-- ADDITIVE + CLEAN-SLATE: new table only; nothing dropped or migrated in
-- place (beta data posture, plan Task 23).
--
-- Access model: writes are service-role only. frontend/api/cart.js validates
-- the caller's identity via a verified Privy access token before reading or
-- writing this table — there is no public/anon policy, and the wallet
-- address is never taken from client-supplied input, only from the verified
-- token claim.
-- ============================================================================

CREATE TABLE IF NOT EXISTS canonical_carts (
  wallet_address TEXT PRIMARY KEY,          -- lowercased EOA (Privy token claim)

  -- Single-seller invariant: one wallet per cart. Nullable — an emptied
  -- cart (all items removed) has no seller.
  seller_wallet TEXT,

  -- Cart line items, mirroring the cartModel.js CartItem[] shape as-is
  -- (listingKey, tokenId/listingId, isBatch, unitPriceCents, quantity, ...).
  -- The server never interprets item fields beyond `seller_wallet` for the
  -- single-seller check below — it is a dumb mirror of the client model.
  items JSONB NOT NULL DEFAULT '[]',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- keep updated_at fresh (reuses the shared trigger fn from the canonical
-- commerce migration, already defined against canonical_orders).
DROP TRIGGER IF EXISTS trg_touch_canonical_carts ON canonical_carts;
CREATE TRIGGER trg_touch_canonical_carts
  BEFORE UPDATE ON canonical_carts
  FOR EACH ROW EXECUTE FUNCTION touch_canonical_order_updated_at();

-- ROW LEVEL SECURITY -----------------------------------------------------
-- Service-role only. api/cart.js is the sole writer/reader; it authorizes
-- via a verified Privy token and never exposes this table to anon/public.
ALTER TABLE canonical_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on canonical_carts"
  ON canonical_carts FOR ALL USING (auth.role() = 'service_role');
