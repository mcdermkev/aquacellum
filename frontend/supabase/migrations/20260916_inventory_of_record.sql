-- ============================================================================
-- Inventory of record  (BOOTH_BUILD_SPEC.md §2, decision D1)
--
-- WHY THIS EXISTS
-- Before this migration there was no server-authoritative, decrementable stock
-- anywhere. `aquadex_listings` had no quantity column: quantity lived only
-- inside the `data` JSONB blob, and that blob is only ever WHOLE-OBJECT
-- overwritten by cloudSync.listingToRow/syncListingToCloud — which is never
-- called from any sale path. Authoritative stock was the on-chain
-- batchListings(id).quantity, and `canonical_reservations` only COMPUTES
-- availability (total_stock − active holds) without decrementing anything.
--
-- A booth seller standing at a table needs to sell a bag and have the count go
-- down, offline, for cash, with no chain round-trip. That needs real columns and
-- an atomic decrement. Two concurrent sales of the last unit must not both win.
--
-- WHY COLUMNS AND NOT THE BLOB
-- The blob is replaced wholesale on every listing edit, so a concurrent price
-- edit would silently reset stock, and there is no safe conditional decrement
-- inside JSON. Stock is a number that two writers race for; it belongs in a
-- column behind a lock.
--
-- Additive and idempotent. Apply in the Supabase SQL editor (DDL cannot go
-- through PostgREST).
-- ============================================================================

BEGIN;

-- ── 1. The columns ──────────────────────────────────────────────────────────
ALTER TABLE aquadex_listings ADD COLUMN IF NOT EXISTS quantity_total INTEGER;
ALTER TABLE aquadex_listings ADD COLUMN IF NOT EXISTS quantity_remaining INTEGER;

-- Backfill from the blob. Guarded with a numeric regex because `data->>'quantity'`
-- is free-form JSON: singles have no quantity key at all (implicitly 1), and a
-- malformed value must not abort the migration.
UPDATE aquadex_listings
SET
  quantity_total = COALESCE(
    quantity_total,
    CASE
      WHEN data->>'quantity' ~ '^[0-9]+$' THEN (data->>'quantity')::int
      WHEN is_batch THEN 0
      ELSE 1
    END
  ),
  quantity_remaining = COALESCE(
    quantity_remaining,
    CASE
      WHEN data->>'quantity' ~ '^[0-9]+$' THEN (data->>'quantity')::int
      WHEN is_batch THEN 0
      ELSE 1
    END
  )
WHERE quantity_total IS NULL OR quantity_remaining IS NULL;

-- Stock can reach zero but never go negative. NOT VALID so the constraint
-- applies to new writes without failing on any pre-existing odd row.
ALTER TABLE aquadex_listings DROP CONSTRAINT IF EXISTS aquadex_listings_quantity_nonnegative;
ALTER TABLE aquadex_listings ADD CONSTRAINT aquadex_listings_quantity_nonnegative
  CHECK (quantity_remaining IS NULL OR quantity_remaining >= 0) NOT VALID;

-- Low-stock surface for the booth view / dashboard card.
CREATE INDEX IF NOT EXISTS idx_aquadex_listings_low_stock
  ON aquadex_listings(seller_address)
  WHERE quantity_remaining IS NOT NULL AND quantity_remaining <= 2;

-- ── 2. Sale ledger (idempotency + audit) ────────────────────────────────────
-- One row per applied decrement. `sale_id` is client-generated so an offline
-- booth sale can be replayed by the outbox any number of times and land once.
-- This is also the audit trail for "why did stock change", which the blob could
-- never answer.
CREATE TABLE IF NOT EXISTS inventory_sale_events (
  sale_id          TEXT PRIMARY KEY,
  listing_id       TEXT NOT NULL,
  seller_address   TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity >= 1),
  quantity_after   INTEGER NOT NULL CHECK (quantity_after >= 0),
  rail             TEXT NOT NULL DEFAULT 'cash' CHECK (rail IN ('cash', 'card', 'adjustment')),
  order_id         UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sale_events_listing
  ON inventory_sale_events(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_sale_events_seller
  ON inventory_sale_events(seller_address, created_at DESC);

ALTER TABLE inventory_sale_events ENABLE ROW LEVEL SECURITY;
-- Written only through the RPC below (service role). No client policy on purpose.
DROP POLICY IF EXISTS "service_role full access on inventory_sale_events" ON inventory_sale_events;
CREATE POLICY "service_role full access on inventory_sale_events"
  ON inventory_sale_events FOR ALL USING (auth.role() = 'service_role');

-- ── 3. Atomic, idempotent decrement ─────────────────────────────────────────
-- Serialises concurrent sales of the same listing with a transaction-scoped
-- advisory lock, exactly as the existing reserve_stock RPC does, so two buyers
-- cannot both take the last fish.
--
-- Contract:
--   • replay of a known sale_id  → returns the previously recorded
--     quantity_after and changes nothing (offline outbox safety)
--   • seller mismatch            → insufficient_privilege
--   • unknown listing            → no_data_found
--   • not enough stock           → 'oversell' with ERRCODE check_violation,
--                                  matching reserve_stock's convention
--   • success                    → new quantity_remaining, and is_active is
--                                  flipped false when it hits zero
CREATE OR REPLACE FUNCTION record_inventory_sale(
  p_sale_id     TEXT,
  p_listing_id  TEXT,
  p_quantity    INTEGER,
  p_seller      TEXT,
  p_rail        TEXT DEFAULT 'cash',
  p_order_id    UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_after INTEGER;
  v_seller         TEXT;
  v_remaining      INTEGER;
  v_qty            INTEGER := GREATEST(1, COALESCE(p_quantity, 1));
  v_new_remaining  INTEGER;
BEGIN
  IF p_sale_id IS NULL OR btrim(p_sale_id) = '' THEN
    RAISE EXCEPTION 'sale_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_listing_id IS NULL OR p_seller IS NULL THEN
    RAISE EXCEPTION 'listing_id and seller are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotency FIRST, before the lock: a replayed sale is a pure read.
  SELECT quantity_after INTO v_existing_after
  FROM inventory_sale_events WHERE sale_id = p_sale_id;
  IF FOUND THEN
    RETURN v_existing_after;
  END IF;

  -- Serialise all sales of this listing within the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_listing_id, 0));

  -- Re-check idempotency inside the lock: two devices replaying the same offline
  -- sale simultaneously would both miss the check above.
  SELECT quantity_after INTO v_existing_after
  FROM inventory_sale_events WHERE sale_id = p_sale_id;
  IF FOUND THEN
    RETURN v_existing_after;
  END IF;

  SELECT seller_address, quantity_remaining
    INTO v_seller, v_remaining
  FROM aquadex_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing % not found', p_listing_id USING ERRCODE = 'no_data_found';
  END IF;

  IF lower(v_seller) <> lower(p_seller) THEN
    RAISE EXCEPTION 'listing % does not belong to %', p_listing_id, p_seller
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A NULL remaining means the backfill never ran for this row; treat as 0 rather
  -- than silently selling unlimited stock.
  v_remaining := COALESCE(v_remaining, 0);

  IF v_remaining < v_qty THEN
    RAISE EXCEPTION 'oversell: % remaining, % requested for listing %',
      v_remaining, v_qty, p_listing_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_remaining := v_remaining - v_qty;

  UPDATE aquadex_listings
  SET quantity_remaining = v_new_remaining,
      -- Sold out leaves the public view immediately. Never re-activates here.
      is_active = CASE WHEN v_new_remaining = 0 THEN false ELSE is_active END,
      updated_at = NOW()
  WHERE id = p_listing_id;

  INSERT INTO inventory_sale_events
    (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  VALUES
    (p_sale_id, p_listing_id, lower(p_seller), v_qty, v_new_remaining,
     COALESCE(NULLIF(p_rail, ''), 'cash'), p_order_id);

  RETURN v_new_remaining;
END;
$$;

-- Callable by the server (service role) only. Deliberately NOT granted to anon
-- or authenticated: stock is money-adjacent, and every listing write in this app
-- currently goes through the browser key with no server authorization. This RPC
-- is the first one that refuses that pattern.
REVOKE ALL ON FUNCTION record_inventory_sale(TEXT, TEXT, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_inventory_sale(TEXT, TEXT, INTEGER, TEXT, TEXT, UUID) TO service_role;

-- ── 4. Restock / manual adjustment ──────────────────────────────────────────
-- A booth seller who miscounts needs a way back. Separate function so the sale
-- path can never silently increase stock.
CREATE OR REPLACE FUNCTION adjust_inventory_remaining(
  p_listing_id  TEXT,
  p_remaining   INTEGER,
  p_seller      TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller TEXT;
  v_total  INTEGER;
BEGIN
  IF p_remaining IS NULL OR p_remaining < 0 THEN
    RAISE EXCEPTION 'remaining must be >= 0' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_listing_id, 0));

  SELECT seller_address, quantity_total INTO v_seller, v_total
  FROM aquadex_listings WHERE id = p_listing_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing % not found', p_listing_id USING ERRCODE = 'no_data_found';
  END IF;
  IF lower(v_seller) <> lower(p_seller) THEN
    RAISE EXCEPTION 'listing % does not belong to %', p_listing_id, p_seller
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE aquadex_listings
  SET quantity_remaining = p_remaining,
      -- Raising stock above zero puts the listing back on sale; zero retires it.
      is_active = CASE WHEN p_remaining = 0 THEN false ELSE true END,
      quantity_total = GREATEST(COALESCE(v_total, 0), p_remaining),
      updated_at = NOW()
  WHERE id = p_listing_id;

  RETURN p_remaining;
END;
$$;

REVOKE ALL ON FUNCTION adjust_inventory_remaining(TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_inventory_remaining(TEXT, INTEGER, TEXT) TO service_role;

-- ── 5. Seed stock for NEW listings, server-side ─────────────────────────────
-- cloudSync.listingToRow() does not send quantity_total/quantity_remaining, which
-- is exactly what we want on UPDATE (a Supabase upsert only touches the columns
-- in its payload, so an unrelated price edit cannot reset stock). But it means a
-- freshly inserted listing would land with NULL stock, and the sale RPC treats
-- NULL as zero — a brand-new listing would be unsellable.
--
-- Deriving it in a BEFORE INSERT trigger fixes that without touching any client.
-- That matters here: listings are written from several client paths
-- (relayCreateListing, BatchListingWizard, a service-role seed) all using the
-- browser key with no server authorization, so a rule enforced in one JS helper
-- would be quietly bypassed by the others. The database is the only place every
-- writer must pass through.
CREATE OR REPLACE FUNCTION seed_listing_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seed INTEGER;
BEGIN
  IF NEW.quantity_remaining IS NOT NULL AND NEW.quantity_total IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_seed := CASE
    WHEN NEW.data->>'quantity' ~ '^[0-9]+$' THEN (NEW.data->>'quantity')::int
    WHEN NEW.is_batch THEN 0        -- a batch with no readable quantity sells nothing
    ELSE 1                          -- a single specimen is exactly one fish
  END;

  NEW.quantity_total     := COALESCE(NEW.quantity_total, v_seed);
  NEW.quantity_remaining := COALESCE(NEW.quantity_remaining, v_seed);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_listing_quantity ON aquadex_listings;
CREATE TRIGGER trg_seed_listing_quantity
  BEFORE INSERT ON aquadex_listings
  FOR EACH ROW EXECUTE FUNCTION seed_listing_quantity();

COMMIT;

-- ── Post-apply note ─────────────────────────────────────────────────────────
-- The public projection `aquadex_listings_public` is an allowlist view. To
-- surface live stock publicly (the tank page and marketplace both want it), the
-- view must be recreated with quantity_remaining added to its select list. That
-- is a separate reviewed change — see BOOTH_BUILD_SPEC.md §5.
