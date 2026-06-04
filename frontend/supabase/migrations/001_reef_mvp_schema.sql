-- ============================================================================
-- The Reef — MVP Schema Migration
-- Run this in your Supabase SQL Editor after creating the project.
-- ============================================================================

-- 1. PROFILES
CREATE TABLE profiles (
  wallet_address TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 280),
  privacy_settings JSONB DEFAULT '{"tanks": "public", "activity": "public"}',
  tank_count INTEGER DEFAULT 0,
  species_count INTEGER DEFAULT 0,
  xp_total INTEGER DEFAULT 0,
  companion_tier TEXT DEFAULT 'Bronze',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CURRENTS (Tank posts)
CREATE TABLE currents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  title TEXT,
  body TEXT CHECK (char_length(body) <= 2000),
  media_urls JSONB DEFAULT '[]',
  linked_tank_id TEXT,
  linked_tank_name TEXT,
  species_tags JSONB DEFAULT '[]',
  parameters_snapshot JSONB,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'tankmates', 'private')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. REACTIONS
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES currents(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('🔥', '🐟', '💧', '🌿', '👏', '⭐')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_wallet, target_id, emoji)
);

-- 4. COMMENTS (threaded, 1 level)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  current_id UUID NOT NULL REFERENCES currents(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. FOLLOWS / CONNECTIONS
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  follow_type TEXT NOT NULL CHECK (follow_type IN ('tankmate', 'watch_tank')),
  target_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_tank_id TEXT,
  is_mutual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_wallet, follow_type, target_wallet, target_tank_id)
);

-- 6. TANKMATE REQUESTS
CREATE TABLE connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  to_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  message TEXT CHECK (char_length(message) <= 200),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_wallet, to_wallet)
);

-- 7. NOTIFICATIONS (Sonar)
CREATE TABLE sonar_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('activity', 'social', 'milestone')),
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT,
  link_type TEXT,
  link_id TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_currents_author ON currents(author_wallet, created_at DESC);
CREATE INDEX idx_currents_visibility ON currents(visibility, created_at DESC);
CREATE INDEX idx_reactions_target ON reactions(target_id);
CREATE INDEX idx_comments_current ON comments(current_id, created_at);
CREATE INDEX idx_follows_follower ON follows(follower_wallet);
CREATE INDEX idx_follows_target ON follows(target_wallet);
CREATE INDEX idx_notifications_recipient ON sonar_notifications(recipient_wallet, is_read, created_at DESC);
CREATE INDEX idx_connection_requests_to ON connection_requests(to_wallet, status);


-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read profiles" 
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users insert own profile" 
  ON profiles FOR INSERT 
  WITH CHECK (wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users update own profile" 
  ON profiles FOR UPDATE 
  USING (wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- CURRENTS
ALTER TABLE currents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public currents readable" 
  ON currents FOR SELECT 
  USING (
    visibility = 'public' 
    OR author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );

CREATE POLICY "Authors insert own currents" 
  ON currents FOR INSERT 
  WITH CHECK (author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Authors update own currents" 
  ON currents FOR UPDATE 
  USING (author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Authors delete own currents" 
  ON currents FOR DELETE 
  USING (author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- REACTIONS
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read reactions" 
  ON reactions FOR SELECT USING (true);

CREATE POLICY "Users insert own reactions" 
  ON reactions FOR INSERT 
  WITH CHECK (user_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users delete own reactions" 
  ON reactions FOR DELETE 
  USING (user_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- COMMENTS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read comments" 
  ON comments FOR SELECT USING (true);

CREATE POLICY "Users post comments" 
  ON comments FOR INSERT 
  WITH CHECK (author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users delete own comments" 
  ON comments FOR DELETE 
  USING (author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- FOLLOWS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read follows" 
  ON follows FOR SELECT USING (true);

CREATE POLICY "Users manage own follows" 
  ON follows FOR INSERT 
  WITH CHECK (follower_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users remove own follows" 
  ON follows FOR DELETE 
  USING (follower_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- CONNECTION REQUESTS
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can read requests" 
  ON connection_requests FOR SELECT 
  USING (
    from_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address') 
    OR to_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );

CREATE POLICY "Users send requests" 
  ON connection_requests FOR INSERT 
  WITH CHECK (from_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Recipients can update requests" 
  ON connection_requests FOR UPDATE 
  USING (to_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- NOTIFICATIONS
ALTER TABLE sonar_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" 
  ON sonar_notifications FOR SELECT 
  USING (recipient_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users update own notifications" 
  ON sonar_notifications FOR UPDATE 
  USING (recipient_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- NOTE: Notification inserts are done by Edge Functions using service_role key,
-- not by clients directly. No INSERT policy needed for client access.


-- ============================================================================
-- NOTIFICATION TRIGGERS (Auto-dispatch on social actions)
-- ============================================================================

-- Helper function to insert a notification
CREATE OR REPLACE FUNCTION dispatch_notification(
  p_recipient TEXT,
  p_category TEXT,
  p_title TEXT,
  p_body TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT '🔔',
  p_link_type TEXT DEFAULT NULL,
  p_link_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
  VALUES (p_recipient, p_category, p_title, p_body, p_icon, p_link_type, p_link_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Notify on new reaction
CREATE OR REPLACE FUNCTION notify_on_reaction() RETURNS TRIGGER AS $$
DECLARE
  v_author TEXT;
  v_reactor_name TEXT;
BEGIN
  -- Get the current's author
  SELECT author_wallet INTO v_author FROM currents WHERE id = NEW.target_id;
  
  -- Don't notify self-reactions
  IF v_author = NEW.user_wallet THEN RETURN NEW; END IF;
  
  -- Get reactor display name
  SELECT COALESCE(display_name, LEFT(NEW.user_wallet, 6) || '...' || RIGHT(NEW.user_wallet, 4))
    INTO v_reactor_name FROM profiles WHERE wallet_address = NEW.user_wallet;
  
  PERFORM dispatch_notification(
    v_author,
    'activity',
    v_reactor_name || ' reacted ' || NEW.emoji || ' to your post',
    NULL,
    NEW.emoji,
    'current',
    NEW.target_id::TEXT
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_reaction
  AFTER INSERT ON reactions
  FOR EACH ROW EXECUTE FUNCTION notify_on_reaction();

-- Trigger: Notify on new comment
CREATE OR REPLACE FUNCTION notify_on_comment() RETURNS TRIGGER AS $$
DECLARE
  v_author TEXT;
  v_parent_author TEXT;
  v_commenter_name TEXT;
BEGIN
  -- Get commenter display name
  SELECT COALESCE(display_name, LEFT(NEW.author_wallet, 6) || '...' || RIGHT(NEW.author_wallet, 4))
    INTO v_commenter_name FROM profiles WHERE wallet_address = NEW.author_wallet;

  -- Notify current author
  SELECT author_wallet INTO v_author FROM currents WHERE id = NEW.current_id;
  
  IF v_author IS NOT NULL AND v_author != NEW.author_wallet THEN
    PERFORM dispatch_notification(
      v_author,
      'activity',
      v_commenter_name || ' commented on your post',
      LEFT(NEW.body, 100),
      '💬',
      'current',
      NEW.current_id::TEXT
    );
  END IF;
  
  -- If it's a reply, also notify parent comment author
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT author_wallet INTO v_parent_author FROM comments WHERE id = NEW.parent_comment_id;
    
    IF v_parent_author IS NOT NULL AND v_parent_author != NEW.author_wallet AND v_parent_author != v_author THEN
      PERFORM dispatch_notification(
        v_parent_author,
        'social',
        v_commenter_name || ' replied to your comment',
        LEFT(NEW.body, 100),
        '↩️',
        'current',
        NEW.current_id::TEXT
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_comment
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION notify_on_comment();

-- Trigger: Notify on new tankmate request
CREATE OR REPLACE FUNCTION notify_on_request() RETURNS TRIGGER AS $$
DECLARE
  v_sender_name TEXT;
BEGIN
  SELECT COALESCE(display_name, LEFT(NEW.from_wallet, 6) || '...' || RIGHT(NEW.from_wallet, 4))
    INTO v_sender_name FROM profiles WHERE wallet_address = NEW.from_wallet;
  
  PERFORM dispatch_notification(
    NEW.to_wallet,
    'social',
    v_sender_name || ' wants to be your Tankmate',
    NEW.message,
    '🤝',
    'profile',
    NEW.from_wallet
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_request
  AFTER INSERT ON connection_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_request();

-- Trigger: Notify on accepted request
CREATE OR REPLACE FUNCTION notify_on_request_accepted() RETURNS TRIGGER AS $$
DECLARE
  v_accepter_name TEXT;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT COALESCE(display_name, LEFT(NEW.to_wallet, 6) || '...' || RIGHT(NEW.to_wallet, 4))
      INTO v_accepter_name FROM profiles WHERE wallet_address = NEW.to_wallet;
    
    PERFORM dispatch_notification(
      NEW.from_wallet,
      'social',
      v_accepter_name || ' accepted your Tankmate request!',
      NULL,
      '✅',
      'profile',
      NEW.to_wallet
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_request_accepted
  AFTER UPDATE ON connection_requests
  FOR EACH ROW EXECUTE FUNCTION notify_on_request_accepted();


-- ============================================================================
-- STORAGE BUCKET (for media uploads via Supabase Storage)
-- Run this separately in the Supabase Dashboard > Storage > Create Bucket
-- Or uncomment below if using SQL:
-- ============================================================================

-- INSERT INTO storage.buckets (id, name, public) VALUES ('reef-media', 'reef-media', true);


-- ============================================================================
-- REALTIME (enable for notifications table)
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE sonar_notifications;
