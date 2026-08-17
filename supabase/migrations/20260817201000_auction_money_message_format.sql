-- ═══════════════════════════════════════════════════════════════════════════
-- Format dollar amounts in auction error messages
--
-- enforce_auction_bid_rules interpolated `amount_cents / 100.0`, which is numeric
-- division and carries its full scale. A rejected bid told the bidder:
--
--   "Bid of $10.0000000000000000 is below the $500.0000000000000000 reserve"
--
-- These strings are surfaced verbatim by AuctionPanel — the trigger owns the bid
-- rules, so the client shows its message rather than inventing its own. That is
-- the right design, and it means the wording is user-facing copy and has to read
-- like money.
--
-- Also fixes the parallel case in the standing-bid comparison.
-- ═══════════════════════════════════════════════════════════════════════════

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
  SELECT t.status INTO tide_status FROM tides t WHERE t.id = NEW.tide_id;
  IF tide_status IS NULL THEN
    RAISE EXCEPTION 'Cannot bid: tide % does not exist.', NEW.tide_id;
  END IF;
  IF tide_status <> 'live' THEN
    RAISE EXCEPTION 'Bidding is closed — this tide is %, not live.', tide_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT item INTO lot
    FROM tides t,
         jsonb_array_elements(COALESCE(t.settings->'auction_items', '[]'::jsonb)) AS item
   WHERE t.id = NEW.tide_id
     AND (item->>'token_id')::text = NEW.token_id::text
   LIMIT 1;

  IF lot IS NOT NULL AND (lot->>'reserve_cents') IS NOT NULL THEN
    reserve_cents := (lot->>'reserve_cents')::INTEGER;
    IF NEW.amount_cents < reserve_cents THEN
      -- to_char with FM strips the padding to_char otherwise adds.
      RAISE EXCEPTION 'Bid of $% is below the $% opening bid for this lot.',
        to_char(NEW.amount_cents / 100.0, 'FM999999990.00'),
        to_char(reserve_cents / 100.0, 'FM999999990.00')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO standing
    FROM auction_bids
   WHERE tide_id = NEW.tide_id
     AND token_id = NEW.token_id
     AND status = 'active'
   ORDER BY amount_cents DESC, created_at ASC
   LIMIT 1;

  IF standing.id IS NOT NULL THEN
    IF NEW.amount_cents <= standing.amount_cents THEN
      RAISE EXCEPTION 'Bid of $% does not beat the standing bid of $%.',
        to_char(NEW.amount_cents / 100.0, 'FM999999990.00'),
        to_char(standing.amount_cents / 100.0, 'FM999999990.00')
        USING ERRCODE = 'check_violation';
    END IF;

    IF lower(standing.bidder_wallet) = lower(NEW.bidder_wallet) THEN
      RAISE EXCEPTION 'You already hold the high bid on this lot.'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE auction_bids SET status = 'outbid' WHERE id = standing.id;
  END IF;

  RETURN NEW;
END;
$$;
