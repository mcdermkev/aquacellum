-- ═══════════════════════════════════════════════════════════════════════════
-- A bid is a commitment: require a card on file before bidding
--
-- ── THE DECISION, AND WHY IT IS THIS ONE ────────────────────────────────────
--
-- The obvious way to handle a winner who does not pay is to punish it after the
-- fact: payment windows, strikes, reputation scores, bans. Every one of those
-- systems still contains the moment where the winner CHOOSES whether to pay, and
-- that moment is the exploit. You cannot police it away; bidding stays free and
-- walking away stays cheap.
--
-- So the choice is removed instead. To bid you must have a payment method saved
-- (a Stripe SetupIntent — authorisation to charge later, no charge now). When the
-- lot closes the winner is charged automatically, off-session. There is no step
-- at which anyone decides whether to honour their bid.
--
-- This is also LESS machinery than the alternative: no strike counter, no
-- reputation model, no deadbeat dispute queue. And it matches what people already
-- expect from eBay, Whatnot and every livestock auction.
--
-- The tradeoff, stated plainly: it adds friction before a first bid and will
-- reduce casual bidding. For rare fish going for real money that is the right
-- trade — casual bids are precisely what an auction does not want.
--
-- A failed charge is treated as an ERROR, not a refusal: expired card,
-- insufficient funds, 3DS. The winner gets a bounded window to fix it, and only
-- then does the lot fall to the next bidder via forfeit_auction_settlement. That
-- failure rate is far lower than voluntary walk-away, and a decline is an honest
-- problem rather than someone gaming the auction.
--
-- ── SAFE TO ADD NOW ─────────────────────────────────────────────────────────
--
-- Verified immediately before applying: 0 bids, 0 tides with lots, 0 settlements.
-- Auctions are unreachable in production, so a new bidding precondition cannot
-- interrupt anything in flight. It ships in the same change as the setup-intent
-- endpoint that lets someone save a card.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS buyer_payment_methods (
  wallet_address     TEXT PRIMARY KEY REFERENCES profiles(wallet_address) ON DELETE CASCADE,

  -- Stripe Customer for this wallet. One per wallet, reused across auctions.
  stripe_customer_id TEXT NOT NULL,
  -- The default saved card. Null while a SetupIntent is still in progress, which
  -- is why the bidding check tests payment_method_id and not mere row existence.
  payment_method_id  TEXT,

  -- Display only, so the UI can say "Visa ending 4242" without calling Stripe.
  -- Never store a full card number; Stripe holds the instrument.
  brand              TEXT,
  last4              TEXT,
  exp_month          SMALLINT,
  exp_year           SMALLINT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT buyer_payment_methods_last4_shape
    CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$')
);

COMMENT ON TABLE buyer_payment_methods IS
  'A wallet''s saved Stripe payment method, required before bidding in an auction. Holds only Stripe ids plus brand/last4 for display — never card data.';

-- ── Bidding requires a usable card ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_bidder_has_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM buyer_payment_methods p
     WHERE lower(p.wallet_address) = lower(NEW.bidder_wallet)
       AND p.payment_method_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Add a payment method before bidding — the winning bid is charged automatically when the lot closes.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Runs BEFORE the existing rules trigger by name order (enforce_ < trg_), which
-- is deliberate: "you have no card" is a clearer first message than a reserve or
-- increment complaint.
DROP TRIGGER IF EXISTS aaa_enforce_bidder_payment_method ON auction_bids;
CREATE TRIGGER aaa_enforce_bidder_payment_method
  BEFORE INSERT ON auction_bids
  FOR EACH ROW EXECUTE FUNCTION enforce_bidder_has_payment_method();

COMMENT ON FUNCTION enforce_bidder_has_payment_method() IS
  'Requires a saved Stripe payment method before a bid is accepted. This is the anti-gaming mechanism: it removes the moment a winner decides whether to pay, rather than penalising non-payment afterwards.';

-- ── Settlement payment outcomes ────────────────────────────────────────────
--
-- Called by api/stripe.js with the service role after charging. Functions rather
-- than direct UPDATEs so the state transitions stay guarded — auction_settlements
-- has no client INSERT/UPDATE policy at all.
CREATE OR REPLACE FUNCTION mark_auction_settlement_paid(
  target_settlement UUID,
  payment_intent    TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s auction_settlements;
BEGIN
  SELECT * INTO s FROM auction_settlements WHERE id = target_settlement;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Settlement does not exist.';
  END IF;

  -- Idempotent: Stripe retries webhooks, and a duplicate delivery must not look
  -- like a second payment.
  IF s.status IN ('paid', 'transferred') THEN
    RETURN jsonb_build_object('already_paid', true, 'settlement_id', s.id);
  END IF;

  IF s.status IN ('forfeited', 'unsold') THEN
    RAISE EXCEPTION 'Cannot pay a settlement that is %.', s.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE auction_settlements
     SET status = 'paid',
         paid_at = now(),
         stripe_payment_intent = payment_intent,
         last_error = NULL
   WHERE id = target_settlement;

  RETURN jsonb_build_object('paid', true, 'settlement_id', s.id, 'amount_cents', s.amount_cents);
END;
$$;

CREATE OR REPLACE FUNCTION record_auction_payment_failure(
  target_settlement UUID,
  failure_reason    TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s auction_settlements;
BEGIN
  SELECT * INTO s FROM auction_settlements WHERE id = target_settlement;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Settlement does not exist.';
  END IF;

  IF s.status IN ('paid', 'transferred') THEN
    RAISE EXCEPTION 'That lot is already paid — refusing to record a failure against it.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- payment_failed, not forfeited. A decline is an error the winner can fix
  -- inside their window; only the deadline sweep forfeits the lot.
  UPDATE auction_settlements
     SET status = 'payment_failed',
         attempts = attempts + 1,
         last_error = failure_reason
   WHERE id = target_settlement;

  RETURN jsonb_build_object(
    'settlement_id', s.id,
    'attempts', s.attempts + 1,
    'deadline', s.payment_deadline
  );
END;
$$;

-- ── The deadline sweep ─────────────────────────────────────────────────────
--
-- Forfeits every settlement whose window has closed without payment, promoting
-- the next bidder on each. Written as a callable function rather than a cron job:
-- this project has no scheduler, and a stored deadline that nothing acts on is
-- the same failure as tides.status sitting LIVE forever. Called from the auction
-- panel and from settlement, so it runs whenever anyone looks.
CREATE OR REPLACE FUNCTION sweep_overdue_auction_settlements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; swept jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT id FROM auction_settlements
     WHERE status IN ('awaiting_payment', 'payment_failed')
       AND payment_deadline IS NOT NULL
       AND payment_deadline < now()
  LOOP
    swept := swept || jsonb_build_object(
      'settlement_id', r.id,
      'result', forfeit_auction_settlement(r.id, 'Payment window expired')
    );
  END LOOP;

  RETURN swept;
END;
$$;

COMMENT ON FUNCTION sweep_overdue_auction_settlements() IS
  'Forfeits settlements past their payment deadline and promotes the next bidder. A function rather than a cron job because the project has no scheduler and an unenforced deadline is worse than none.';

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE buyer_payment_methods ENABLE ROW LEVEL SECURITY;

-- Read your own card summary. No client INSERT or UPDATE: rows are written only
-- by api/stripe.js with the service role after Stripe confirms a SetupIntent. A
-- client that could write here could claim a card it does not have and bid
-- without one.
DROP POLICY IF EXISTS "Own payment method" ON buyer_payment_methods;
CREATE POLICY "Own payment method" ON buyer_payment_methods
  FOR SELECT USING (lower(wallet_address) = current_wallet());
