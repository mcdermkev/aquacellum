-- ═══════════════════════════════════════════════════════════════════════════
-- Re-assert the auction bid rules TRIGGER alongside its function
--
-- Found by supabase/tests/auction_lifecycle.test.mjs. The test builds the schema
-- from a subset of migrations, and every bid rule silently did nothing: a bid
-- below the opening price, a bid that did not beat the standing bid, and a bid
-- against yourself were all accepted.
--
-- The cause is a structural split rather than a logic error.
-- enforce_auction_bid_rules() is the FUNCTION; trg_enforce_auction_bid_rules is
-- the TRIGGER that calls it. The function was created in 20260817130000 together
-- with its trigger, but 20260817201000 (which reformatted the dollar amounts in
-- its error messages) used CREATE OR REPLACE FUNCTION only. Replacing a function
-- does not touch triggers, so in production the rules stayed attached — but the
-- two are now separable, and a function with no trigger enforces nothing while
-- looking perfectly correct in the schema.
--
-- These rules decide who wins something. "Present but not wired up" is the worst
-- failure mode available to them, because nothing about it looks broken. This
-- re-creates the trigger idempotently, and then VERIFIES it is attached rather
-- than assuming.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_enforce_auction_bid_rules ON auction_bids;
CREATE TRIGGER trg_enforce_auction_bid_rules
  BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION enforce_auction_bid_rules();

-- The card-on-file check, likewise. aaa_ keeps it ahead of the rules trigger by
-- name order so "add a payment method" is the first thing a bidder is told,
-- rather than a reserve or increment complaint.
DROP TRIGGER IF EXISTS aaa_enforce_bidder_payment_method ON auction_bids;
CREATE TRIGGER aaa_enforce_bidder_payment_method
  BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION enforce_bidder_has_payment_method();

-- Fail loudly if either rule is not actually wired to the table.
DO $$
DECLARE attached int;
BEGIN
  SELECT count(*) INTO attached
    FROM pg_trigger
   WHERE tgrelid = 'auction_bids'::regclass
     AND NOT tgisinternal
     AND tgname IN ('trg_enforce_auction_bid_rules', 'aaa_enforce_bidder_payment_method');

  IF attached <> 2 THEN
    RAISE EXCEPTION 'Expected both auction bid triggers on auction_bids, found %', attached;
  END IF;
END $$;
