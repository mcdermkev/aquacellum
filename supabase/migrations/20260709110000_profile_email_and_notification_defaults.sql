-- ============================================================================
-- Add profiles.email (for Resend transactional/retention email) and backfill
-- sensible notification_preferences defaults for existing rows.
--
-- notification_preferences already exists (jsonb, default '{}') and is read
-- by SonarPreferences.jsx with a client-side DEFAULT_PREFS fallback merged in
-- via `{ ...DEFAULT_PREFS, ...data.notification_preferences }`. All 73 existing
-- profiles currently have '{}' stored, meaning:
--   - The client-side merge already gives them working defaults on next load
--     of SonarPreferences (so this isn't broken), but server-side jobs (the
--     upcoming daily retention job) need a real value to read directly via
--     SQL without duplicating the client's default-merge logic.
--   - Backfilling the same shape server-side keeps both paths consistent and
--     lets the retention job filter on notification_preferences->>'emailDigest'
--     without every row being an empty object.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / only touches rows still at '{}').
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill existing '{}' rows with the same default shape SonarPreferences.jsx
-- uses client-side, so server-side jobs can read consistent keys.
UPDATE public.profiles
SET notification_preferences = jsonb_build_object(
  'categories', jsonb_build_object(
    'activity', jsonb_build_object('enabled', true, 'push', false),
    'social', jsonb_build_object('enabled', true, 'push', true),
    'event', jsonb_build_object('enabled', true, 'push', true),
    'milestone', jsonb_build_object('enabled', true, 'push', false),
    'poseidon', jsonb_build_object('enabled', true, 'push', false)
  ),
  'quietHours', jsonb_build_object('enabled', false, 'start', '22:00', 'end', '08:00'),
  'emailDigest', 'off',
  -- New keys used by the retention system (task #7): opt-in win-back /
  -- streak-risk emails, separate from the existing Poseidon digest setting.
  'retentionEmail', true
)
WHERE notification_preferences = '{}'::jsonb OR notification_preferences IS NULL;

-- Set the same full default shape (including the new retentionEmail key) as
-- the column default so newly-created profiles get it without relying on the
-- client to send the full object on first save.
ALTER TABLE public.profiles ALTER COLUMN notification_preferences SET DEFAULT jsonb_build_object(
  'categories', jsonb_build_object(
    'activity', jsonb_build_object('enabled', true, 'push', false),
    'social', jsonb_build_object('enabled', true, 'push', true),
    'event', jsonb_build_object('enabled', true, 'push', true),
    'milestone', jsonb_build_object('enabled', true, 'push', false),
    'poseidon', jsonb_build_object('enabled', true, 'push', false)
  ),
  'quietHours', jsonb_build_object('enabled', false, 'start', '22:00', 'end', '08:00'),
  'emailDigest', 'off',
  'retentionEmail', true
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email) WHERE email IS NOT NULL;
