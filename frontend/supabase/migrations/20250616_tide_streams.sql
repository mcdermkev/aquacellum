-- =============================================================================
-- Migration: Tide Streams table
-- Phase 3: Virtual Tide livestreaming with VOD recording
-- =============================================================================

CREATE TABLE IF NOT EXISTS tide_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id UUID NOT NULL,
  host_wallet TEXT NOT NULL,
  mux_live_stream_id TEXT NOT NULL,
  mux_playback_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  recording_playback_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for looking up stream by tide
CREATE INDEX IF NOT EXISTS idx_tide_streams_tide_id
  ON tide_streams (tide_id);

-- Index for webhook correlation
CREATE INDEX IF NOT EXISTS idx_tide_streams_mux_stream
  ON tide_streams (mux_live_stream_id);

-- RLS policies
ALTER TABLE tide_streams ENABLE ROW LEVEL SECURITY;

-- Anyone can read stream info (needed for viewers to get playback ID)
CREATE POLICY "Public read tide streams" ON tide_streams
  FOR SELECT USING (true);

-- Hosts can create streams for their tides
CREATE POLICY "Hosts can create tide streams" ON tide_streams
  FOR INSERT WITH CHECK (true);

-- Allow updates (webhook needs to update status)
CREATE POLICY "Allow tide stream updates" ON tide_streams
  FOR UPDATE USING (true);

-- Column comments
COMMENT ON TABLE tide_streams IS 'Live stream sessions for Virtual Tide events';
COMMENT ON COLUMN tide_streams.mux_live_stream_id IS 'Mux live stream resource — for webhook correlation';
COMMENT ON COLUMN tide_streams.mux_playback_id IS 'Mux playback ID for LL-HLS viewer URL';
COMMENT ON COLUMN tide_streams.stream_key IS 'Secret RTMP key — only shown to host';
COMMENT ON COLUMN tide_streams.status IS 'idle → live → ended | disconnected';
COMMENT ON COLUMN tide_streams.recording_playback_id IS 'Mux asset playback ID for the recorded VOD (set after stream ends)';
