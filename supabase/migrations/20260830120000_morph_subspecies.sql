-- ============================================================================
-- Migration: Morph → Sub-Species promotion (Option A)
--
-- See docs/MORPH_SUBSPECIES_PROMOTION_SPEC.md.
--
-- Adds the off-chain half of promoting a curator-verified morph into a named
-- sub-species/strain: the base→strain parent link (species_strains), the
-- promotion bookkeeping columns on morph_submissions, the 'promoted' status, the
-- explicit 'curator' role grant for the two reviewers, and in-app notifications
-- (bell) on new submissions (to curators) and on status changes (to submitters).
--
-- The on-chain catalog write (addSpecies) and the email are done server-side in
-- api/validate-xp.js — a SQL trigger cannot make outbound HTTP calls.
--
-- Access model mirrors 20260628_morph_submissions.sql and 20260808_keeper_roles.sql:
-- everything here is read-open where a badge/queue must render, and write-locked
-- to the service role / SECURITY DEFINER functions.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Grant the 'curator' role to the two reviewers, keyed by verified email.
--    They already hold 'founder' (founder_emails), and the morph endpoints
--    accept founder OR curator — but entitlements.js maps `morph_review` to the
--    'curator' role specifically, so grant it explicitly and idempotently. The
--    trigger only fires on future profile writes, so backfill existing rows now.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO user_roles (wallet_address, role, granted_by, note)
SELECT p.wallet_address, 'curator', 'system:morph_subspecies',
       'auto-granted from founder_emails allowlist (morph curators)'
FROM profiles p
WHERE lower(p.email) IN (SELECT lower(email) FROM founder_emails)
ON CONFLICT (wallet_address, role) DO UPDATE SET active = true;

-- Also auto-grant 'curator' whenever a founder-email profile is created/updated,
-- so a reviewer switching devices (new embedded wallet) keeps curator rights.
CREATE OR REPLACE FUNCTION tg_grant_curator_on_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND lower(NEW.email) IN (SELECT lower(email) FROM founder_emails) THEN
    INSERT INTO user_roles (wallet_address, role, granted_by, note)
    VALUES (NEW.wallet_address, 'curator', 'system:morph_subspecies',
            'auto-granted on profile email match (morph curators)')
    ON CONFLICT (wallet_address, role) DO UPDATE SET active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_grant_curator_on_profile ON profiles;
CREATE TRIGGER trg_grant_curator_on_profile
  AFTER INSERT OR UPDATE OF email ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION tg_grant_curator_on_profile();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. morph_submissions: promotion bookkeeping + the 'promoted' terminal status.
--    The original status CHECK is unnamed (inline), so Postgres named it
--    morph_submissions_status_check. Drop and re-add to widen the allowed set.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE morph_submissions
  ADD COLUMN IF NOT EXISTS base_species_id     INTEGER,
  ADD COLUMN IF NOT EXISTS promoted_species_id INTEGER,
  ADD COLUMN IF NOT EXISTS promoted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promotion_tx_hash   TEXT;

ALTER TABLE morph_submissions DROP CONSTRAINT IF EXISTS morph_submissions_status_check;
ALTER TABLE morph_submissions
  ADD CONSTRAINT morph_submissions_status_check
  CHECK (status IN ('pending', 'verified', 'rejected', 'promoted'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. species_strains — the off-chain base→strain parent link.
--    A strain IS a real (flat) catalog entry on-chain; this table is the only
--    record that it descends from a base species, since the on-chain Species
--    struct has no parent field. strain_species_id is the promoted catalog id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS species_strains (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_species_id     INTEGER NOT NULL,          -- on-chain speciesId of the base
  strain_species_id   INTEGER NOT NULL UNIQUE,   -- on-chain speciesId of the strain
  morph_submission_id UUID REFERENCES morph_submissions(id) ON DELETE SET NULL,
  strain_name         TEXT NOT NULL,
  created_by          TEXT,                       -- curator wallet that promoted
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One strain name per base species (case-insensitive) — the promote endpoint's
-- dedupe oracle. NOT keyed on scientific name, because a strain deliberately
-- shares its base species' scientific name (only the common name differs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_species_strains_base_name
  ON species_strains (base_species_id, lower(strain_name));
CREATE INDEX IF NOT EXISTS idx_species_strains_base
  ON species_strains (base_species_id);

ALTER TABLE species_strains ENABLE ROW LEVEL SECURITY;

-- Public read (so a "strain of X" label can render for anyone); service-role
-- write only (the promote endpoint uses the service key).
DROP POLICY IF EXISTS "species_strains_public_read" ON species_strains;
CREATE POLICY "species_strains_public_read"
  ON species_strains FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "species_strains_service_write" ON species_strains;
CREATE POLICY "species_strains_service_write"
  ON species_strains FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. In-app notifications (the bell). Email is sent from the API route.
--    Every notify is wrapped so a failure NEVER rolls back the morph write —
--    a notification is a side effect, not part of the transaction's contract.
--    dispatch_notification's recipient_wallet FKs profiles, so each recipient is
--    checked for a profile row first (submitter_wallet is free text and may have
--    no profile).
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a. New submission → notify every active founder/curator.
CREATE OR REPLACE FUNCTION tg_notify_morph_submitted()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
BEGIN
  BEGIN
    FOR r IN
      SELECT DISTINCT ur.wallet_address
      FROM user_roles ur
      JOIN profiles p ON p.wallet_address = ur.wallet_address
      WHERE ur.active AND ur.role IN ('founder', 'curator')
    LOOP
      PERFORM dispatch_notification(
        r.wallet_address,
        'activity',
        '🎨 New morph awaiting review',
        NEW.morph_name || ' (' || NEW.base_species || ') — tap to review',
        '🎨',
        'morph',
        NEW.id::TEXT
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Never let a notification failure block a submission.
    NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_morph_submitted ON morph_submissions;
CREATE TRIGGER trg_notify_morph_submitted
  AFTER INSERT ON morph_submissions
  FOR EACH ROW
  EXECUTE FUNCTION tg_notify_morph_submitted();

-- 4b. Status change → notify the submitter (if they have a profile).
CREATE OR REPLACE FUNCTION tg_notify_morph_reviewed()
RETURNS TRIGGER AS $$
DECLARE
  v_recipient TEXT;
  v_title     TEXT;
  v_body      TEXT;
  v_icon      TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('verified', 'rejected', 'promoted') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT wallet_address INTO v_recipient
    FROM profiles
    WHERE lower(wallet_address) = lower(NEW.submitter_wallet)
    LIMIT 1;

    IF v_recipient IS NULL THEN
      RETURN NEW; -- submitter has no profile row to attach a notification to
    END IF;

    IF NEW.status = 'verified' THEN
      v_title := '✅ Morph verified';
      v_body  := NEW.morph_name || ' passed curator review.';
      v_icon  := '✅';
    ELSIF NEW.status = 'promoted' THEN
      v_title := '🐟 Morph promoted to sub-species';
      v_body  := NEW.morph_name || ' is now a registered strain of ' || NEW.base_species || '.';
      v_icon  := '🐟';
    ELSE
      v_title := 'Morph not accepted';
      v_body  := NEW.morph_name || ' was not accepted' ||
                 COALESCE(' — ' || NULLIF(NEW.review_note, ''), '') || '.';
      v_icon  := '📋';
    END IF;

    PERFORM dispatch_notification(
      v_recipient, 'activity', v_title, v_body, v_icon, 'morph', NEW.id::TEXT
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_morph_reviewed ON morph_submissions;
CREATE TRIGGER trg_notify_morph_reviewed
  AFTER UPDATE OF status ON morph_submissions
  FOR EACH ROW
  EXECUTE FUNCTION tg_notify_morph_reviewed();
