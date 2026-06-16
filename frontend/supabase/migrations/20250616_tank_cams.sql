-- =============================================================================
-- Migration: Tank Cams table
-- Phase 2: Always-on ambient live streams for user tanks
-- =============================================================================

CREATE TABLE IF NOT EXISTS tank_cams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet TEXT NOT NULL,
  tank_id TEXT,
  tank_name TEXT,
  mux_live_stream_id TEXT NOT NULL,
  mux_playback_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  visibility TEXT NOT NULL DEFAULT 'public',
  viewer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

-- Index for discovery feed: active cams sorted by viewers
CREATE INDEX IF NOT EXISTS idx_tank_cams_active
  ON tank_cams (status, viewer_count DESC)
  WHERE status = 'active';

-- Index for owner lookups
CREATE INDEX IF NOT EXISTS idx_tank_cams_owner
  ON tank_cams (owner_wallet);

-- Index for webhook correlation (Mux fires with live_stream_id)
CREATE INDEX IF NOT EXISTS idx_tank_cams_mux_stream
  ON tank_cams (mux_live_stream_id);

-- RLS policies
ALTER TABLE tank_cams ENABLE ROW LEVEL SECURITY;

-- Anyone can read public active cams
CREATE POLICY "Public active cams visible to all" ON tank_cams
  FOR SELECT USING (visibility = 'public');

-- Owners can read all their own cams (any status/visibility)
CREATE POLICY "Owners can read own cams" ON tank_cams
  FOR SELECT USING (owner_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Owners can insert their own cams
CREATE POLICY "Owners can create cams" ON tank_cams
  FOR INSERT WITH CHECK (owner_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Owners can update their own cams
CREATE POLICY "Owners can update own cams" ON tank_cams
  FOR UPDATE USING (owner_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Owners can delete their own cams
CREATE POLICY "Owners can delete own cams" ON tank_cams
  FOR DELETE USING (owner_wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Service role (webhook) can update any cam status
-- (This is handled by using the service role key in the webhook, bypassing RLS)

-- Column comments
COMMENT ON TABLE tank_cams IS 'Persistent live stream registrations for user tank webcams';
COMMENT ON COLUMN tank_cams.mux_live_stream_id IS 'Mux live stream resource ID — used for webhook correlation';
COMMENT ON COLUMN tank_cams.mux_playback_id IS 'Mux playback ID — used to construct HLS URL for viewers';
COMMENT ON COLUMN tank_cams.stream_key IS 'Secret RTMP stream key — only visible to owner';
COMMENT ON COLUMN tank_cams.status IS 'idle = camera not streaming, active = live, disconnected = dropped';
COMMENT ON COLUMN tank_cams.visibility IS 'public = visible in discovery, tankmates_only, link_only';
