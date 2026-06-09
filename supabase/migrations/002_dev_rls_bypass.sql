-- ============================================================================
-- DEVELOPMENT ONLY — Temporary permissive policies for MVP testing
-- 
-- These policies allow the anon key to insert/update/delete without a JWT
-- session. This lets us test the full social flow before deploying the
-- Edge Function auth bridge.
--
-- ⚠️  REMOVE THESE BEFORE PRODUCTION by running:
--     DROP POLICY "dev_profiles_insert" ON profiles;
--     DROP POLICY "dev_profiles_update" ON profiles;
--     DROP POLICY "dev_currents_insert" ON currents;
--     DROP POLICY "dev_currents_update" ON currents;
--     DROP POLICY "dev_currents_delete" ON currents;
--     DROP POLICY "dev_reactions_insert" ON reactions;
--     DROP POLICY "dev_reactions_delete" ON reactions;
--     DROP POLICY "dev_comments_insert" ON comments;
--     DROP POLICY "dev_comments_delete" ON comments;
--     DROP POLICY "dev_follows_insert" ON follows;
--     DROP POLICY "dev_follows_delete" ON follows;
--     DROP POLICY "dev_requests_insert" ON connection_requests;
--     DROP POLICY "dev_requests_update" ON connection_requests;
--     DROP POLICY "dev_notifications_insert" ON sonar_notifications;
-- ============================================================================

-- PROFILES
CREATE POLICY "dev_profiles_insert" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_profiles_update" ON profiles FOR UPDATE USING (true);

-- CURRENTS
CREATE POLICY "dev_currents_insert" ON currents FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_currents_update" ON currents FOR UPDATE USING (true);
CREATE POLICY "dev_currents_delete" ON currents FOR DELETE USING (true);

-- REACTIONS
CREATE POLICY "dev_reactions_insert" ON reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_reactions_delete" ON reactions FOR DELETE USING (true);

-- COMMENTS
CREATE POLICY "dev_comments_insert" ON comments FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_comments_delete" ON comments FOR DELETE USING (true);

-- FOLLOWS
CREATE POLICY "dev_follows_insert" ON follows FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_follows_delete" ON follows FOR DELETE USING (true);

-- CONNECTION REQUESTS
CREATE POLICY "dev_requests_insert" ON connection_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "dev_requests_update" ON connection_requests FOR UPDATE USING (true);

-- NOTIFICATIONS (allows triggers to fire)
CREATE POLICY "dev_notifications_insert" ON sonar_notifications FOR INSERT WITH CHECK (true);
