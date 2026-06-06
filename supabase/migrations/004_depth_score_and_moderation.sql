-- ============================================================================
-- Migration 004: Depth Score + Content Moderation
-- Phase 4 of The Reef social layer
-- Creates: depth_score_events, moderation_flags
-- Adds: depth_score, depth_tier, poseidon_summary columns to profiles
-- ============================================================================

-- Add Depth Score columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS depth_score INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS depth_tier TEXT DEFAULT 'Shallow';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS poseidon_summary TEXT;

-- Add poseidon_narration to currents (for spawn threads)
ALTER TABLE currents ADD COLUMN IF NOT EXISTS poseidon_narration TEXT;

-- Add is_hidden flag for moderation
ALTER TABLE currents ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

-- Depth Score Events (history of all score changes)
CREATE TABLE IF NOT EXISTS depth_score_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'audit_given', 'audit_received', 'insight_upvote', 'spawn_success', 'trade_review', 'moderation_flag', 'mentee_progress', 'challenge_complete'
  source_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Moderation Flags
CREATE TABLE IF NOT EXISTS moderation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_wallet TEXT REFERENCES profiles(wallet_address),
  target_type TEXT NOT NULL CHECK (target_type IN ('current', 'comment', 'insight', 'school_chat', 'tide_chat', 'profile')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'misinformation', 'harassment', 'other')),
  details TEXT,
  auto_flagged BOOLEAN DEFAULT FALSE,
  ai_confidence REAL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewer_wallet TEXT,
  action_taken TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_depth_events_wallet ON depth_score_events(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_depth_events_source ON depth_score_events(source_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_status ON moderation_flags(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_target ON moderation_flags(target_type, target_id);

-- ============================================================================
-- Row-Level Security
-- ============================================================================

ALTER TABLE depth_score_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_flags ENABLE ROW LEVEL SECURITY;

-- Depth Score: users can read their own events, public read for leaderboard queries
CREATE POLICY "Users read own depth events" ON depth_score_events
  FOR SELECT USING (true);

-- Moderation Flags: reporters can see their own, curators see all (via service role)
CREATE POLICY "Users read own flags" ON moderation_flags
  FOR SELECT USING (reporter_wallet = auth.jwt()->>'wallet_address');

CREATE POLICY "Users can report content" ON moderation_flags
  FOR INSERT WITH CHECK (reporter_wallet = auth.jwt()->>'wallet_address');

-- ============================================================================
-- Depth Score trigger: auto-update profile on new event
-- ============================================================================

CREATE OR REPLACE FUNCTION update_depth_score()
RETURNS TRIGGER AS $$
DECLARE
  new_score INTEGER;
  new_tier TEXT;
BEGIN
  -- Calculate new total score
  SELECT COALESCE(SUM(delta), 0) INTO new_score
  FROM depth_score_events
  WHERE wallet_address = NEW.wallet_address;

  -- Determine tier
  IF new_score >= 5000 THEN new_tier := 'Hadal';
  ELSIF new_score >= 1500 THEN new_tier := 'Abyssal';
  ELSIF new_score >= 500 THEN new_tier := 'Pelagic';
  ELSIF new_score >= 100 THEN new_tier := 'Coastal';
  ELSE new_tier := 'Shallow';
  END IF;

  -- Update profile
  UPDATE profiles
  SET depth_score = new_score, depth_tier = new_tier
  WHERE wallet_address = NEW.wallet_address;

  -- Notify on tier change
  IF new_tier != (SELECT depth_tier FROM profiles WHERE wallet_address = NEW.wallet_address) THEN
    INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      NEW.wallet_address,
      'milestone',
      '🌊 Depth Tier Promoted!',
      'You''ve reached ' || new_tier || ' tier. New privileges unlocked!',
      '🌊',
      'profile',
      NEW.wallet_address
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_depth_score
  AFTER INSERT ON depth_score_events
  FOR EACH ROW
  EXECUTE FUNCTION update_depth_score();

-- ============================================================================
-- Depth Score triggers for existing actions
-- ============================================================================

-- On expert_audit creation: +15 for auditor, +10 for recipient
CREATE OR REPLACE FUNCTION depth_on_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO depth_score_events (wallet_address, delta, reason, source_type, source_id)
  VALUES
    (NEW.auditor_wallet, 15, 'Gave an Expert Audit', 'audit_given', NEW.id),
    (NEW.recipient_wallet, 10, 'Received an Expert Audit', 'audit_received', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_depth_on_audit
  AFTER INSERT ON expert_audits
  FOR EACH ROW
  EXECUTE FUNCTION depth_on_audit();

-- On species_insights getting upvoted past threshold
CREATE OR REPLACE FUNCTION depth_on_insight_vote()
RETURNS TRIGGER AS $$
BEGIN
  -- Award +5 depth when an insight hits 5+ net upvotes (upvotes - downvotes >= 5)
  IF NEW.upvotes - NEW.downvotes = 5 THEN
    INSERT INTO depth_score_events (wallet_address, delta, reason, source_type, source_id)
    VALUES (NEW.author_wallet, 5, 'Species Insight reached 5 net upvotes', 'insight_upvote', NEW.id);
  END IF;
  -- Award +10 at 15 net upvotes
  IF NEW.upvotes - NEW.downvotes = 15 THEN
    INSERT INTO depth_score_events (wallet_address, delta, reason, source_type, source_id)
    VALUES (NEW.author_wallet, 10, 'Species Insight reached 15 net upvotes', 'insight_upvote', NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_depth_on_insight_vote
  AFTER UPDATE ON species_insights
  FOR EACH ROW
  EXECUTE FUNCTION depth_on_insight_vote();

-- On moderation flag actioned: -50 for the flagged user
CREATE OR REPLACE FUNCTION depth_on_moderation()
RETURNS TRIGGER AS $$
DECLARE
  target_wallet TEXT;
BEGIN
  IF NEW.status = 'actioned' AND OLD.status != 'actioned' THEN
    -- Get the target content's author
    IF NEW.target_type = 'current' THEN
      SELECT author_wallet INTO target_wallet FROM currents WHERE id = NEW.target_id;
    ELSIF NEW.target_type = 'comment' THEN
      SELECT author_wallet INTO target_wallet FROM comments WHERE id = NEW.target_id;
    ELSIF NEW.target_type = 'insight' THEN
      SELECT author_wallet INTO target_wallet FROM species_insights WHERE id = NEW.target_id;
    END IF;

    IF target_wallet IS NOT NULL THEN
      INSERT INTO depth_score_events (wallet_address, delta, reason, source_type, source_id)
      VALUES (target_wallet, -50, 'Content moderation action', 'moderation_flag', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_depth_on_moderation
  AFTER UPDATE ON moderation_flags
  FOR EACH ROW
  EXECUTE FUNCTION depth_on_moderation();
