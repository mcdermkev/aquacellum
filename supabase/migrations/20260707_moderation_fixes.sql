-- ============================================================================
-- MODERATION FIXES — align schema with the moderation panel + anti-gaming needs
--
-- WHY:
--   1. Auto-flags (anti-gaming edge function) target a USER, but moderation_flags
--      only had `target_id UUID NOT NULL` (meant for content). Inserting a wallet
--      threw on every auto-flag, so upvote-ring / score-spike detection never
--      persisted a single flag.
--   2. The moderation panel's mute/ban actions write profiles.muted_until /
--      is_banned / banned_at, which did not exist — so mute/ban silently failed.
--
-- WHAT:
--   - moderation_flags.target_id → nullable (profile-target flags have no content UUID)
--   - moderation_flags.target_wallet TEXT → the flagged user (for profile targets
--     and for resolving mute/ban from the panel)
--   - profiles.muted_until / is_banned / banned_at → moderation state columns
--
-- HOW TO RUN: paste into the Supabase SQL Editor and Run. Idempotent + safe to
-- re-run (uses IF EXISTS / IF NOT EXISTS and only relaxes a NOT NULL constraint).
-- ============================================================================

-- 1. moderation_flags: support user-targeted (profile) flags
ALTER TABLE public.moderation_flags ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE public.moderation_flags ADD COLUMN IF NOT EXISTS target_wallet TEXT;

CREATE INDEX IF NOT EXISTS idx_moderation_flags_target_wallet
  ON public.moderation_flags (target_wallet)
  WHERE target_wallet IS NOT NULL;

-- 2. profiles: moderation state used by the moderation panel
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
