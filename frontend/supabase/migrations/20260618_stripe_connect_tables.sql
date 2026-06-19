-- =============================================================================
-- Stripe Connect Integration Tables
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL)
-- =============================================================================

-- Seller Stripe Connected Accounts
-- Maps on-chain wallet addresses to Stripe Express account IDs.
-- One row per seller; created during Stripe Connect onboarding.
CREATE TABLE IF NOT EXISTS seller_stripe_accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  charges_enabled BOOLEAN DEFAULT FALSE,
  payouts_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by wallet (used on every checkout)
CREATE INDEX IF NOT EXISTS idx_seller_stripe_wallet ON seller_stripe_accounts(wallet_address);
CREATE INDEX IF NOT EXISTS idx_seller_stripe_account_id ON seller_stripe_accounts(stripe_account_id);

-- Fiat Settlement Records
-- Audit trail of every fiat purchase → on-chain settlement.
-- Created by the webhook after Stripe confirms payment.
CREATE TABLE IF NOT EXISTS fiat_settlements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_payment_intent_id TEXT NOT NULL UNIQUE,
  stripe_payment_hash TEXT,
  purchase_type TEXT NOT NULL CHECK (purchase_type IN ('specimen', 'shipping', 'batch', 'multi')),
  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  amount_cents_usd INTEGER NOT NULL,
  platform_fee_cents INTEGER,
  tx_hash TEXT,
  block_number BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'failed', 'disputed', 'refunded')),
  error_message TEXT,
  metadata JSONB,
  disputed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_fiat_settlements_buyer ON fiat_settlements(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_fiat_settlements_seller ON fiat_settlements(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_fiat_settlements_status ON fiat_settlements(status);
CREATE INDEX IF NOT EXISTS idx_fiat_settlements_stripe_pi ON fiat_settlements(stripe_payment_intent_id);

-- Row Level Security (RLS)
-- Enable RLS so only authenticated service role can write, anon can read own records.
ALTER TABLE seller_stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiat_settlements ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by Vercel serverless functions)
CREATE POLICY "Service role full access on seller_stripe_accounts"
  ON seller_stripe_accounts
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fiat_settlements"
  ON fiat_settlements
  FOR ALL
  USING (auth.role() = 'service_role');

-- Anon users can read their own settlement records (by wallet)
CREATE POLICY "Users can view own settlements"
  ON fiat_settlements
  FOR SELECT
  USING (
    buyer_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address'
    OR seller_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address'
  );

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_seller_stripe_accounts_updated_at
  BEFORE UPDATE ON seller_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
