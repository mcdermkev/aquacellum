-- ============================================================================
-- push_subscriptions — baseline the table that exists in production but in
-- NEITHER migration directory.
--
-- WHY THIS FILE EXISTS. Web Push has never delivered a single notification. The
-- investigation found `public.push_subscriptions` live in production, with 0
-- rows, and absent from both `supabase/migrations/` and
-- `frontend/supabase/migrations/` — so it was created by hand in the SQL editor
-- and its shape was unreproducible and unreviewable. That is exactly the §9.33
-- failure mode the manifest exists to prevent, one level deeper: not a migration
-- nobody knew to apply, but a table with no migration at all.
--
-- Concretely, the missing DDL is why the client's write path could not be
-- reasoned about: `pushService.subscribeToPush()` upserts with
-- `onConflict: "wallet_address,subscription"`, and whether that target existed
-- was unknowable from the repository. (It does — see the UNIQUE below. The
-- delivery bug was elsewhere; see THE ACTUAL DELIVERY BUGS.)
--
-- THIS MIGRATION IS A NO-OP AGAINST PRODUCTION, BY DESIGN. Every statement is
-- idempotent and was written by reading the live catalog
-- (pg_constraint / pg_indexes / pg_policies / information_schema.columns) on
-- 2026-07-31. Applying it to production changes nothing; applying it to a fresh
-- database reproduces production. The one deliberate difference is the explicit
-- `WITH CHECK` on the policy, which is documented below and is semantically
-- identical to what is deployed.
--
-- THE ACTUAL DELIVERY BUGS (fixed outside this file, recorded here so the next
-- reader does not re-diagnose them):
--   1. `VITE_VAPID_PUBLIC_KEY` was never set in Vercel. Vite inlines `VITE_*` at
--      build time, so the production bundle had `undefined` and
--      `subscribeToPush()` bailed before touching permission or the network.
--      Added to Production + Preview 2026-07-31; needs a redeploy to take effect.
--   2. `subscribeToPush()` `console.warn`ed a failed insert and then returned
--      `{ success: true }`, so the UI latched the toggle on over a write that
--      never landed. That is why this table read 0 rows while its unique index
--      had already served 11 scans.
--   3. `SonarPreferences` set the category's `push` flag regardless of whether
--      the subscription succeeded.
-- Server side was healthy throughout: `send-push` ACTIVE v3, both VAPID secrets
-- present in Supabase, and the keypair verified as a genuine P-256 pair.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable in production. Left nullable rather than "corrected" to NOT NULL:
  -- the FK below already makes a NULL wallet useless (it can never be targeted
  -- by send-push, which looks up `.eq("wallet_address", ...)`), and tightening a
  -- live column is a separate decision from baselining it. §6.6.
  wallet_address TEXT REFERENCES public.profiles(wallet_address) ON DELETE CASCADE,
  -- The full PushSubscription JSON from the browser: { endpoint, keys: { p256dh,
  -- auth } }. send-push reads all three and needs every one of them.
  subscription   JSONB NOT NULL,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  -- The ON CONFLICT target the client depends on. One row per (user, browser):
  -- re-subscribing the same browser updates in place, and a second device adds a
  -- row rather than evicting the first, which is what makes multi-device push
  -- work at all.
  CONSTRAINT push_subscriptions_wallet_address_subscription_key
    UNIQUE (wallet_address, subscription)
);

-- Constraints, for the case where the table pre-exists WITHOUT them (a fresh-ish
-- environment bootstrapped from an earlier hand-run snippet). CREATE TABLE above
-- is skipped entirely when the table exists, so its inline constraints are not
-- applied on that path — these blocks are what make the file truly idempotent
-- rather than only appearing to be.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname  = 'push_subscriptions_wallet_address_subscription_key'
  ) THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subscriptions_wallet_address_subscription_key
      UNIQUE (wallet_address, subscription);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND contype  = 'f'
      AND conname  = 'push_subscriptions_wallet_address_fkey'
  ) THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subscriptions_wallet_address_fkey
      FOREIGN KEY (wallet_address)
      REFERENCES public.profiles(wallet_address) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Lookup path used by send-push ───────────────────────────────────────────
-- Every send does `select ... where wallet_address = $1`. The UNIQUE index above
-- is on (wallet_address, subscription) so it can already serve that prefix; this
-- is here because a jsonb second column makes that index wide, and the lookup is
-- on the hot path of every notification.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_wallet
  ON public.push_subscriptions (wallet_address);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Recreated to state the INSERT rule explicitly. What is deployed today is a
-- single `FOR ALL` policy with `USING (wallet_address = auth.jwt() ->>
-- 'wallet_address')` and **`WITH CHECK` NULL**. Postgres reuses the USING
-- expression as the WITH CHECK expression in that case, so INSERT *is* already
-- scoped — but only implicitly, and the read of this policy is what the
-- investigation had to get right to rule it in or out. Writing it out costs
-- nothing and removes that step next time. Semantics are unchanged.
--
-- THIS IS DELIBERATELY JWT-ONLY. Note what is NOT here: an `x-wallet-address`
-- header fallback of the kind several sibling tables still carry. That header is
-- client-supplied and spoofable, and §9.20 has it slated for removal, so adding
-- one here to make the anon path work would reopen the hole two migrations on
-- 2026-07-31 were written to close. The consequence is real and intended:
-- **subscribing to push requires an active JWT bridge** (`/api/mint-session`).
-- When the bridge is down the insert is denied, and the client now surfaces that
-- as "sign in to enable notifications" instead of swallowing it. Failing closed
-- on a notification opt-in is the correct direction.
DROP POLICY IF EXISTS "Users manage own subscriptions" ON public.push_subscriptions;

CREATE POLICY "Users manage own subscriptions"
  ON public.push_subscriptions FOR ALL
  USING      (wallet_address = (auth.jwt() ->> 'wallet_address'))
  WITH CHECK (wallet_address = (auth.jwt() ->> 'wallet_address'));

-- No service_role policy on purpose: service_role has BYPASSRLS, so send-push
-- reads and prunes these rows without consulting a policy. A policy added "so
-- the backend can write" would be client-facing surface only — the reasoning
-- 20260731_close_service_write_bypasses.sql applies at length.

COMMIT;

-- ============================================================================
-- VERIFY (expect the live shape this file was written from)
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid = 'public.push_subscriptions'::regclass;
--     → push_subscriptions_pkey                              PRIMARY KEY (id)
--     → push_subscriptions_wallet_address_subscription_key    UNIQUE (wallet_address, subscription)
--     → push_subscriptions_wallet_address_fkey                FOREIGN KEY (wallet_address) REFERENCES profiles(wallet_address) ON DELETE CASCADE
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename = 'push_subscriptions';
--     → one row, FOR ALL, both predicates on auth.jwt()->>'wallet_address'
--
-- AFTER A REAL SUBSCRIBE, this should stop being empty:
--   SELECT wallet_address, user_agent, created_at FROM push_subscriptions;
-- An empty table after toggling push on in Settings means the opt-in is still
-- failing silently somewhere — which was the entire bug.
-- ============================================================================
