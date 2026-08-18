-- ═══════════════════════════════════════════════════════════════════════════
-- Contract step: drop wanted_listings.max_price_eth
--
-- The expand half of this landed in 20260817130000, which added max_price_cents
-- and backfilled it. The old column was deliberately LEFT IN PLACE at the time
-- because the deployed frontend was still writing it — dropping both halves at
-- once would have broken "post a wanted listing" for every keeper until the new
-- bundle finished deploying.
--
-- That frontend shipped in e2cccb6 and several deploys have followed, so nothing
-- writes max_price_eth any more. Verified before dropping: 5 rows total, 2 with an
-- eth value, and 2 with a cents value — the same two rows, already converted.
--
-- Recap of why the column was wrong rather than merely renamed: the two live
-- values were '50' and '25'. Nobody offered 50 ETH (about six figures) for a
-- Golden Julie — they typed dollars into a field labelled ETH, and WantedBoard
-- then rendered `parseFloat(max_price_eth) * 1000`, announcing a $50 budget to the
-- seller as "$50,000".
-- ═══════════════════════════════════════════════════════════════════════════

-- Refuse to drop if any row would silently lose a budget, rather than assuming the
-- earlier backfill covered everything.
DO $$
DECLARE unconverted int;
BEGIN
  SELECT count(*) INTO unconverted
    FROM wanted_listings
   WHERE max_price_eth IS NOT NULL
     AND max_price_cents IS NULL;

  IF unconverted > 0 THEN
    RAISE EXCEPTION
      '% wanted listings still have max_price_eth with no max_price_cents. Backfill before dropping.',
      unconverted;
  END IF;
END $$;

ALTER TABLE wanted_listings DROP COLUMN IF EXISTS max_price_eth;
