-- ============================================================================
-- Migration: XP Server Authority Enhancements
-- 
-- Now that /api/validate-xp gates all XP awards through server-side validation,
-- we add supporting infrastructure:
--
--   1. A function to get the authoritative server XP total for a wallet
--   2. A recalculation function (safety net — rebuilds total_xp from xp_events)
--   3. An index for faster cooldown checks with metadata->>'tankId'
--   4. A scheduled refresh for the zone_leaderboard materialized view
--   5. RLS policies for xp_events (read own, no client inserts)
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Get authoritative XP total (reads from profiles.total_xp which the 
--    trigger_update_profile_xp keeps in sync with xp_events)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_server_xp_total(p_wallet TEXT)
RETURNS INTEGER AS $$
  SELECT COALESCE(total_xp, 0)
  FROM profiles
  WHERE wallet_address = p_wallet;
$$ LANGUAGE sql STABLE;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Recalculate total_xp from xp_events (safety net for data reconciliation)
--    Only run this manually if discrepancies are detected.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recalculate_xp_total(p_wallet TEXT)
RETURNS INTEGER AS $$
DECLARE
  recalculated INTEGER;
  new_tier TEXT;
BEGIN
  SELECT COALESCE(SUM(final_points), 0) INTO recalculated
  FROM xp_events
  WHERE wallet_address = p_wallet;

  -- Determine tier
  IF recalculated >= 10000 THEN new_tier := 'Hadal';
  ELSIF recalculated >= 5000 THEN new_tier := 'Abyssal';
  ELSIF recalculated >= 2500 THEN new_tier := 'Pelagic';
  ELSIF recalculated >= 1500 THEN new_tier := 'Coastal';
  ELSE new_tier := 'Shallow';
  END IF;

  UPDATE profiles
  SET total_xp = recalculated,
      current_tier = new_tier,
      updated_at = NOW()
  WHERE wallet_address = p_wallet;

  RETURN recalculated;
END;
$$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Partial index for faster per-tank cooldown checks
--    The validate-xp endpoint queries: WHERE metadata @> '{"tankId": ...}'
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_xp_events_cooldown
  ON xp_events(wallet_address, action_type, created_at DESC)
  WHERE metadata->>'tankId' IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Zone leaderboard refresh function (call via pg_cron or manually)
--    Refreshes concurrently so reads aren't blocked.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_zone_leaderboard()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zone_leaderboard;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_contributors;
END;
$$ LANGUAGE plpgsql;

-- Schedule refresh every 15 minutes (requires pg_cron extension)
-- If pg_cron isn't available, call this via a Supabase cron job instead:
--   SELECT cron.schedule('refresh-leaderboards', '*/15 * * * *', 'SELECT refresh_zone_leaderboard()');
-- Uncomment the line below if pg_cron is enabled:
-- SELECT cron.schedule('refresh-leaderboards', '*/15 * * * *', 'SELECT refresh_zone_leaderboard()');


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RLS Policies for xp_events
--    Users can read their own events (for history display).
--    Only the service role can INSERT (via /api/validate-xp).
--    No direct client inserts allowed.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own XP event history
CREATE POLICY "xp_events_select_own_jwt"
  ON xp_events FOR SELECT
  TO authenticated
  USING (wallet_address = lower(auth.jwt()->>'wallet_address'));

-- Anon users can read via header (backward compat)
CREATE POLICY "xp_events_select_own_anon"
  ON xp_events FOR SELECT
  TO anon
  USING (
    wallet_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

-- No INSERT policy for anon or authenticated — only service_role can insert.
-- This ensures all XP events come through the validated /api/validate-xp endpoint.
-- (Service role bypasses RLS automatically.)


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Sync legacy xp_total column → total_xp for any leftover data
--    (One-time backfill, idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE profiles
SET total_xp = GREATEST(total_xp, xp_total)
WHERE xp_total > total_xp;
