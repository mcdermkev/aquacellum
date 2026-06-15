-- =============================================================================
-- Migration: Add video support to currents table
-- Phase 1: Short-form video in The Reef social feed
-- =============================================================================

-- Video fields on the currents table
ALTER TABLE currents
  ADD COLUMN IF NOT EXISTS video_upload_id TEXT,
  ADD COLUMN IF NOT EXISTS video_asset_id TEXT,
  ADD COLUMN IF NOT EXISTS video_playback_id TEXT,
  ADD COLUMN IF NOT EXISTS video_thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS video_duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS video_status TEXT,
  ADD COLUMN IF NOT EXISTS video_alt_text TEXT;

-- Index for filtering video-only Currents (feed filters, search)
CREATE INDEX IF NOT EXISTS idx_currents_has_video
  ON currents (created_at DESC)
  WHERE video_playback_id IS NOT NULL;

-- Index for webhook correlation (Mux fires webhooks with upload_id or asset_id)
CREATE INDEX IF NOT EXISTS idx_currents_video_upload_id
  ON currents (video_upload_id)
  WHERE video_upload_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_currents_video_asset_id
  ON currents (video_asset_id)
  WHERE video_asset_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN currents.video_upload_id IS 'Mux direct upload ID — set at post creation time, used for webhook correlation';
COMMENT ON COLUMN currents.video_asset_id IS 'Mux asset ID — set when upload.asset_created webhook fires';
COMMENT ON COLUMN currents.video_playback_id IS 'Mux playback ID — set when video.asset.ready webhook fires; used for HLS URL construction';
COMMENT ON COLUMN currents.video_thumbnail_url IS 'Auto-generated poster frame URL from Mux (https://image.mux.com/{id}/thumbnail.webp)';
COMMENT ON COLUMN currents.video_duration_seconds IS 'Video duration rounded to nearest second';
COMMENT ON COLUMN currents.video_status IS 'Processing pipeline state: uploading → processing → ready | error';
COMMENT ON COLUMN currents.video_alt_text IS 'AI-generated video description for accessibility (populated async by frame sampling)';
