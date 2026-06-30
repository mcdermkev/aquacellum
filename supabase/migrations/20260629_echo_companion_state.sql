-- ============================================================================
-- Echo Living Companion — Persistent Needs & Personality State
-- Stores off-chain companion state that changes too frequently for on-chain.
-- Syncs with local Dexie cache (echoNeeds table).
-- ============================================================================

-- Echo companion needs + personality (one row per user)
CREATE TABLE IF NOT EXISTS echo_companion_state (
  wallet_address  TEXT PRIMARY KEY REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  token_id        INTEGER,          -- On-chain NFT token ID (null if not yet minted)

  -- Tamagotchi needs (0–100 each, depleted by time, replenished by actions)
  hunger          REAL NOT NULL DEFAULT 80,
  clarity         REAL NOT NULL DEFAULT 80,
  comfort         REAL NOT NULL DEFAULT 80,
  curiosity       REAL NOT NULL DEFAULT 80,
  social          REAL NOT NULL DEFAULT 80,
  last_needs_update TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Personality axes (0–100 each, shift weekly based on care patterns)
  personality_nurturing   SMALLINT NOT NULL DEFAULT 10,
  personality_analytical  SMALLINT NOT NULL DEFAULT 10,
  personality_adventurous SMALLINT NOT NULL DEFAULT 10,
  personality_social      SMALLINT NOT NULL DEFAULT 10,
  personality_calm        SMALLINT NOT NULL DEFAULT 10,
  personality_creative    SMALLINT NOT NULL DEFAULT 10,
  last_personality_calc   TIMESTAMPTZ DEFAULT now(),

  -- Interaction stats
  total_taps      INTEGER NOT NULL DEFAULT 0,
  total_pets      INTEGER NOT NULL DEFAULT 0,
  tricks_unlocked TEXT[] DEFAULT '{}',
  rare_moments_log JSONB DEFAULT '[]',

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for batch personality drift cron job
CREATE INDEX IF NOT EXISTS idx_echo_state_personality_calc
  ON echo_companion_state (last_personality_calc);

-- Index for push notification targeting (find users with critical needs)
CREATE INDEX IF NOT EXISTS idx_echo_state_needs_critical
  ON echo_companion_state (hunger, clarity, comfort)
  WHERE hunger < 20 OR clarity < 20 OR comfort < 20;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_echo_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_echo_state_updated_at
  BEFORE UPDATE ON echo_companion_state
  FOR EACH ROW
  EXECUTE FUNCTION update_echo_state_timestamp();

-- Row-level security: users can only read/write their own Echo state
ALTER TABLE echo_companion_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY echo_state_select ON echo_companion_state
  FOR SELECT USING (auth.jwt() ->> 'wallet_address' = wallet_address);

CREATE POLICY echo_state_insert ON echo_companion_state
  FOR INSERT WITH CHECK (auth.jwt() ->> 'wallet_address' = wallet_address);

CREATE POLICY echo_state_update ON echo_companion_state
  FOR UPDATE USING (auth.jwt() ->> 'wallet_address' = wallet_address);

-- Service role can access all rows (for cron jobs, relayer)
CREATE POLICY echo_state_service ON echo_companion_state
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Echo action log (feeds personality drift calculation)
-- Lightweight event log of care actions per user per week.
-- ============================================================================

CREATE TABLE IF NOT EXISTS echo_action_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  action_type     TEXT NOT NULL,      -- e.g., "LOG_FEEDING", "SCAN_SPECIES", "POST_COMMUNITY"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for weekly personality drift queries (last 7 days per user)
CREATE INDEX IF NOT EXISTS idx_echo_actions_weekly
  ON echo_action_log (wallet_address, created_at DESC);

-- Partition-friendly: prune entries older than 90 days (cron or pg_cron)
-- This keeps the table lightweight while personality drift only needs last 7 days.

ALTER TABLE echo_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY echo_action_log_select ON echo_action_log
  FOR SELECT USING (auth.jwt() ->> 'wallet_address' = wallet_address);

CREATE POLICY echo_action_log_insert ON echo_action_log
  FOR INSERT WITH CHECK (auth.jwt() ->> 'wallet_address' = wallet_address);

CREATE POLICY echo_action_log_service ON echo_action_log
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================================================
-- Echo Push Notification Log (rate limiting + analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS echo_push_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL,
  category        TEXT NOT NULL,     -- "echo_need", "echo_streak", "echo_evolution", "echo_rare"
  body            TEXT,              -- The message sent
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for rate limiting: count today's pushes per user
CREATE INDEX IF NOT EXISTS idx_echo_push_log_daily
  ON echo_push_log (wallet_address, sent_at DESC);

-- Auto-prune entries older than 30 days (keep the table lean)
-- Run via pg_cron: SELECT cron.schedule('prune-echo-push-log', '0 3 * * *', $$DELETE FROM echo_push_log WHERE sent_at < now() - interval '30 days'$$);


-- ============================================================================
-- Echo On-Chain Queue (relayer picks up pending personality updates monthly)
-- ============================================================================

CREATE TABLE IF NOT EXISTS echo_onchain_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL,
  nurturing       SMALLINT NOT NULL,
  analytical      SMALLINT NOT NULL,
  adventurous     SMALLINT NOT NULL,
  social          SMALLINT NOT NULL,
  calm            SMALLINT NOT NULL,
  creative        SMALLINT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  tx_hash         TEXT,              -- On-chain transaction hash once submitted
  status          TEXT NOT NULL DEFAULT 'pending'  -- "pending", "submitted", "confirmed", "failed"
);

CREATE INDEX IF NOT EXISTS idx_echo_onchain_queue_pending
  ON echo_onchain_queue (status) WHERE status = 'pending';

-- ============================================================================
-- Cron Schedules (add via Supabase Dashboard → SQL Editor or pg_cron)
-- ============================================================================

-- Weekly personality drift: every Monday at 03:00 UTC
-- SELECT cron.schedule(
--   'echo-personality-drift',
--   '0 3 * * 1',
--   $$SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/echo-personality-drift',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--     body := '{}'::jsonb
--   )$$
-- );

-- Echo nudge notifications: every 4 hours
-- SELECT cron.schedule(
--   'echo-nudge',
--   '0 */4 * * *',
--   $$SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/echo-nudge',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--     body := '{}'::jsonb
--   )$$
-- );

-- Prune old echo action logs (keep 90 days): daily at 03:30 UTC
-- SELECT cron.schedule(
--   'prune-echo-action-log',
--   '30 3 * * *',
--   $$DELETE FROM echo_action_log WHERE created_at < now() - interval '90 days'$$
-- );
