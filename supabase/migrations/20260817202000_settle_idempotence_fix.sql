-- ═══════════════════════════════════════════════════════════════════════════
-- Make settle_tide_auction properly idempotent
--
-- THE BUG, caught by re-running settlement in a rolled-back transaction: calling
-- settle_tide_auction twice inserted a SECOND 'unsold' row for every lot that had
-- no bids.
--
-- The skip check only treated a lot as settled when a row existed with status in
-- ('awaiting_payment','paid','transferred'). 'unsold' was not in that list, and
-- idx_auction_settlements_one_live is a PARTIAL index over exactly those same
-- three statuses, so nothing stopped the duplicate either — the guard and the
-- index shared the same blind spot.
--
-- Visible effect: the host taps "Settle" twice, or a retry fires, and unsold lots
-- accumulate a row per attempt.
--
-- Correct rule: settle_tide_auction resolves each lot ONCE. Every subsequent
-- transition (a winner not paying, promoting the next bidder) belongs to
-- forfeit_auction_settlement, which manages its own chain. So the guard now skips
-- a lot with ANY settlement history, and a second unique index makes a duplicate
-- unsold row structurally impossible rather than merely unlikely.
-- ═══════════════════════════════════════════════════════════════════════════

-- Structural guard: at most one unsold row per lot.
DROP INDEX IF EXISTS idx_auction_settlements_one_unsold;
CREATE UNIQUE INDEX idx_auction_settlements_one_unsold
  ON auction_settlements (tide_id, token_id)
  WHERE status = 'unsold';

CREATE OR REPLACE FUNCTION settle_tide_auction(target_tide UUID, actor_wallet TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t              tides;
  lot            jsonb;
  reserve_cents  INTEGER;
  top            auction_bids;
  results        jsonb := '[]'::jsonb;
  payouts_ok     BOOLEAN;
BEGIN
  SELECT * INTO t FROM tides WHERE id = target_tide;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'Tide does not exist.';
  END IF;

  IF lower(t.host_wallet) <> lower(actor_wallet) THEN
    RAISE EXCEPTION 'Only the host can settle this auction.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF now() <= t.end_time AND t.status <> 'ended' THEN
    RAISE EXCEPTION 'The auction is still running — it ends %.', t.end_time
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(bool_or(s.payouts_enabled), false) INTO payouts_ok
    FROM seller_stripe_accounts s
   WHERE lower(s.wallet_address) = lower(t.host_wallet);

  IF NOT payouts_ok THEN
    RAISE EXCEPTION 'Finish Stripe payout setup before settling — winners cannot be charged until you can be paid.'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR lot IN
    SELECT value FROM jsonb_array_elements(coalesce(t.settings -> 'auction_items', '[]'::jsonb))
  LOOP
    reserve_cents := nullif(lot ->> 'reserve_cents', '')::INTEGER;

    -- ANY settlement history means this lot has already been resolved once.
    -- Previously this looked only for a LIVE settlement, so unsold lots were
    -- re-settled on every call and piled up duplicate rows.
    IF EXISTS (
      SELECT 1 FROM auction_settlements s
       WHERE s.tide_id = target_tide
         AND s.token_id = (lot ->> 'token_id')::INTEGER
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO top
      FROM auction_bids b
     WHERE b.tide_id = target_tide
       AND b.token_id = (lot ->> 'token_id')::INTEGER
       AND b.status = 'active'
     ORDER BY b.amount_cents DESC, b.created_at ASC
     LIMIT 1;

    -- No bids at all, or (defensively) nothing clearing a reserve that was raised
    -- after bidding opened. enforce_auction_bid_rules already rejects
    -- below-reserve bids at insert, so in practice this is the zero-bid case.
    IF top.id IS NULL OR (reserve_cents IS NOT NULL AND top.amount_cents < reserve_cents) THEN
      INSERT INTO auction_settlements (tide_id, token_id, seller_wallet, status)
      VALUES (target_tide, (lot ->> 'token_id')::INTEGER, t.host_wallet, 'unsold');

      results := results || jsonb_build_object(
        'token_id', (lot ->> 'token_id')::INTEGER, 'outcome', 'unsold'
      );
      CONTINUE;
    END IF;

    UPDATE auction_bids SET status = 'won'    WHERE id = top.id;
    UPDATE auction_bids SET status = 'outbid'
     WHERE tide_id = target_tide
       AND token_id = (lot ->> 'token_id')::INTEGER
       AND id <> top.id
       AND status = 'active';

    INSERT INTO auction_settlements (
      tide_id, token_id, winning_bid_id, winner_wallet, seller_wallet,
      amount_cents, status, payment_deadline
    ) VALUES (
      target_tide, (lot ->> 'token_id')::INTEGER, top.id, top.bidder_wallet, t.host_wallet,
      top.amount_cents, 'awaiting_payment', now() + interval '24 hours'
    );

    results := results || jsonb_build_object(
      'token_id', (lot ->> 'token_id')::INTEGER,
      'outcome', 'won',
      'winner', top.bidder_wallet,
      'amount_cents', top.amount_cents
    );
  END LOOP;

  RETURN results;
END;
$$;
