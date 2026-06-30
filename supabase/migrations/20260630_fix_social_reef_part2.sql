-- ============================================================================
-- Fix Social Reef Part 2 — Schools, Tides, and Dev Bypass Policies
--
-- Issues:
-- 1. follows.follow_type constraint is missing 'mentor' and 'mentee' types
-- 2. school_invites table has no FKs — PostgREST joins fail
-- 3. Schools/Tides tables lack dev bypass INSERT/UPDATE/DELETE policies
--    causing writes to fail in anon/header mode
-- 4. Tide RLS uses auth.jwt() which blocks anon role entirely
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. FIX: follows.follow_type — include ALL valid types
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follow_type_check;
ALTER TABLE follows ADD CONSTRAINT follows_follow_type_check
  CHECK (follow_type IN ('tankmate', 'watch_tank', 'follow', 'mentor', 'mentee'));


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FIX: school_invites — add FKs for PostgREST resource embedding
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'school_invites_school_id_fkey'
      AND table_name = 'school_invites'
  ) THEN
    ALTER TABLE school_invites
      ADD CONSTRAINT school_invites_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'school_invites_invited_wallet_fkey'
      AND table_name = 'school_invites'
  ) THEN
    ALTER TABLE school_invites
      ADD CONSTRAINT school_invites_invited_wallet_fkey
      FOREIGN KEY (invited_wallet) REFERENCES profiles(wallet_address) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'school_invites_invited_by_fkey'
      AND table_name = 'school_invites'
  ) THEN
    ALTER TABLE school_invites
      ADD CONSTRAINT school_invites_invited_by_fkey
      FOREIGN KEY (invited_by) REFERENCES profiles(wallet_address) ON DELETE SET NULL;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. DEV BYPASS: Schools tables — allow writes without JWT auth
-- ══════════════════════════════════════════════════════════════════════════════

-- schools
DROP POLICY IF EXISTS "dev_schools_insert" ON schools;
CREATE POLICY "dev_schools_insert" ON schools FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_schools_update" ON schools;
CREATE POLICY "dev_schools_update" ON schools FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_schools_delete" ON schools;
CREATE POLICY "dev_schools_delete" ON schools FOR DELETE USING (true);

-- school_members
DROP POLICY IF EXISTS "dev_school_members_insert" ON school_members;
CREATE POLICY "dev_school_members_insert" ON school_members FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_school_members_update" ON school_members;
CREATE POLICY "dev_school_members_update" ON school_members FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_school_members_delete" ON school_members;
CREATE POLICY "dev_school_members_delete" ON school_members FOR DELETE USING (true);

-- school_chat
DROP POLICY IF EXISTS "dev_school_chat_select" ON school_chat;
CREATE POLICY "dev_school_chat_select" ON school_chat FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_school_chat_insert" ON school_chat;
CREATE POLICY "dev_school_chat_insert" ON school_chat FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_school_chat_update" ON school_chat;
CREATE POLICY "dev_school_chat_update" ON school_chat FOR UPDATE USING (true);

-- school_challenges
DROP POLICY IF EXISTS "dev_school_challenges_insert" ON school_challenges;
CREATE POLICY "dev_school_challenges_insert" ON school_challenges FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_school_challenges_update" ON school_challenges;
CREATE POLICY "dev_school_challenges_update" ON school_challenges FOR UPDATE USING (true);

-- school_invites (already has permissive policies but ensure they're correct)
DROP POLICY IF EXISTS "dev_school_invites_select" ON school_invites;
CREATE POLICY "dev_school_invites_select" ON school_invites FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_school_invites_insert" ON school_invites;
CREATE POLICY "dev_school_invites_insert" ON school_invites FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_school_invites_update" ON school_invites;
CREATE POLICY "dev_school_invites_update" ON school_invites FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_school_invites_delete" ON school_invites;
CREATE POLICY "dev_school_invites_delete" ON school_invites FOR DELETE USING (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. DEV BYPASS: Tides tables — allow writes without JWT auth
-- ══════════════════════════════════════════════════════════════════════════════

-- tides
DROP POLICY IF EXISTS "dev_tides_insert" ON tides;
CREATE POLICY "dev_tides_insert" ON tides FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_tides_update" ON tides;
CREATE POLICY "dev_tides_update" ON tides FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_tides_delete" ON tides;
CREATE POLICY "dev_tides_delete" ON tides FOR DELETE USING (true);

-- tide_attendees
DROP POLICY IF EXISTS "dev_tide_attendees_select" ON tide_attendees;
CREATE POLICY "dev_tide_attendees_select" ON tide_attendees FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_tide_attendees_insert" ON tide_attendees;
CREATE POLICY "dev_tide_attendees_insert" ON tide_attendees FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_tide_attendees_update" ON tide_attendees;
CREATE POLICY "dev_tide_attendees_update" ON tide_attendees FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_tide_attendees_delete" ON tide_attendees;
CREATE POLICY "dev_tide_attendees_delete" ON tide_attendees FOR DELETE USING (true);

-- tide_chat
DROP POLICY IF EXISTS "dev_tide_chat_select" ON tide_chat;
CREATE POLICY "dev_tide_chat_select" ON tide_chat FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_tide_chat_insert" ON tide_chat;
CREATE POLICY "dev_tide_chat_insert" ON tide_chat FOR INSERT WITH CHECK (true);

-- auction_bids
DROP POLICY IF EXISTS "dev_auction_bids_insert" ON auction_bids;
CREATE POLICY "dev_auction_bids_insert" ON auction_bids FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_auction_bids_update" ON auction_bids;
CREATE POLICY "dev_auction_bids_update" ON auction_bids FOR UPDATE USING (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. DEV BYPASS: Expert audits / audit requests / mentorships
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "dev_expert_audits_insert" ON expert_audits;
CREATE POLICY "dev_expert_audits_insert" ON expert_audits FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_audit_requests_select" ON audit_requests;
CREATE POLICY "dev_audit_requests_select" ON audit_requests FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_audit_requests_insert" ON audit_requests;
CREATE POLICY "dev_audit_requests_insert" ON audit_requests FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_audit_requests_update" ON audit_requests;
CREATE POLICY "dev_audit_requests_update" ON audit_requests FOR UPDATE USING (true);

DROP POLICY IF EXISTS "dev_mentorships_select" ON mentorships;
CREATE POLICY "dev_mentorships_select" ON mentorships FOR SELECT USING (true);

DROP POLICY IF EXISTS "dev_mentorships_insert" ON mentorships;
CREATE POLICY "dev_mentorships_insert" ON mentorships FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "dev_mentorships_update" ON mentorships;
CREATE POLICY "dev_mentorships_update" ON mentorships FOR UPDATE USING (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Enable Realtime for school_chat and tide_chat
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE school_chat;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tide_chat;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
