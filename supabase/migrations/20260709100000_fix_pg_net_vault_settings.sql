-- ============================================================================
-- FIX: pg_net triggers/cron jobs were calling
-- current_setting('app.settings.supabase_url') / current_setting('app.settings.service_role_key')
-- but those custom GUCs were never configured on this hosted project (hosted
-- Supabase does not allow ALTER DATABASE ... SET on arbitrary app.* params —
-- "permission denied to set parameter"). This meant every pg_net-backed
-- notification/cron job has been failing on EVERY run since it was created:
--
--   - orders_notify_on_change trigger (marketplace push notifications) — every
--     order insert/status change silently failed to notify buyer/seller.
--   - cron jobs: tide-lifecycle (every minute), reef-digest (weekly),
--     breeder-summary (weekly), anti-gaming (daily), distribute-rewards (monthly)
--     — all failed with "unrecognized configuration parameter".
--
-- Confirmed via cron.job_run_details: 100% failure rate, error
--   "unrecognized configuration parameter \"app.settings.service_role_key\""
--
-- FIX: store project URL + service role key in Supabase Vault (the supported
-- mechanism on hosted projects) and read them from vault.decrypted_secrets
-- instead of custom GUCs. Vault secrets were seeded via:
--   select vault.create_secret('<url>', 'project_url', '...');
--   select vault.create_secret('<key>', 'service_role_key', '...');
-- (already run against this project before this migration).
--
-- Idempotent: safe to re-run. cron.unschedule is a no-op if the job name/id
-- doesn't exist (guarded), and CREATE OR REPLACE FUNCTION is always safe.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix the orders trigger function to read from Vault instead of app.settings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    v_payload := jsonb_build_object(
      'type', TG_OP,
      'table', 'orders',
      'record', to_jsonb(NEW),
      'old_record', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END
    );

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/order-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := v_payload
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reschedule the 5 pg_net-backed cron jobs to use Vault-based commands.
--    (Job #6, refresh_leaderboard_views, doesn't touch app.settings — left as-is.)
-- ─────────────────────────────────────────────────────────────────────────────

-- NOTE: the original tide-lifecycle job was registered under the name
-- 'tide-lifecycle-check' (not 'tide-lifecycle'), so it must be included
-- explicitly here or it survives as a duplicate broken job running every minute.
DO $$
DECLARE
  jid INT;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN
    ('tide-lifecycle', 'tide-lifecycle-check', 'reef-digest', 'breeder-summary', 'anti-gaming', 'distribute-rewards')
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'tide-lifecycle',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/tide-lifecycle',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);

SELECT cron.schedule(
  'reef-digest',
  '0 9 * * 0',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/reef-digest',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);

SELECT cron.schedule(
  'breeder-summary',
  '0 3 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/breeder-summary',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);

SELECT cron.schedule(
  'anti-gaming',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/anti-gaming',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
  )
  $$
);

SELECT cron.schedule(
  'distribute-rewards',
  '5 0 1 * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/distribute-rewards',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'
  )
  $$
);
