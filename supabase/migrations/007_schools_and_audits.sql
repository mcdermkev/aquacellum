-- ============================================================================
-- The Reef — Phase 2: Schools & Expert Audits Schema Migration
-- Tables: schools, school_members, school_challenges, school_chat, expert_audits
-- ============================================================================

-- 1. SCHOOLS (Clubs)
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  banner_url TEXT,
  school_type TEXT NOT NULL CHECK (school_type IN ('species', 'regional', 'breeding', 'conservation', 'equipment', 'open')),
  founder_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  member_cap INTEGER,
  is_invite_only BOOLEAN DEFAULT FALSE,
  tracked_species JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  member_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SCHOOL MEMBERS
CREATE TABLE school_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  wallet_address TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('founder', 'elder', 'member', 'visitor')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, wallet_address)
);

-- 3. SCHOOL CHALLENGES
CREATE TABLE school_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  creator_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL CHECK (challenge_type IN ('breeding_sprint', 'growout_race', 'photo_contest', 'care_streak')),
  target_species JSONB,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  reward_xp INTEGER DEFAULT 100,
  reward_badge TEXT,
  leaderboard JSONB DEFAULT '[]',
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SCHOOL CHAT
CREATE TABLE school_chat (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 500),
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. EXPERT AUDITS
CREATE TABLE expert_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auditor_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  recipient_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_tank_id TEXT,
  target_current_id UUID REFERENCES currents(id) ON DELETE SET NULL,
  water_quality_score SMALLINT CHECK (water_quality_score BETWEEN 1 AND 5),
  stocking_score SMALLINT CHECK (stocking_score BETWEEN 1 AND 5),
  husbandry_score SMALLINT CHECK (husbandry_score BETWEEN 1 AND 5),
  aesthetics_score SMALLINT CHECK (aesthetics_score BETWEEN 1 AND 5),
  commentary TEXT,
  photos JSONB DEFAULT '[]',
  xp_awarded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. AUDIT REQUESTS
CREATE TABLE audit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_auditor_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  target_current_id UUID REFERENCES currents(id) ON DELETE CASCADE,
  message TEXT CHECK (char_length(message) <= 300),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed', 'cancelled')),
  claimed_by_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. MENTORSHIP PAIRINGS
CREATE TABLE mentorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  mentee_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended')),
  message TEXT CHECK (char_length(message) <= 300),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mentor_wallet, mentee_wallet)
);

-- Add accepting_mentees flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accepting_mentees BOOLEAN DEFAULT FALSE;

-- Add follow_type 'mentor' and 'mentee' support
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follow_type_check;
ALTER TABLE follows ADD CONSTRAINT follows_follow_type_check 
  CHECK (follow_type IN ('tankmate', 'watch_tank', 'mentor', 'mentee'));


-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_schools_type_slug ON schools(school_type, slug);
CREATE INDEX idx_school_members_wallet ON school_members(wallet_address);
CREATE INDEX idx_school_members_school ON school_members(school_id, role);
CREATE INDEX idx_school_chat_school ON school_chat(school_id, created_at DESC);
CREATE INDEX idx_school_challenges_school ON school_challenges(school_id, status);
CREATE INDEX idx_expert_audits_recipient ON expert_audits(recipient_wallet, created_at DESC);
CREATE INDEX idx_expert_audits_auditor ON expert_audits(auditor_wallet, created_at DESC);
CREATE INDEX idx_audit_requests_status ON audit_requests(status, created_at DESC);
CREATE INDEX idx_audit_requests_auditor ON audit_requests(target_auditor_wallet, status);
CREATE INDEX idx_mentorships_mentor ON mentorships(mentor_wallet, status);
CREATE INDEX idx_mentorships_mentee ON mentorships(mentee_wallet, status);


-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- SCHOOLS: public read, founder manages
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read schools" 
  ON schools FOR SELECT USING (true);

CREATE POLICY "Founders create schools" 
  ON schools FOR INSERT 
  WITH CHECK (founder_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Founders update own schools" 
  ON schools FOR UPDATE 
  USING (founder_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- SCHOOL MEMBERS: public read, user manages own membership
ALTER TABLE school_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read school members" 
  ON school_members FOR SELECT USING (true);

CREATE POLICY "Users join schools" 
  ON school_members FOR INSERT 
  WITH CHECK (wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Users leave schools" 
  ON school_members FOR DELETE 
  USING (wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Founders/Elders manage members" 
  ON school_members FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM school_members sm
      WHERE sm.school_id = school_members.school_id
      AND sm.wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND sm.role IN ('founder', 'elder')
    )
  );

-- SCHOOL CHAT: members only
ALTER TABLE school_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School members read chat" 
  ON school_chat FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM school_members
      WHERE school_id = school_chat.school_id
      AND wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND role IN ('founder', 'elder', 'member')
    )
  );

CREATE POLICY "School members post chat" 
  ON school_chat FOR INSERT 
  WITH CHECK (
    author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    AND EXISTS (
      SELECT 1 FROM school_members
      WHERE school_id = school_chat.school_id
      AND wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND role IN ('founder', 'elder', 'member')
    )
  );

CREATE POLICY "Elders/Founders moderate chat" 
  ON school_chat FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM school_members
      WHERE school_id = school_chat.school_id
      AND wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND role IN ('founder', 'elder')
    )
  );

-- SCHOOL CHALLENGES: public read, elders/founders create
ALTER TABLE school_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read challenges" 
  ON school_challenges FOR SELECT USING (true);

CREATE POLICY "Elders/Founders create challenges" 
  ON school_challenges FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM school_members
      WHERE school_id = school_challenges.school_id
      AND wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND role IN ('founder', 'elder')
    )
  );

CREATE POLICY "Elders/Founders update challenges" 
  ON school_challenges FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM school_members
      WHERE school_id = school_challenges.school_id
      AND wallet_address = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
      AND role IN ('founder', 'elder')
    )
  );

-- EXPERT AUDITS: public read, auditor creates
ALTER TABLE expert_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read audits" 
  ON expert_audits FOR SELECT USING (true);

CREATE POLICY "Auditors create audits" 
  ON expert_audits FOR INSERT 
  WITH CHECK (auditor_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- AUDIT REQUESTS: parties can read, requester creates
ALTER TABLE audit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read open audit requests" 
  ON audit_requests FOR SELECT 
  USING (
    status = 'open'
    OR requester_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR target_auditor_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR claimed_by_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );

CREATE POLICY "Users create audit requests" 
  ON audit_requests FOR INSERT 
  WITH CHECK (requester_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Auditors claim/complete requests" 
  ON audit_requests FOR UPDATE 
  USING (
    target_auditor_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR (status = 'open' AND (current_setting('request.jwt.claims', true)::json->>'wallet_address') IS NOT NULL)
    OR requester_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );

-- MENTORSHIPS: parties can read/manage
ALTER TABLE mentorships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can read mentorships" 
  ON mentorships FOR SELECT 
  USING (
    mentor_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR mentee_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );

CREATE POLICY "Mentees request mentorship" 
  ON mentorships FOR INSERT 
  WITH CHECK (mentee_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address'));

CREATE POLICY "Either party can update mentorship" 
  ON mentorships FOR UPDATE 
  USING (
    mentor_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR mentee_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
  );


-- ============================================================================
-- REALTIME (enable for school_chat for live messaging)
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE school_chat;


-- ============================================================================
-- NOTIFICATION TRIGGERS
-- ============================================================================

-- Trigger: Notify on expert audit received
CREATE OR REPLACE FUNCTION notify_on_audit() RETURNS TRIGGER AS $$
DECLARE
  v_auditor_name TEXT;
BEGIN
  SELECT COALESCE(display_name, LEFT(NEW.auditor_wallet, 6) || '...' || RIGHT(NEW.auditor_wallet, 4))
    INTO v_auditor_name FROM profiles WHERE wallet_address = NEW.auditor_wallet;
  
  PERFORM dispatch_notification(
    NEW.recipient_wallet,
    'social',
    v_auditor_name || ' gave you an Expert Audit!',
    'Scores: 💧' || NEW.water_quality_score || ' 🐟' || NEW.stocking_score || ' 🏠' || NEW.husbandry_score || ' 🎨' || NEW.aesthetics_score,
    '⭐',
    'audit',
    NEW.id::TEXT
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_audit
  AFTER INSERT ON expert_audits
  FOR EACH ROW EXECUTE FUNCTION notify_on_audit();

-- Trigger: Notify on mentorship request
CREATE OR REPLACE FUNCTION notify_on_mentorship_request() RETURNS TRIGGER AS $$
DECLARE
  v_mentee_name TEXT;
BEGIN
  SELECT COALESCE(display_name, LEFT(NEW.mentee_wallet, 6) || '...' || RIGHT(NEW.mentee_wallet, 4))
    INTO v_mentee_name FROM profiles WHERE wallet_address = NEW.mentee_wallet;
  
  PERFORM dispatch_notification(
    NEW.mentor_wallet,
    'social',
    v_mentee_name || ' wants you as their Mentor!',
    NEW.message,
    '🎓',
    'profile',
    NEW.mentee_wallet
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_mentorship_request
  AFTER INSERT ON mentorships
  FOR EACH ROW EXECUTE FUNCTION notify_on_mentorship_request();

-- Trigger: Notify mentor when mentorship accepted
CREATE OR REPLACE FUNCTION notify_on_mentorship_accepted() RETURNS TRIGGER AS $$
DECLARE
  v_mentor_name TEXT;
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'pending' THEN
    SELECT COALESCE(display_name, LEFT(NEW.mentor_wallet, 6) || '...' || RIGHT(NEW.mentor_wallet, 4))
      INTO v_mentor_name FROM profiles WHERE wallet_address = NEW.mentor_wallet;
    
    PERFORM dispatch_notification(
      NEW.mentee_wallet,
      'social',
      v_mentor_name || ' accepted your Mentorship request!',
      NULL,
      '✅',
      'profile',
      NEW.mentor_wallet
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_mentorship_accepted
  AFTER UPDATE ON mentorships
  FOR EACH ROW EXECUTE FUNCTION notify_on_mentorship_accepted();

-- Trigger: Update school member_count on join/leave
CREATE OR REPLACE FUNCTION update_school_member_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE schools SET member_count = member_count + 1 WHERE id = NEW.school_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE schools SET member_count = member_count - 1 WHERE id = OLD.school_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_school_member_count
  AFTER INSERT OR DELETE ON school_members
  FOR EACH ROW EXECUTE FUNCTION update_school_member_count();
