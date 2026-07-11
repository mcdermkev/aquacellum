-- ============================================================================
-- Schedule echo-nudge and echo-personality-drift via pg_cron.
--
-- Both edge functions existed in the repo (fully written, referenced in
-- PROJECT_SUMMARY.md and CHANGELOG.md as shipped features) but were never
-- deployed or scheduled — confirmed via `supabase functions list` (11 live
-- functions, missing these two) and `cron.job` (no matching jobs). Deployed
-- via `supabase functions deploy` prior to this migration.
--
-- Uses the same vault.decrypted_secrets pattern as 20260709_fix_pg_net_vault_settings.sql
-- (hosted Supabase does not permit ALTER DATABASE SET on custom app.* GUCs).
--
-- Idempotent: safe to re-run.
-- ============================================================================

DO $$
DECLARE
  jid INT;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('echo-nudge', 'echo-personality-drift')
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

-- Echo nudge: every 4 hours (per the function's own doc comment — need-critical
-- pushes + streak-at-risk pushes, rate-limited to 2/day/user inside the function).
SELECT cron.schedule(
  'echo-nudge',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/echo-nudge',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);

-- Echo personality drift: weekly, Monday 03:00 UTC (per the function's own doc comment).
SELECT cron.schedule(
  'echo-personality-drift',
  '0 3 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/echo-personality-drift',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);
