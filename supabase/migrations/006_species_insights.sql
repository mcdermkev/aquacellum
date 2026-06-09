-- ============================================================================
-- Species Insights — Micro-content system for species pages
-- Short tips (280 chars), categorized, upvotable/downvotable
-- ============================================================================

CREATE TABLE species_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  spec_code INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('care_tip', 'warning', 'breeding_note', 'compatibility', 'behavior')),
  body TEXT NOT NULL CHECK (char_length(body) <= 280),
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  author_depth_tier TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_insights_spec ON species_insights(spec_code, upvotes DESC);
CREATE INDEX idx_insights_author ON species_insights(author_wallet);

-- RLS
ALTER TABLE species_insights ENABLE ROW LEVEL SECURITY;

-- Anyone can read insights
CREATE POLICY "Anyone can read species insights" ON species_insights FOR SELECT USING (true);

-- Dev: allow inserts and updates (production will use JWT-based policies)
CREATE POLICY "dev_insights_insert" ON species_insights FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_insights_update" ON species_insights FOR UPDATE USING (true);
CREATE POLICY "dev_insights_delete" ON species_insights FOR DELETE USING (true);
