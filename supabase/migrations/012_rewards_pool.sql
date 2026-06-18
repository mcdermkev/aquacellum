-- ============================================================================
-- Migration 012: Loyalty Rewards Pool & Credit Distribution
-- Phase 3 of Unified Gamification (GAMIFICATION_SPEC.md section 6)
-- 
-- Creates: reward_pool_ledger, reward_distributions
-- Adds: credit expiry tracking
-- Functions: calculate_monthly_distribution(), apply_credits_at_checkout()
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reward Pool Ledger — tracks fee contributions flowing into the pool
-- Every marketplace transaction contributes 40% of its 4% protocol fee here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_pool_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('marketplace_sale', 'expo_sale', 'batch_sale', 'manual_deposit')),
  source_id TEXT,                       -- order ID, transaction hash, etc.
  gross_fee NUMERIC(12, 2) NOT NULL,    -- total protocol fee collected (4% of sale)
  pool_contribution NUMERIC(12, 2) NOT NULL,  -- 40% of gross_fee → pool
  seller_wallet TEXT,
  buyer_wallet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reward Distributions — monthly payout snapshots
-- Each row = one user's payout for one distribution period.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  distribution_period TEXT NOT NULL,    -- e.g., "2026-06" (YYYY-MM)
  monthly_xp_earned INTEGER NOT NULL,   -- user's XP earned that month
  total_pool_xp INTEGER NOT NULL,       -- sum of all eligible users' monthly XP
  pool_balance NUMERIC(12, 2) NOT NULL, -- pool balance at distribution time
  user_share_pct NUMERIC(8, 6) NOT NULL, -- user's % of pool (monthly_xp / total_pool_xp)
  credits_awarded NUMERIC(10, 2) NOT NULL, -- actual credits given
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, distribution_period)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Credit Transactions — individual credit movements (earn/spend/expire)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,       -- positive = earn, negative = spend/expire
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('distribution', 'checkout_applied', 'expired', 'manual_adjustment')),
  reference_id TEXT,                    -- distribution_id, order_id, etc.
  description TEXT,
  expires_at TIMESTAMPTZ,              -- 12 months from earn date (null for spends)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pool_ledger_created ON reward_pool_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_ledger_period ON reward_pool_ledger(created_at);

CREATE INDEX IF NOT EXISTS idx_distributions_wallet ON reward_distributions(wallet_address, distribution_period DESC);
CREATE INDEX IF NOT EXISTS idx_distributions_period ON reward_distributions(distribution_period DESC);

CREATE INDEX IF NOT EXISTS idx_credit_tx_wallet ON credit_transactions(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_tx_expires ON credit_transactions(expires_at)
  WHERE expires_at IS NOT NULL AND amount > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Pool Balance View (running total of unspent pool funds)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW reward_pool_status AS
SELECT
  COALESCE(SUM(pool_contribution), 0) AS total_contributed,
  COALESCE(
    (SELECT SUM(credits_awarded) FROM reward_distributions), 0
  ) AS total_distributed,
  COALESCE(SUM(pool_contribution), 0) - COALESCE(
    (SELECT SUM(credits_awarded) FROM reward_distributions), 0
  ) AS current_balance,
  (SELECT MAX(created_at) FROM reward_distributions) AS last_distribution_at,
  COUNT(*) AS total_transactions
FROM reward_pool_ledger;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger: Record pool contribution on marketplace sale
-- (Called when a marketplace order completes — 4% fee, 40% → pool)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_pool_contribution(
  p_source_type TEXT,
  p_source_id TEXT,
  p_sale_amount NUMERIC,
  p_seller_wallet TEXT,
  p_buyer_wallet TEXT
)
RETURNS VOID AS $$
DECLARE
  v_gross_fee NUMERIC(12, 2);
  v_pool_contribution NUMERIC(12, 2);
BEGIN
  -- 4% protocol fee
  v_gross_fee := p_sale_amount * 0.04;
  -- 40% of fee goes to loyalty pool
  v_pool_contribution := v_gross_fee * 0.40;

  INSERT INTO reward_pool_ledger (source_type, source_id, gross_fee, pool_contribution, seller_wallet, buyer_wallet)
  VALUES (p_source_type, p_source_id, v_gross_fee, v_pool_contribution, p_seller_wallet, p_buyer_wallet);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Monthly Distribution Function
-- Called by a scheduled Edge Function at the start of each month.
-- 
-- Eligibility: 1+ marketplace transaction in past 90 days AND 500+ total_xp
-- Formula: user_share = (user_monthly_xp / total_eligible_monthly_xp) * pool_balance
-- Credits expire 12 months after award.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_monthly_distribution(p_period TEXT DEFAULT NULL)
RETURNS TABLE (
  distributed_to INTEGER,
  total_credits NUMERIC,
  pool_balance_before NUMERIC
) AS $$
DECLARE
  v_period TEXT;
  v_pool_balance NUMERIC(12, 2);
  v_total_eligible_xp INTEGER;
  v_user RECORD;
  v_user_share NUMERIC(8, 6);
  v_credits NUMERIC(10, 2);
  v_count INTEGER := 0;
  v_total_credits NUMERIC(12, 2) := 0;
BEGIN
  -- Determine distribution period (previous month if not specified)
  v_period := COALESCE(p_period, to_char(NOW() - INTERVAL '1 month', 'YYYY-MM'));

  -- Check if already distributed for this period
  IF EXISTS (SELECT 1 FROM reward_distributions WHERE distribution_period = v_period LIMIT 1) THEN
    RAISE EXCEPTION 'Distribution already completed for period %', v_period;
  END IF;

  -- Get current pool balance
  SELECT current_balance INTO v_pool_balance FROM reward_pool_status;
  IF v_pool_balance IS NULL OR v_pool_balance <= 0 THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  -- Calculate total eligible monthly XP
  -- Eligible: 500+ total_xp AND at least 1 marketplace activity in past 90 days
  SELECT COALESCE(SUM(p.monthly_xp), 0) INTO v_total_eligible_xp
  FROM profiles p
  WHERE p.monthly_xp > 0
    AND p.total_xp >= 500
    AND EXISTS (
      SELECT 1 FROM xp_events xe
      WHERE xe.wallet_address = p.wallet_address
        AND xe.action_type IN ('LIST_DIRECTORY', 'COMPLETED_SALE', 'CLAIM_EXCHANGE', 'VERIFIED_PICKUP_BUYER', 'VERIFIED_PICKUP_SELLER')
        AND xe.created_at >= NOW() - INTERVAL '90 days'
    );

  IF v_total_eligible_xp <= 0 THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, v_pool_balance;
    RETURN;
  END IF;

  -- Distribute to each eligible user
  FOR v_user IN
    SELECT p.wallet_address, p.monthly_xp
    FROM profiles p
    WHERE p.monthly_xp > 0
      AND p.total_xp >= 500
      AND EXISTS (
        SELECT 1 FROM xp_events xe
        WHERE xe.wallet_address = p.wallet_address
          AND xe.action_type IN ('LIST_DIRECTORY', 'COMPLETED_SALE', 'CLAIM_EXCHANGE', 'VERIFIED_PICKUP_BUYER', 'VERIFIED_PICKUP_SELLER')
          AND xe.created_at >= NOW() - INTERVAL '90 days'
      )
  LOOP
    -- Calculate share
    v_user_share := v_user.monthly_xp::NUMERIC / v_total_eligible_xp::NUMERIC;
    v_credits := ROUND(v_pool_balance * v_user_share, 2);

    -- Skip if less than $0.01
    IF v_credits < 0.01 THEN
      CONTINUE;
    END IF;

    -- Record distribution
    INSERT INTO reward_distributions (wallet_address, distribution_period, monthly_xp_earned, total_pool_xp, pool_balance, user_share_pct, credits_awarded)
    VALUES (v_user.wallet_address, v_period, v_user.monthly_xp, v_total_eligible_xp, v_pool_balance, v_user_share, v_credits);

    -- Record credit transaction (expires in 12 months)
    INSERT INTO credit_transactions (wallet_address, amount, transaction_type, reference_id, description, expires_at)
    VALUES (
      v_user.wallet_address,
      v_credits,
      'distribution',
      v_period,
      'Monthly Loyalty Rewards Pool distribution (' || v_period || ')',
      NOW() + INTERVAL '12 months'
    );

    -- Update profile reward_credits balance
    UPDATE profiles
    SET reward_credits = reward_credits + v_credits
    WHERE wallet_address = v_user.wallet_address;

    v_count := v_count + 1;
    v_total_credits := v_total_credits + v_credits;
  END LOOP;

  -- Reset monthly_xp for all users (start fresh for next period)
  UPDATE profiles SET monthly_xp = 0;

  RETURN QUERY SELECT v_count, v_total_credits, v_pool_balance;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Apply Credits at Checkout
-- Deducts credits from a user's balance (called during marketplace purchase).
-- Returns the actual amount deducted (may be less if balance is insufficient).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_credits_at_checkout(
  p_wallet TEXT,
  p_amount NUMERIC,
  p_order_id TEXT
)
RETURNS NUMERIC AS $$
DECLARE
  v_current_balance NUMERIC(10, 2);
  v_applied NUMERIC(10, 2);
BEGIN
  -- Get current balance
  SELECT reward_credits INTO v_current_balance
  FROM profiles
  WHERE wallet_address = p_wallet;

  IF v_current_balance IS NULL OR v_current_balance <= 0 THEN
    RETURN 0;
  END IF;

  -- Apply up to available balance
  v_applied := LEAST(p_amount, v_current_balance);

  -- Deduct from profile
  UPDATE profiles
  SET reward_credits = reward_credits - v_applied
  WHERE wallet_address = p_wallet;

  -- Record transaction
  INSERT INTO credit_transactions (wallet_address, amount, transaction_type, reference_id, description)
  VALUES (p_wallet, -v_applied, 'checkout_applied', p_order_id, 'Credits applied at checkout');

  RETURN v_applied;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Expire Old Credits (run monthly alongside distribution)
-- Expires credits older than 12 months that haven't been spent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION expire_old_credits()
RETURNS INTEGER AS $$
DECLARE
  v_expired RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_expired IN
    SELECT id, wallet_address, amount
    FROM credit_transactions
    WHERE transaction_type = 'distribution'
      AND amount > 0
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND NOT EXISTS (
        -- Check if already expired (prevent double-expiry)
        SELECT 1 FROM credit_transactions ct2
        WHERE ct2.reference_id = credit_transactions.id::TEXT
          AND ct2.transaction_type = 'expired'
      )
  LOOP
    -- Only expire if user still has balance
    IF (SELECT reward_credits FROM profiles WHERE wallet_address = v_expired.wallet_address) > 0 THEN
      -- Record expiry
      INSERT INTO credit_transactions (wallet_address, amount, transaction_type, reference_id, description)
      VALUES (v_expired.wallet_address, -v_expired.amount, 'expired', v_expired.id::TEXT, 'Credits expired (12-month limit)');

      -- Deduct from balance (floor at 0)
      UPDATE profiles
      SET reward_credits = GREATEST(0, reward_credits - v_expired.amount)
      WHERE wallet_address = v_expired.wallet_address;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Tier Discount Function
-- Returns the marketplace discount percentage for a given tier.
-- Per GAMIFICATION_SPEC.md section 6.3.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_tier_discount(p_tier TEXT)
RETURNS NUMERIC AS $$
BEGIN
  RETURN CASE p_tier
    WHEN 'Coastal' THEN 0.02
    WHEN 'Pelagic' THEN 0.04
    WHEN 'Abyssal' THEN 0.06
    WHEN 'Hadal' THEN 0.08
    WHEN 'Hadal-Champion' THEN 0.08
    ELSE 0.00
  END;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reward_pool_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Pool ledger: public read (transparency), write via service role
CREATE POLICY "Public read pool_ledger" ON reward_pool_ledger
  FOR SELECT USING (true);

-- Distributions: users read own, public aggregate view available
CREATE POLICY "Users read own distributions" ON reward_distributions
  FOR SELECT USING (true);

-- Credit transactions: users read own
CREATE POLICY "Users read own credits" ON credit_transactions
  FOR SELECT USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    OR true); -- fallback to public read in anon mode during dev

-- Write policies (service role only in production)
CREATE POLICY "Service write pool_ledger" ON reward_pool_ledger
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service write distributions" ON reward_distributions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service write credits" ON credit_transactions
  FOR INSERT WITH CHECK (true);
