-- ============================================================================
-- Migration 003: Tides (Events) Tables
-- Phase 3 of The Reef social layer
-- Creates: tides, tide_attendees, tide_chat, auction_bids
-- ============================================================================

-- Tides (Social layer on top of on-chain LiveEvent)
CREATE TABLE IF NOT EXISTS tides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  on_chain_event_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  tide_type TEXT NOT NULL CHECK (tide_type IN ('expo', 'virtual', 'challenge', 'auction')),
  host_wallet TEXT REFERENCES profiles(wallet_address),
  host_school_id UUID REFERENCES schools(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  gps_bounds JSONB,
  zone_hash TEXT,
  banner_url TEXT,
  stream_url TEXT,
  max_attendees INTEGER,
  settings JSONB DEFAULT '{}',
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended', 'cancelled')),
  recap_content JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tide RSVPs / Attendees
CREATE TABLE IF NOT EXISTS tide_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id UUID REFERENCES tides(id) ON DELETE CASCADE,
  wallet_address TEXT REFERENCES profiles(wallet_address),
  rsvp_status TEXT DEFAULT 'going' CHECK (rsvp_status IN ('going', 'interested', 'checked_in')),
  bringing_species JSONB DEFAULT '[]',
  checked_in_at TIMESTAMPTZ,
  xp_awarded BOOLEAN DEFAULT FALSE,
  UNIQUE(tide_id, wallet_address)
);

-- Tide Chat (ephemeral — auto-deleted 48h after event ends)
CREATE TABLE IF NOT EXISTS tide_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id UUID REFERENCES tides(id) ON DELETE CASCADE,
  author_wallet TEXT REFERENCES profiles(wallet_address),
  body TEXT NOT NULL CHECK (char_length(body) <= 300),
  is_system_message BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auction Bids (for Auction Tides)
CREATE TABLE IF NOT EXISTS auction_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id UUID REFERENCES tides(id) ON DELETE CASCADE,
  token_id INTEGER NOT NULL,
  bidder_wallet TEXT REFERENCES profiles(wallet_address),
  amount_wei TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'outbid', 'won', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tides_status_start ON tides(status, start_time);
CREATE INDEX IF NOT EXISTS idx_tides_host ON tides(host_wallet);
CREATE INDEX IF NOT EXISTS idx_tides_type ON tides(tide_type);
CREATE INDEX IF NOT EXISTS idx_tide_attendees_wallet ON tide_attendees(wallet_address);
CREATE INDEX IF NOT EXISTS idx_tide_attendees_tide ON tide_attendees(tide_id);
CREATE INDEX IF NOT EXISTS idx_tide_chat_tide ON tide_chat(tide_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auction_bids_tide_token ON auction_bids(tide_id, token_id, created_at DESC);

-- ============================================================================
-- Row-Level Security
-- ============================================================================

ALTER TABLE tides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tide_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tide_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;

-- Tides: public read, host can manage
CREATE POLICY "Tides publicly readable" ON tides
  FOR SELECT USING (true);

CREATE POLICY "Hosts manage own tides" ON tides
  FOR ALL USING (host_wallet = auth.jwt()->>'wallet_address');

-- Tide Attendees: public read for attendee counts, self-managed RSVP
CREATE POLICY "Attendees publicly readable" ON tide_attendees
  FOR SELECT USING (true);

CREATE POLICY "Users manage own RSVP" ON tide_attendees
  FOR ALL USING (wallet_address = auth.jwt()->>'wallet_address');

-- Tide Chat: readable by attendees, writable by attendees
CREATE POLICY "Tide chat readable by attendees" ON tide_chat
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tide_attendees
      WHERE tide_id = tide_chat.tide_id
      AND wallet_address = auth.jwt()->>'wallet_address'
    )
  );

CREATE POLICY "Tide chat writable by attendees" ON tide_chat
  FOR INSERT WITH CHECK (
    author_wallet = auth.jwt()->>'wallet_address'
    AND EXISTS (
      SELECT 1 FROM tide_attendees
      WHERE tide_id = tide_chat.tide_id
      AND wallet_address = auth.jwt()->>'wallet_address'
    )
  );

-- Auction Bids: readable by participants, writable by authenticated users
CREATE POLICY "Auction bids readable" ON auction_bids
  FOR SELECT USING (true);

CREATE POLICY "Users place own bids" ON auction_bids
  FOR INSERT WITH CHECK (bidder_wallet = auth.jwt()->>'wallet_address');

-- ============================================================================
-- Notification triggers for Tides
-- ============================================================================

-- Trigger: notify RSVPs when tide goes live
CREATE OR REPLACE FUNCTION notify_tide_live()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'live' AND OLD.status = 'upcoming' THEN
    INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    SELECT
      ta.wallet_address,
      'event',
      '🌊 ' || NEW.title || ' is LIVE!',
      'The tide has started — dive in now!',
      '🌊',
      'tide',
      NEW.id
    FROM tide_attendees ta
    WHERE ta.tide_id = NEW.id
    AND ta.rsvp_status IN ('going', 'interested');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tide_live
  AFTER UPDATE ON tides
  FOR EACH ROW
  EXECUTE FUNCTION notify_tide_live();

-- Trigger: notify previous bidder when outbid
CREATE OR REPLACE FUNCTION notify_outbid()
RETURNS TRIGGER AS $$
DECLARE
  prev_bidder TEXT;
  tide_title TEXT;
BEGIN
  -- Find the previous highest bidder for this token in this tide
  SELECT bidder_wallet INTO prev_bidder
  FROM auction_bids
  WHERE tide_id = NEW.tide_id
    AND token_id = NEW.token_id
    AND id != NEW.id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF prev_bidder IS NOT NULL AND prev_bidder != NEW.bidder_wallet THEN
    -- Mark previous bid as outbid
    UPDATE auction_bids
    SET status = 'outbid'
    WHERE tide_id = NEW.tide_id
      AND token_id = NEW.token_id
      AND bidder_wallet = prev_bidder
      AND status = 'active';

    -- Get tide title for notification
    SELECT title INTO tide_title FROM tides WHERE id = NEW.tide_id;

    -- Notify previous bidder
    INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      prev_bidder,
      'event',
      '⚡ You''ve been outbid!',
      'Someone placed a higher bid in ' || COALESCE(tide_title, 'an auction'),
      '⚡',
      'tide',
      NEW.tide_id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_outbid_notification
  AFTER INSERT ON auction_bids
  FOR EACH ROW
  EXECUTE FUNCTION notify_outbid();
