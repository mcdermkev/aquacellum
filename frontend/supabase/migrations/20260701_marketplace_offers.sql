-- Marketplace Offers (Bid System)
-- Buyers can make below-asking offers on listings. Sellers can accept/decline/counter.

CREATE TABLE IF NOT EXISTS marketplace_offers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id TEXT NOT NULL,
  listing_type TEXT NOT NULL DEFAULT 'specimen', -- 'specimen' or 'batch'
  seller_wallet TEXT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  buyer_name TEXT,
  species_name TEXT,
  asking_price_usd NUMERIC(10, 2) NOT NULL,
  offer_price_usd NUMERIC(10, 2) NOT NULL,
  counter_price_usd NUMERIC(10, 2), -- seller's counter offer (optional)
  message TEXT, -- buyer's message to seller
  seller_response TEXT, -- seller's response message
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'countered', 'expired', 'withdrawn'
  created_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_offers_seller ON marketplace_offers(seller_wallet, status);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON marketplace_offers(buyer_wallet, status);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON marketplace_offers(listing_id, status);

-- RLS: sellers can read offers on their listings, buyers can read their own offers
ALTER TABLE marketplace_offers ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to insert offers (buyer creates offer)
CREATE POLICY "Buyers can create offers"
  ON marketplace_offers FOR INSERT
  WITH CHECK (true);

-- Allow reading: seller sees offers on their listings, buyer sees their own
CREATE POLICY "Users can read relevant offers"
  ON marketplace_offers FOR SELECT
  USING (
    seller_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
    OR buyer_wallet = current_setting('request.headers', true)::json->>'x-wallet-address'
  );

-- Allow seller to update offer status (accept/decline/counter)
CREATE POLICY "Sellers can respond to offers"
  ON marketplace_offers FOR UPDATE
  USING (seller_wallet = current_setting('request.headers', true)::json->>'x-wallet-address');
