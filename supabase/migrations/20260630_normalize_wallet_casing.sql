-- ============================================================================
-- NORMALIZE WALLET CASING — site-wide canonical lowercase
--
-- WHY: Wallet addresses were stored in mixed casing. profiles.wallet_address is
-- a PRIMARY KEY referenced by ~20 case-sensitive foreign keys. The app sends
-- lowercase (getCurrentWallet), so for every checksummed profile, social writes
-- (follow, join school, invite, RSVP, DM, notifications, etc.) failed the FK.
--
-- WHAT THIS DOES:
--   1. Captures + drops all FKs that reference profiles.wallet_address
--   2. Merges duplicate profiles that collide once lowercased (keeps richest row)
--   3. Lowercases EVERY wallet/address column in the public schema
--   4. Restores the captured FKs exactly as they were
--   5. Installs BEFORE INSERT/UPDATE triggers that force lowercase forever, so
--      no code path can ever reintroduce mixed casing (the permanent guarantee)
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor and Run.
--
-- NOTES:
--   - The Supabase SQL Editor runs each top-level statement in its own
--     transaction (autocommit). This migration is therefore written as exactly
--     TWO statements: (A) create the trigger function, (B) one DO block that
--     performs the whole migration atomically. The DO block holds FK definitions
--     in local variables (NOT a temp table), which is what the previous version
--     got wrong ("relation _fk_backup does not exist"). If the DO block fails at
--     any point, the entire block rolls back — dropped FKs are restored.
--   - Re-runnable: already-lowercase values are skipped; triggers are recreated.
-- ============================================================================


-- ── STATEMENT A: the enforcement function ───────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_lower_wallets() RETURNS trigger AS $fn$
DECLARE
  col text;
  rec jsonb := to_jsonb(NEW);
  changed boolean := false;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF rec ? col AND rec->>col IS NOT NULL AND rec->>col <> lower(rec->>col) THEN
      rec := jsonb_set(rec, ARRAY[col], to_jsonb(lower(rec->>col)));
      changed := true;
    END IF;
  END LOOP;
  IF changed THEN
    NEW := jsonb_populate_record(NEW, rec);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;


-- ── STATEMENT B: the migration (atomic single DO block) ─────────────────────
DO $mig$
DECLARE
  fkrec  record;
  tbls   text[] := '{}';
  names  text[] := '{}';
  defs   text[] := '{}';
  i      int;
  c      record;
  t      record;
BEGIN
  -- 1. Capture FK definitions that reference profiles.wallet_address
  FOR fkrec IN
    SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE confrelid = 'public.profiles'::regclass AND contype = 'f'
  LOOP
    tbls  := array_append(tbls,  fkrec.tbl);
    names := array_append(names, fkrec.conname);
    defs  := array_append(defs,  fkrec.def);
  END LOOP;

  -- 2. Drop them so the primary key can be rewritten
  FOR i IN 1 .. COALESCE(array_length(tbls, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbls[i], names[i]);
  END LOOP;

  -- 3. Merge duplicate profiles that collide once lowercased.
  --    Keep the most-complete row per lower(wallet_address).
  DELETE FROM profiles p
  USING (
    SELECT ctid,
      row_number() OVER (
        PARTITION BY lower(wallet_address)
        ORDER BY
          COALESCE(onboarding_complete, false) DESC,
          (display_name IS NOT NULL) DESC,
          COALESCE(xp_total, 0) DESC,
          created_at ASC
      ) AS rn
    FROM profiles
  ) r
  WHERE p.ctid = r.ctid AND r.rn > 1;

  -- 4. Lowercase every wallet/address column in the public schema.
  --    (Static discovery query; only the UPDATE needs dynamic identifiers.)
  FOR c IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
      AND data_type IN ('text', 'character varying')
      AND ( column_name LIKE '%\_wallet'
            OR column_name IN ('wallet_address','owner_address','seller_address',
                               'participant_a','participant_b','invited_by') )
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = lower(%I) WHERE %I IS NOT NULL AND %I <> lower(%I)',
      c.table_name, c.column_name, c.column_name, c.column_name, c.column_name, c.column_name
    );
  END LOOP;

  -- 5. Restore the captured FKs exactly
  FOR i IN 1 .. COALESCE(array_length(tbls, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', tbls[i], names[i], defs[i]);
  END LOOP;

  -- 6. Install enforcement triggers on every table that has wallet columns
  FOR t IN
    SELECT table_name, string_agg(quote_literal(column_name), ', ') AS arglist
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
      AND data_type IN ('text', 'character varying')
      AND ( column_name LIKE '%\_wallet'
            OR column_name IN ('wallet_address','owner_address','seller_address',
                               'participant_a','participant_b','invited_by') )
    GROUP BY table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_lc_wallets ON public.%I', t.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_lc_wallets BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION enforce_lower_wallets(%s)',
      t.table_name, t.arglist
    );
  END LOOP;
END;
$mig$;


-- ── VERIFY (optional, run separately) ───────────────────────────────────────
-- SELECT 'profiles' AS t, count(*) FILTER (WHERE wallet_address <> lower(wallet_address)) AS mixed FROM profiles
-- UNION ALL SELECT 'currents', count(*) FILTER (WHERE author_wallet <> lower(author_wallet)) FROM currents
-- UNION ALL SELECT 'reactions', count(*) FILTER (WHERE user_wallet <> lower(user_wallet)) FROM reactions
-- UNION ALL SELECT 'comments', count(*) FILTER (WHERE author_wallet <> lower(author_wallet)) FROM comments
-- UNION ALL SELECT 'schools', count(*) FILTER (WHERE founder_wallet <> lower(founder_wallet)) FROM schools
-- UNION ALL SELECT 'school_members', count(*) FILTER (WHERE wallet_address <> lower(wallet_address)) FROM school_members
-- UNION ALL SELECT 'sonar_notifications', count(*) FILTER (WHERE recipient_wallet <> lower(recipient_wallet)) FROM sonar_notifications;
