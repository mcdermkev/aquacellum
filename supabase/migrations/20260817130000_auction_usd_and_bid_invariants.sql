-- ═══════════════════════════════════════════════════════════════════════════
-- Auctions: drop the crypto units, enforce the money invariants in the database
--
-- TWO SEPARATE PROBLEMS, both in the money path.
--
-- 1. WRONG UNITS. `auction_bids.amount_wei TEXT` is leftover scaffolding from
--    when this was an on-chain protocol. Aquadex settles in USD — every real
--    commerce table already agrees on integer cents (orders.subtotal_cents,
--    canonical_order_ledger.amount_cents, fiat_settlements.amount_cents_usd).
--    Auctions were the last place still quoting ETH at users. This converts them
--    to the house convention. There are 0 bid rows, so nothing is being
--    reinterpreted — the units are being fixed before anyone ever bid.
--
--    Same story in `wanted_listings.max_price_eth TEXT`. The two live rows hold
--    '50' and '25'. Nobody offered 50 ETH (~six figures) for a Golden Julie —
--    they typed dollars into a field labelled ETH. WantedBoard.jsx then rendered
--    `parseFloat(max_price_eth) * 1000`, displaying a $50 budget as $50,000.
--    Those two values are converted as the dollars the keepers plainly meant.
--
-- 2. "HIGHEST BID" WAS ACTUALLY "MOST RECENT BID". getHighestBid ordered by
--    created_at DESC and filtered status='active', but NOTHING ever set a bid to
--    'outbid'. So every bid stayed active and the newest one won regardless of
--    amount: bid $5,000, and the next person takes the lot with $1. On top of
--    that, amount_wei was TEXT, so even ordering by amount would have compared
--    lexicographically ('9' > '10').
--
--    Bid ordering is not something to fix only in the client. A bid is money, and
--    the client can be bypassed, retried, or race itself. The ascending-price
--    rule is enforced here as a trigger so it holds for every writer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. auction_bids: wei → cents ───────────────────────────────────────────
ALTER TABLE auction_bids ADD COLUMN IF NOT EXISTS amount_cents INTEGER;

-- Guard: only safe as a straight swap because the table is empty. If a future
-- environment somehow has rows, fail loudly rather than silently losing bids.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auction_bids WHERE amount_wei IS NOT NULL AND amount_cents IS NULL) THEN
    RAISE EXCEPTION
      'auction_bids has wei-denominated rows; refusing to guess an exchange rate. Convert them by hand.';
  END IF;
END $$;

ALTER TABLE auction_bids DROP COLUMN IF EXISTS amount_wei;
ALTER TABLE auction_bids ALTER COLUMN amount_cents SET NOT NULL;

-- A bid must be a positive amount of money. The upper bound is a fat-finger and
-- unit-error catch ($1,000,000): it is far above any plausible livestock lot, and
-- it is the tripwire that would have caught a wei value being written here.
ALTER TABLE auction_bids DROP CONSTRAINT IF EXISTS auction_bids_amount_cents_sane;
ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_amount_cents_sane
  CHECK (amount_cents > 0 AND amount_cents <= 100000000);

ALTER TABLE auction_bids DROP CONSTRAINT IF EXISTS auction_bids_status_check;
ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_status_check
  CHECK (status IN ('active', 'outbid', 'won', 'withdrawn'));

-- Ordering/lookup index for "highest bid on this lot".
DROP INDEX IF EXISTS idx_auction_bids_lot_amount;
CREATE INDEX idx_auction_bids_lot_amount
  ON auction_bids (tide_id, token_id, amount_cents DESC);

COMMENT ON COLUMN auction_bids.amount_cents IS
  'Bid amount in USD cents (integer). Replaced amount_wei TEXT on 2026-08-17: Aquadex settles in dollars, and the wei column was pre-launch crypto scaffolding.';

-- ── 2. The ascending-price invariant ───────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_auction_bid_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  standing        auction_bids;
  lot             jsonb;
  reserve_cents   INTEGER;
  tide_status     TEXT;
BEGIN
  -- Bids are only meaningful while the tide is actually running. Without this a
  -- stale tab could keep bidding on a lot that closed hours ago.
  SELECT t.status INTO tide_status FROM tides t WHERE t.id = NEW.tide_id;
  IF tide_status IS NULL THEN
    RAISE EXCEPTION 'Cannot bid: tide % does not exist.', NEW.tide_id;
  END IF;
  IF tide_status <> 'live' THEN
    RAISE EXCEPTION 'Bidding is closed — this tide is %, not live.', tide_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Reserve price, if the host set one for this lot.
  SELECT item INTO lot
    FROM tides t,
         jsonb_array_elements(COALESCE(t.settings->'auction_items', '[]'::jsonb)) AS item
   WHERE t.id = NEW.tide_id
     AND (item->>'token_id')::text = NEW.token_id::text
   LIMIT 1;

  IF lot IS NOT NULL AND (lot->>'reserve_cents') IS NOT NULL THEN
    reserve_cents := (lot->>'reserve_cents')::INTEGER;
    IF NEW.amount_cents < reserve_cents THEN
      RAISE EXCEPTION 'Bid of $% is below the $% reserve for this lot.',
        (NEW.amount_cents / 100.0), (reserve_cents / 100.0)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The standing high bid on this lot.
  SELECT * INTO standing
    FROM auction_bids
   WHERE tide_id = NEW.tide_id
     AND token_id = NEW.token_id
     AND status = 'active'
   ORDER BY amount_cents DESC, created_at ASC
   LIMIT 1;

  IF standing.id IS NOT NULL THEN
    -- An auction only goes up.
    IF NEW.amount_cents <= standing.amount_cents THEN
      RAISE EXCEPTION 'Bid of $% does not beat the standing bid of $%.',
        (NEW.amount_cents / 100.0), (standing.amount_cents / 100.0)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Don't let someone bid against themselves and inflate their own price.
    IF lower(standing.bidder_wallet) = lower(NEW.bidder_wallet) THEN
      RAISE EXCEPTION 'You already hold the high bid on this lot.'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE auction_bids SET status = 'outbid' WHERE id = standing.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_auction_bid_rules ON auction_bids;
CREATE TRIGGER trg_enforce_auction_bid_rules
  BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION enforce_auction_bid_rules();

COMMENT ON FUNCTION enforce_auction_bid_rules() IS
  'Auction money invariants: tide must be live, bid must clear the reserve, bid must strictly beat the standing high bid, no bidding against yourself. Demotes the beaten bid to outbid. Added 2026-08-17 — previously getHighestBid ordered by created_at and nothing ever set outbid, so the most RECENT bid won rather than the highest.';

-- ── 3. wanted_listings: the mislabelled ETH budget ─────────────────────────
--
-- EXPAND ONLY — the old column is deliberately left in place here.
--
-- The auction path above could be swapped outright because it is unreachable in
-- production: no tide has ever had an auction item, so no bid can exist. The
-- Wanted board is different — it is live, and the deployed frontend still writes
-- max_price_eth. Dropping it in the same breath would break "post a wanted
-- listing" for every keeper until the new bundle finished deploying.
--
-- So this adds and backfills the new column now, the frontend switches to it, and
-- a follow-up contract migration drops max_price_eth once that deploy is out.
ALTER TABLE wanted_listings ADD COLUMN IF NOT EXISTS max_price_cents INTEGER;

UPDATE wanted_listings
   SET max_price_cents = ROUND(max_price_eth::NUMERIC * 100)
 WHERE max_price_eth IS NOT NULL
   AND max_price_cents IS NULL
   AND max_price_eth ~ '^[0-9]+(\.[0-9]+)?$';

ALTER TABLE wanted_listings DROP CONSTRAINT IF EXISTS wanted_listings_max_price_cents_sane;
ALTER TABLE wanted_listings ADD CONSTRAINT wanted_listings_max_price_cents_sane
  CHECK (max_price_cents IS NULL OR (max_price_cents > 0 AND max_price_cents <= 100000000));

COMMENT ON COLUMN wanted_listings.max_price_cents IS
  'Optional maximum budget in USD cents. Replaced max_price_eth TEXT on 2026-08-17: keepers were typing dollars into a field labelled ETH, and the UI multiplied it by 1000.';
