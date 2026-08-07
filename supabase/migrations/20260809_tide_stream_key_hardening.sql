-- ============================================================================
-- Migration: Protect the secret RTMP stream_key on tide_streams
--
-- tide_streams has a public SELECT RLS policy so viewers can read the non-secret
-- mux_playback_id / status. But column privileges are INDEPENDENT of RLS, and the
-- table also holds `stream_key` — the secret RTMP key that lets anyone broadcast
-- as the host. With table-wide SELECT granted to the client roles, every user
-- could read every host's key.
--
-- Fix: revoke table-wide SELECT from anon/authenticated and re-grant SELECT on
-- every column EXCEPT stream_key. Nothing legitimate breaks:
--   - the host receives its key directly from the stream-setup response, never
--     from a table read (and the client query now selects explicit columns),
--   - the Mux webhook writes via the service role, which bypasses column grants,
--   - INSERT/UPDATE privileges are untouched.
--
-- This is applied even though video is deferred for launch (TIDE_VIDEO_ENABLED
-- is false), so the hole is closed before any stream row can ever exist.
--
-- Run this in the Supabase SQL Editor (hand-applied — see supabase/migration-order.json).
-- ============================================================================

REVOKE SELECT ON public.tide_streams FROM anon, authenticated;

GRANT SELECT (
  id,
  tide_id,
  host_wallet,
  mux_live_stream_id,
  mux_playback_id,
  status,
  recording_playback_id,
  created_at
) ON public.tide_streams TO anon, authenticated;
