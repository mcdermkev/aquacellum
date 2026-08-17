-- ═══════════════════════════════════════════════════════════════════════════
-- RLS phase 2: stop treating a client-supplied header as a credential
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- 30 policies authenticated the caller by reading an HTTP request header:
--
--   owner_address = lower(current_setting('request.headers')::json
--                          ->> 'x-wallet-address')
--
-- Any HTTP client sets its own headers. `x-wallet-address: 0xsomeone-else` is a
-- claim, not proof, so these policies were equivalent to no access control at
-- all against a deliberate attacker — while looking like real enforcement in the
-- policy list, which is worse than an obvious hole.
--
-- ── MEASURED ────────────────────────────────────────────────────────────────
--
-- frontend/scripts/verify-rls.mjs probed live PostgREST three ways. With a FORGED
-- x-wallet-address header naming another wallet, and no token of any kind:
--
--   aquadex_specimens   38 rows   (identical to that wallet's real JWT)
--   aquadex_tanks        6 rows   (identical)
--   xp_events          200 rows   (identical)
--
-- Someone else's certificates, tanks and XP ledger, readable by setting a header.
--
-- The same probe established the replacement is sound before relying on it: a
-- properly minted JWT returned those same 38 rows, and returned 0 for a different
-- wallet. The bridge both works and scopes.
--
-- ── SEQUENCING ──────────────────────────────────────────────────────────────
--
-- 24 of the 30 already had a `*_jwt` sibling covering the same table and command,
-- so dropping them changes nothing for a legitimate client. Six did NOT — orders,
-- marketplace_offers, order_status_history and order_watchlist were guarded by
-- the header ALONE. Those get JWT policies here, in the same transaction, before
-- their header versions are removed. Dropping first would have locked buyers and
-- sellers out of their own orders.
--
-- After this, x-wallet-address carries no authority anywhere. The header is still
-- SENT by supabaseClient.js, harmlessly — no policy reads it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. orders — the six that had no JWT sibling ────────────────────────────
--
-- Read and update are scoped to the two parties. INSERT is deliberately absent:
-- orders are created by api/stripe.js with the service role, after payment. A
-- client that could insert its own order row could invent a paid order.
DROP POLICY IF EXISTS "Order parties read their orders" ON orders;
CREATE POLICY "Order parties read their orders" ON orders
  FOR SELECT USING (
    current_wallet() IN (lower(buyer_wallet), lower(seller_wallet))
  );

DROP POLICY IF EXISTS "Order parties update their orders" ON orders;
CREATE POLICY "Order parties update their orders" ON orders
  FOR UPDATE USING (
    current_wallet() IN (lower(buyer_wallet), lower(seller_wallet))
  );

-- ── 2. order_status_history ────────────────────────────────────────────────
-- Readable only through an order you are party to.
DROP POLICY IF EXISTS "Order parties read status history" ON order_status_history;
CREATE POLICY "Order parties read status history" ON order_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders o
       WHERE o.id = order_status_history.order_id
         AND current_wallet() IN (lower(o.buyer_wallet), lower(o.seller_wallet))
    )
  );

-- ── 3. marketplace_offers ──────────────────────────────────────────────────
-- An offer is between a buyer and a seller; both see it, nobody else does. Offer
-- amounts are commercially sensitive — visible competing offers would let a buyer
-- undercut by exactly a dollar.
DROP POLICY IF EXISTS "Offer parties read their offers" ON marketplace_offers;
CREATE POLICY "Offer parties read their offers" ON marketplace_offers
  FOR SELECT USING (
    current_wallet() IN (lower(buyer_wallet), lower(seller_wallet))
  );

DROP POLICY IF EXISTS "Buyers make their own offers" ON marketplace_offers;
CREATE POLICY "Buyers make their own offers" ON marketplace_offers
  FOR INSERT WITH CHECK (lower(buyer_wallet) = current_wallet());

-- Either party can move an offer along (seller counters/accepts, buyer withdraws).
DROP POLICY IF EXISTS "Offer parties respond" ON marketplace_offers;
CREATE POLICY "Offer parties respond" ON marketplace_offers
  FOR UPDATE USING (
    current_wallet() IN (lower(buyer_wallet), lower(seller_wallet))
  );

-- ── 4. order_watchlist ─────────────────────────────────────────────────────
-- The old policy was FOR ALL on a header. Split by command so the write side is
-- explicit about only ever touching your own rows.
DROP POLICY IF EXISTS "Own watchlist rows" ON order_watchlist;
CREATE POLICY "Own watchlist rows" ON order_watchlist
  FOR INSERT WITH CHECK (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Update own watchlist" ON order_watchlist;
CREATE POLICY "Update own watchlist" ON order_watchlist
  FOR UPDATE USING (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Delete own watchlist" ON order_watchlist;
CREATE POLICY "Delete own watchlist" ON order_watchlist
  FOR DELETE USING (lower(wallet_address) = current_wallet());

-- ── 5. Now drop every header-authenticated policy ──────────────────────────
DO $$
DECLARE r record; dropped int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual::text LIKE '%request.headers%' OR with_check::text LIKE '%request.headers%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'Dropped % header-authenticated policies', dropped;
END $$;

-- ── 6. Assert the outcome, in the same transaction ─────────────────────────
-- If any header-based policy survives, fail loudly rather than reporting success.
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual::text LIKE '%request.headers%' OR with_check::text LIKE '%request.headers%');

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Expected 0 header-authenticated policies, found %', remaining;
  END IF;
END $$;
