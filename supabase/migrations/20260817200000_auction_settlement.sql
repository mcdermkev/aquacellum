-- ═══════════════════════════════════════════════════════════════════════════
-- Auction settlement: what happens after the last bid
--
-- Bidding worked; ending did not. Nothing in the codebase ever wrote
-- auction_bids.status = 'won' — AuctionPanel reads that value to render a
-- "Winner!" chip, so the chip was unreachable code. useEndTide only flipped the
-- tide's status. A lot closed with a high bid sitting in a table and two people
-- who had to work it out in the chat. There was also NO outcome at all for a lot
-- that failed to meet its reserve.
--
-- This adds the state machine. Payment collection is deliberately a separate
-- change (it needs new Stripe surface — no SetupIntent support exists yet), so
-- everything here is written so that a lot can sit in 'awaiting_payment'
-- indefinitely without corrupting anything.
--
-- ── WHY THE DATABASE OWNS THIS ──────────────────────────────────────────────
--
-- Settlement decides who owes money and who is entitled to a fish. The client can
-- be retried, raced, or simply closed mid-flow. Same reasoning as
-- enforce_auction_bid_rules: the rules live where they cannot be skipped.
--
-- ── THE FORFEIT CHAIN ───────────────────────────────────────────────────────
--
-- A winner who never pays must not deadlock the lot. Forfeiting promotes the
-- next-highest bid to a fresh settlement, which is why (tide_id, token_id) is NOT
-- globally unique here — a lot may be settled several times as it falls down the
-- bid stack. What IS enforced is that only one settlement per lot can be LIVE at
-- a time, via a partial unique index.
-- ═══════════════════════════════════════════════════════════════════════════

-- 'forfeited' is a new terminal state for a bid whose winner did not pay.
ALTER TABLE auction_bids DROP CONSTRAINT IF EXISTS auction_bids_status_check;
ALTER TABLE auction_bids ADD CONSTRAINT auction_bids_status_check
  CHECK (status IN ('active', 'outbid', 'won', 'withdrawn', 'forfeited'));

CREATE TABLE IF NOT EXISTS auction_settlements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id        UUID NOT NULL REFERENCES tides(id) ON DELETE CASCADE,
  token_id       INTEGER NOT NULL,

  winning_bid_id UUID REFERENCES auction_bids(id) ON DELETE SET NULL,
  winner_wallet  TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  seller_wallet  TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  amount_cents   INTEGER,

  -- awaiting_payment → paid → transferred
  --                  ↘ payment_failed → forfeited (then the next bid is promoted)
  -- unsold: closed with no bid, or no bid that cleared the reserve.
  status         TEXT NOT NULL DEFAULT 'awaiting_payment',

  -- A winner gets a bounded window to pay. Beyond it the lot can be forfeited to
  -- the next bidder rather than sitting unresolved forever.
  payment_deadline TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,

  stripe_payment_intent TEXT,
  paid_at        TIMESTAMPTZ,
  transferred_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT auction_settlements_status_check
    CHECK (status IN ('awaiting_payment', 'paid', 'payment_failed', 'forfeited', 'unsold', 'transferred')),

  -- An unsold lot has no winner and no amount; a sold one must have all three.
  CONSTRAINT auction_settlements_sold_coherent CHECK (
    (status = 'unsold' AND winning_bid_id IS NULL AND winner_wallet IS NULL AND amount_cents IS NULL)
    OR (status <> 'unsold' AND winning_bid_id IS NOT NULL AND winner_wallet IS NOT NULL AND amount_cents > 0)
  ),

  CONSTRAINT auction_settlements_paid_coherent CHECK (
    (status IN ('paid', 'transferred')) = (paid_at IS NOT NULL)
  ),

  -- You cannot buy your own lot.
  CONSTRAINT auction_settlements_no_self_purchase
    CHECK (winner_wallet IS NULL OR lower(winner_wallet) <> lower(seller_wallet))
);

-- Only ONE live settlement per lot. Forfeited/unsold rows stay for history, which
-- is what allows the forfeit chain to re-settle the same lot.
DROP INDEX IF EXISTS idx_auction_settlements_one_live;
CREATE UNIQUE INDEX idx_auction_settlements_one_live
  ON auction_settlements (tide_id, token_id)
  WHERE status IN ('awaiting_payment', 'paid', 'transferred');

CREATE INDEX IF NOT EXISTS idx_auction_settlements_winner
  ON auction_settlements (winner_wallet, status);

CREATE INDEX IF NOT EXISTS idx_auction_settlements_due
  ON auction_settlements (payment_deadline)
  WHERE status = 'awaiting_payment';

COMMENT ON TABLE auction_settlements IS
  'Outcome of each auction lot. One live row per lot; forfeited and unsold rows are retained so a lot can fall down the bid stack when a winner does not pay.';

-- ── Settle every lot in a tide ─────────────────────────────────────────────
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

  -- Settling mid-auction would cut bidding short.
  IF now() <= t.end_time AND t.status <> 'ended' THEN
    RAISE EXCEPTION 'The auction is still running — it ends %.', t.end_time
      USING ERRCODE = 'check_violation';
  END IF;

  -- Do not declare winners the seller cannot be paid for. Better to refuse than
  -- to tell someone they have bought a fish and then have nowhere to send money.
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

    -- Already settled? Leave it alone; this function is safe to re-run for a tide
    -- where only some lots resolved.
    IF EXISTS (
      SELECT 1 FROM auction_settlements s
       WHERE s.tide_id = target_tide
         AND s.token_id = (lot ->> 'token_id')::INTEGER
         AND s.status IN ('awaiting_payment', 'paid', 'transferred')
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

    IF top.id IS NULL OR (reserve_cents IS NOT NULL AND top.amount_cents < reserve_cents) THEN
      -- No bids, or nothing cleared the reserve. Previously this produced no
      -- outcome whatsoever and nobody was told anything.
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

COMMENT ON FUNCTION settle_tide_auction(UUID, TEXT) IS
  'Closes every lot in an auction tide: highest active bid wins, the rest are marked outbid, lots that miss their reserve are recorded unsold. Host only, only after the tide ends, refuses unless the host can actually receive payouts. Idempotent per lot.';

-- ── Forfeit and promote the next bidder ────────────────────────────────────
CREATE OR REPLACE FUNCTION forfeit_auction_settlement(target_settlement UUID, reason TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s    auction_settlements;
  nxt  auction_bids;
  res  jsonb;
BEGIN
  SELECT * INTO s FROM auction_settlements WHERE id = target_settlement;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Settlement does not exist.';
  END IF;

  IF s.status IN ('paid', 'transferred') THEN
    RAISE EXCEPTION 'That lot has already been paid for.' USING ERRCODE = 'check_violation';
  END IF;
  IF s.status IN ('forfeited', 'unsold') THEN
    RAISE EXCEPTION 'That settlement is already closed.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE auction_settlements
     SET status = 'forfeited', last_error = coalesce(reason, last_error)
   WHERE id = target_settlement;

  -- The bid that failed to pay is retired, not returned to 'active', so it cannot
  -- be promoted again on a later pass.
  IF s.winning_bid_id IS NOT NULL THEN
    UPDATE auction_bids SET status = 'forfeited' WHERE id = s.winning_bid_id;
  END IF;

  -- Promote the next-highest bid that is still standing. Bids demoted to 'outbid'
  -- at settlement are eligible again here: being outbid by someone who then never
  -- paid should not cost you the lot.
  SELECT * INTO nxt
    FROM auction_bids b
   WHERE b.tide_id = s.tide_id
     AND b.token_id = s.token_id
     AND b.status IN ('active', 'outbid')
     AND (s.amount_cents IS NULL OR b.amount_cents < s.amount_cents)
   ORDER BY b.amount_cents DESC, b.created_at ASC
   LIMIT 1;

  IF nxt.id IS NULL THEN
    INSERT INTO auction_settlements (tide_id, token_id, seller_wallet, status)
    VALUES (s.tide_id, s.token_id, s.seller_wallet, 'unsold');
    RETURN jsonb_build_object('promoted', false, 'outcome', 'unsold');
  END IF;

  UPDATE auction_bids SET status = 'won' WHERE id = nxt.id;

  INSERT INTO auction_settlements (
    tide_id, token_id, winning_bid_id, winner_wallet, seller_wallet,
    amount_cents, status, payment_deadline
  ) VALUES (
    s.tide_id, s.token_id, nxt.id, nxt.bidder_wallet, s.seller_wallet,
    nxt.amount_cents, 'awaiting_payment', now() + interval '24 hours'
  )
  RETURNING jsonb_build_object(
    'promoted', true, 'settlement_id', id,
    'winner', winner_wallet, 'amount_cents', amount_cents
  ) INTO res;

  RETURN res;
END;
$$;

COMMENT ON FUNCTION forfeit_auction_settlement(UUID, TEXT) IS
  'Retires a settlement whose winner did not pay and promotes the next-highest standing bid to a fresh settlement, so a non-paying winner cannot deadlock a lot. Refuses on an already-paid lot.';

-- ── Transfer the certificate once paid ─────────────────────────────────────
CREATE OR REPLACE FUNCTION transfer_auction_lot(target_settlement UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s       auction_settlements;
  moved   INTEGER;
BEGIN
  SELECT * INTO s FROM auction_settlements WHERE id = target_settlement;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Settlement does not exist.';
  END IF;

  -- Ownership only ever moves after money has. This is the invariant that keeps a
  -- transfer from being triggered by an optimistic client.
  IF s.status <> 'paid' THEN
    RAISE EXCEPTION 'Cannot transfer a lot that is %, not paid.', s.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- aquadex_specimens.id is TEXT while auction token ids are INTEGER.
  UPDATE aquadex_specimens
     SET owner_address = lower(s.winner_wallet),
         updated_at = now()
   WHERE id = s.token_id::text
     AND lower(owner_address) = lower(s.seller_wallet);

  GET DIAGNOSTICS moved = ROW_COUNT;

  -- A missing or already-moved specimen must not silently look like success: the
  -- buyer has paid and is owed either the fish or a refund.
  IF moved = 0 THEN
    RAISE EXCEPTION 'Specimen % is no longer held by the seller — transfer needs manual review.', s.token_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE auction_settlements
     SET status = 'transferred', transferred_at = now()
   WHERE id = target_settlement;

  RETURN jsonb_build_object('token_id', s.token_id, 'new_owner', lower(s.winner_wallet));
END;
$$;

COMMENT ON FUNCTION transfer_auction_lot(UUID) IS
  'Moves a paid lot''s specimen to the winner. Refuses unless the settlement is paid, and refuses if the seller no longer holds it rather than reporting a transfer that did not happen.';

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE auction_settlements ENABLE ROW LEVEL SECURITY;

-- The two parties see their own settlements. Deliberately no client INSERT or
-- UPDATE: rows are written only by the functions above (SECURITY DEFINER) and by
-- the payment webhook running as the service role. A client that could write here
-- could mark its own lot paid.
DROP POLICY IF EXISTS "Settlement parties read their own" ON auction_settlements;
CREATE POLICY "Settlement parties read their own" ON auction_settlements
  FOR SELECT USING (
    current_wallet() IN (lower(winner_wallet), lower(seller_wallet))
  );
