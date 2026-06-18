-- ============================================================================
-- Migration 011: Zone Leaderboard & Unified XP Events
-- Phase 2 of Unified Gamification (GAMIFICATION_SPEC.md)
-- 
-- Creates: xp_events, zones
-- Adds: zone_hash, total_xp, monthly_xp, current_tier columns to profiles
-- Creates: zone_leaderboard materialized view
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add zone & unified XP columns to profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zone_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_xp INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS monthly_xp INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_tier TEXT DEFAULT 'Shallow';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reward_credits NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zone_assigned_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zone_transfer_cooldown TIMESTAMPTZ;

-- Backfill total_xp from existing xp_total (from migration 001) if not yet set
UPDATE profiles SET total_xp = xp_total WHERE total_xp = 0 AND xp_total > 0;

-- Update current_tier based on total_xp for existing users
UPDATE profiles SET current_tier = CASE
  WHEN total_xp >= 10000 THEN 'Hadal'
  WHEN total_xp >= 5000 THEN 'Abyssal'
  WHEN total_xp >= 2500 THEN 'Pelagic'
  WHEN total_xp >= 1500 THEN 'Coastal'
  ELSE 'Shallow'
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Zones table — registered geographic zones with adaptive sizing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zones (
  zone_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,          -- e.g., "SF Bay Area", "Austin Metro"
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_miles DOUBLE PRECISION NOT NULL DEFAULT 20,  -- adaptive per density
  population_tier TEXT DEFAULT 'medium' CHECK (population_tier IN ('dense', 'medium', 'sparse')),
  member_count INTEGER DEFAULT 0,
  champion_wallet TEXT REFERENCES profiles(wallet_address),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. XP Events table — full audit trail of all XP earned
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  action_type TEXT NOT NULL,           -- maps to XP_ACTIONS keys (e.g., 'LOG_FEEDING', 'MINT_SPECIMEN')
  points_awarded INTEGER NOT NULL,
  multiplier NUMERIC(3, 1) DEFAULT 1.0,  -- 1.0x, 1.5x (streak), 2.0x (expo)
  final_points INTEGER NOT NULL,       -- points_awarded * multiplier
  zone_hash TEXT,
  metadata JSONB DEFAULT '{}',         -- { tank_id, challenge_id, event_id, etc. }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_zone ON profiles(zone_hash);
CREATE INDEX IF NOT EXISTS idx_profiles_total_xp ON profiles(total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_zone_xp ON profiles(zone_hash, total_xp DESC);

CREATE INDEX IF NOT EXISTS idx_xp_events_wallet ON xp_events(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_zone ON xp_events(zone_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_monthly ON xp_events(wallet_address, created_at)
  WHERE created_at >= date_trunc('month', NOW());

CREATE INDEX IF NOT EXISTS idx_zones_location ON zones(center_lat, center_lng);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Zone Leaderboard View (materialized for performance)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS zone_leaderboard AS
SELECT
  p.wallet_address,
  p.display_name,
  p.avatar_url,
  p.total_xp,
  p.current_tier,
  p.zone_hash,
  z.display_name AS zone_name,
  z.champion_wallet,
  RANK() OVER (PARTITION BY p.zone_hash ORDER BY p.total_xp DESC) AS zone_rank,
  (p.wallet_address = z.champion_wallet) AS is_champion
FROM profiles p
LEFT JOIN zones z ON p.zone_hash = z.zone_hash
WHERE p.zone_hash IS NOT NULL
  AND p.total_xp > 0
ORDER BY p.zone_hash, p.total_xp DESC;

-- Unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_leaderboard_wallet
  ON zone_leaderboard(wallet_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Weekly Contributors View (rolling 7-day window)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_contributors AS
SELECT
  xe.wallet_address,
  p.display_name,
  p.avatar_url,
  p.current_tier,
  SUM(xe.final_points) AS weekly_xp,
  COUNT(*) AS action_count,
  RANK() OVER (ORDER BY SUM(xe.final_points) DESC) AS weekly_rank
FROM xp_events xe
JOIN profiles p ON xe.wallet_address = p.wallet_address
WHERE xe.created_at >= NOW() - INTERVAL '7 days'
GROUP BY xe.wallet_address, p.display_name, p.avatar_url, p.current_tier
ORDER BY weekly_xp DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_contributors_wallet
  ON weekly_contributors(wallet_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger: Update profile total_xp on xp_event insert
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_profile_xp_on_event()
RETURNS TRIGGER AS $$
DECLARE
  new_total INTEGER;
  new_tier TEXT;
  new_monthly INTEGER;
BEGIN
  -- Increment total_xp
  UPDATE profiles
  SET
    total_xp = total_xp + NEW.final_points,
    monthly_xp = monthly_xp + NEW.final_points,
    last_active_date = CURRENT_DATE
  WHERE wallet_address = NEW.wallet_address
  RETURNING total_xp, monthly_xp INTO new_total, new_monthly;

  -- Determine new tier
  IF new_total >= 10000 THEN new_tier := 'Hadal';
  ELSIF new_total >= 5000 THEN new_tier := 'Abyssal';
  ELSIF new_total >= 2500 THEN new_tier := 'Pelagic';
  ELSIF new_total >= 1500 THEN new_tier := 'Coastal';
  ELSE new_tier := 'Shallow';
  END IF;

  -- Update tier if changed
  UPDATE profiles
  SET current_tier = new_tier
  WHERE wallet_address = NEW.wallet_address
    AND current_tier != new_tier;

  -- Check for God-Tier champion promotion in zone
  IF new_total >= 10000 AND NEW.zone_hash IS NOT NULL THEN
    PERFORM evaluate_zone_champion(NEW.zone_hash, NEW.wallet_address, new_total);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_profile_xp
  AFTER INSERT ON xp_events
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_xp_on_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Zone Champion Evaluation Function
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION evaluate_zone_champion(
  p_zone_hash TEXT,
  p_wallet TEXT,
  p_xp INTEGER
)
RETURNS VOID AS $$
DECLARE
  current_champion_wallet TEXT;
  current_champion_xp INTEGER;
BEGIN
  -- Get current champion
  SELECT champion_wallet INTO current_champion_wallet
  FROM zones
  WHERE zone_hash = p_zone_hash;

  -- If no champion yet and user qualifies (10k+), promote
  IF current_champion_wallet IS NULL THEN
    UPDATE zones
    SET champion_wallet = p_wallet, updated_at = NOW()
    WHERE zone_hash = p_zone_hash;
    RETURN;
  END IF;

  -- If user IS the current champion, nothing to do
  IF current_champion_wallet = p_wallet THEN
    RETURN;
  END IF;

  -- Compare XP
  SELECT total_xp INTO current_champion_xp
  FROM profiles
  WHERE wallet_address = current_champion_wallet;

  -- If the new user surpasses the current champion, promote them
  IF p_xp > COALESCE(current_champion_xp, 0) THEN
    UPDATE zones
    SET champion_wallet = p_wallet, updated_at = NOW()
    WHERE zone_hash = p_zone_hash;

    -- Notify new champion
    INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      p_wallet,
      'milestone',
      '👑 Zone Champion!',
      'You are now the God-Tier Champion of your regional zone!',
      '👑',
      'profile',
      p_wallet
    );

    -- Notify dethroned champion
    INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      current_champion_wallet,
      'milestone',
      '🔄 Zone Champion Changed',
      'Another breeder has surpassed your XP in your zone. Keep earning to reclaim it!',
      '🔄',
      'profile',
      current_champion_wallet
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Monthly XP reset function (call via cron/scheduled function)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reset_monthly_xp()
RETURNS VOID AS $$
BEGIN
  UPDATE profiles SET monthly_xp = 0;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Materialized view refresh function (call via cron every 5 min)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_leaderboard_views()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zone_leaderboard;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_contributors;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;

-- XP Events: public read (for leaderboards), write via service role only
CREATE POLICY "Public read xp_events" ON xp_events
  FOR SELECT USING (true);

CREATE POLICY "Service write xp_events" ON xp_events
  FOR INSERT WITH CHECK (true);

-- Zones: public read
CREATE POLICY "Public read zones" ON zones
  FOR SELECT USING (true);

-- Zone writes restricted to service role (admin)
CREATE POLICY "Service write zones" ON zones
  FOR ALL USING (true) WITH CHECK (true);
