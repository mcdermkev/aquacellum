-- ============================================================================
-- Migration: Keeper roles — granted community authority (founders + stewards)
--
-- Replaces TIER-GATING for the six social-authority privileges (create schools,
-- give audits, mentor, host virtual Tides, host expo Tides, moderate) with an
-- explicit GRANT model.
--
-- WHY. Authority over other keepers — judging a pedigree, moderating the
-- community, mentoring — should be conferred by trust, not earned by XP. XP
-- mostly measures how much you sell and is inflation-gameable (a documented
-- known risk), so "grind your way to moderator" is exactly the wrong incentive
-- at the highest-stakes surface. See entitlements.js "SOCIAL AUTHORITY".
--
-- At launch these roles are held by the founders and a hand-picked few. A real
-- earned path can be added LATER, once a keeper-reputation model (verified
-- husbandry outcomes, peer endorsement) exists — this migration does not close
-- that door, it just refuses to fake it with points.
--
-- SECURITY MODEL. The client may READ roles (to render badges and gate UI) but
-- can NEVER grant them. All writes go through service_role or the SECURITY
-- DEFINER functions below; there is no INSERT/UPDATE/DELETE policy for anon or
-- authenticated callers.
--
-- Run this in the Supabase SQL Editor (hand-applied — see supabase/migration-order.json).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Roles table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  role           TEXT NOT NULL,                      -- 'founder' | 'steward' (extensible)
  granted_by     TEXT,                               -- wallet/email/system that granted it
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  active         BOOLEAN NOT NULL DEFAULT true,       -- revoke by setting false, keeps the audit row
  note           TEXT,
  UNIQUE (wallet_address, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_wallet_active
  ON user_roles(wallet_address) WHERE active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — world-readable (so a "Founder"/"Steward" badge can render on any
--    profile), but NO client write path. Only service_role (bypasses RLS) and
--    the SECURITY DEFINER functions below may insert/update.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_public_read" ON user_roles;
CREATE POLICY "user_roles_public_read"
  ON user_roles FOR SELECT
  TO anon, authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Founder allowlist, keyed by VERIFIED EMAIL.
--    Founders sign in with email/Google, so their embedded-wallet address is not
--    known ahead of time and can differ per device. Email is the durable anchor.
--    Not client-readable (no RLS policy) — only service role + definer functions.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS founder_emails (
  email TEXT PRIMARY KEY
);
ALTER TABLE founder_emails ENABLE ROW LEVEL SECURITY;

INSERT INTO founder_emails (email) VALUES
  ('mcdermkev81@gmail.com'),
  ('ggsteve92@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Grant the founder role to every profile whose email is on the allowlist.
--    SECURITY DEFINER so it can write user_roles regardless of the caller.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_founder_roles()
RETURNS INTEGER AS $$
DECLARE
  granted INTEGER;
BEGIN
  WITH ins AS (
    INSERT INTO user_roles (wallet_address, role, granted_by, note)
    SELECT p.wallet_address, 'founder', 'system:founder_emails',
           'auto-granted from founder_emails allowlist'
    FROM profiles p
    WHERE lower(p.email) IN (SELECT lower(email) FROM founder_emails)
    ON CONFLICT (wallet_address, role) DO UPDATE SET active = true
    RETURNING 1
  )
  SELECT count(*) INTO granted FROM ins;
  RETURN granted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger — when a profile is created or its email set to a founder address,
--    auto-grant founder. Guarantees a founder gets the role the moment they have
--    an account, with no one needing to know their wallet in advance.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tg_grant_founder_on_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND lower(NEW.email) IN (SELECT lower(email) FROM founder_emails) THEN
    INSERT INTO user_roles (wallet_address, role, granted_by, note)
    VALUES (NEW.wallet_address, 'founder', 'system:founder_emails',
            'auto-granted on profile email match')
    ON CONFLICT (wallet_address, role) DO UPDATE SET active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_grant_founder_on_profile ON profiles;
CREATE TRIGGER trg_grant_founder_on_profile
  AFTER INSERT OR UPDATE OF email ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION tg_grant_founder_on_profile();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Helper to grant an arbitrary role to a keeper BY EMAIL (the "hand-picked
--    few"). Usage:
--      SELECT grant_role_by_email('someone@example.com', 'steward', 'kevin');
--    Revoke with:
--      UPDATE user_roles SET active = false
--      WHERE wallet_address = (SELECT wallet_address FROM profiles WHERE lower(email)=lower('someone@example.com'))
--        AND role = 'steward';
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_role_by_email(p_email TEXT, p_role TEXT, p_granted_by TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  granted INTEGER;
BEGIN
  WITH ins AS (
    INSERT INTO user_roles (wallet_address, role, granted_by, note)
    SELECT p.wallet_address, p_role, COALESCE(p_granted_by, 'manual'),
           'granted via grant_role_by_email'
    FROM profiles p
    WHERE lower(p.email) = lower(p_email)
    ON CONFLICT (wallet_address, role) DO UPDATE SET active = true
    RETURNING 1
  )
  SELECT count(*) INTO granted FROM ins;
  RETURN granted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backfill — grant any founders who already have accounts.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT grant_founder_roles();
