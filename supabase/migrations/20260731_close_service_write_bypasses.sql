-- ============================================================================
-- Close the "Service write" policies that were granted to {public} (§9.34)
--
-- Companion to 20260731_drop_dev_rls_bypass.sql. That one handles the `dev_*`
-- bypasses from `002`; this one handles a second family found in the full policy
-- dump (2026-07-31): policies NAMED for the server but granted to {public} with
-- `USING (true)` / `WITH CHECK (true)`.
--
-- WHY THESE ARE SAFE TO SIMPLY DROP: Supabase's `service_role` has BYPASSRLS.
-- Server-side writes never consult a policy, so a policy that exists "so the
-- backend can write" is not load-bearing — it is only a client-facing hole. Every
-- table touched below was checked against the client code first, and the client
-- only ever SELECTs from them.
--
-- WHY THIS MATTERS MORE THAN VANDALISM: these are the tables the trust surfaces
-- read. §9.11 and §9.28 removed badge claims that were not backed by anything;
-- these policies let anyone forge the backing itself:
--
--   orders              → `verifiedSales` → "Established Seller" (§9.11)
--   marketplace_reviews → avg rating → `checkMasterBreederEligibility` → Master
--                         Breeder (§9.28, §12.7)
--   reward_distributions / reward_pool_ledger → payout records
--
-- ⚠️ Three related holes are deliberately NOT closed here because the client
-- genuinely writes them and dropping would break the app. They are architectural,
-- not policy bugs. See SECTION C.
-- ============================================================================

BEGIN;

-- ── orders: the settlement record ───────────────────────────────────────────
-- `WITH CHECK (true)` on {public}, so any client holding the anon key could
-- insert order rows. Orders back GMV, protocol fees, and the `verifiedSales`
-- count that §9.11 made "Established Seller" depend on — precisely so the badge
-- could not be earned by typing a number into a form. This policy let it be
-- earned by inserting a row instead.
-- Verified: the client only SELECTs `orders` (ordersSync, foundersAnalytics).
-- Inserts come from the Stripe webhook, which uses service_role.
DROP POLICY IF EXISTS "Service can insert orders" ON orders;

-- ── order_status_history: forged state transitions ──────────────────────────
-- Verified: client SELECT only (ordersSync.js:366).
DROP POLICY IF EXISTS "Service can insert status history" ON order_status_history;

-- ── marketplace_reviews / review_reports: FOR ALL, true/true ────────────────
-- `FOR ALL` with both `USING (true)` and `WITH CHECK (true)` on {public} means
-- write, rewrite, or delete ANY review. Reviews feed `reviewAggregation`, and
-- `checkMasterBreederEligibility` requires a ≥4.0 average — so this is a second
-- route to the Master Breeder title that §9.28 spent effort making meaningful,
-- and a route to erasing a bad review.
-- Verified: no client code references either table; reviews are written through
-- the authenticated `/api` path (`reviewsApi` uses `setSessionTokenGetter`).
DROP POLICY IF EXISTS "Service role full access reviews" ON marketplace_reviews;
DROP POLICY IF EXISTS "Service role full access review reports" ON review_reports;

-- ── reward payouts ──────────────────────────────────────────────────────────
-- `reward_distributions."Service write distributions"` let any client mint a
-- distribution row; `"Users read own distributions"` was `USING (true)`, so the
-- whole payout table was world-readable despite the name.
-- Verified: client SELECTs `reward_distributions` filtered by its own wallet
-- (rewardsPoolApi.js), so a wallet-scoped policy is sufficient. No client
-- reference to `reward_pool_ledger` at all.
DROP POLICY IF EXISTS "Service write distributions" ON reward_distributions;
DROP POLICY IF EXISTS "Users read own distributions" ON reward_distributions;
DROP POLICY IF EXISTS "Service write pool_ledger" ON reward_pool_ledger;

CREATE POLICY "distributions_select_own"
  ON reward_distributions FOR SELECT
  USING (
    wallet_address = ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address')
  );

-- `reward_pool_ledger."Public read pool_ledger"` is INTENTIONALLY kept: the pool
-- is a shared, published figure. Only the write path closes.

-- ── xp_events: the public read defeated the scoped ones ─────────────────────
-- `20260624120000_xp_server_authority.sql` created `xp_events_select_own_jwt`
-- and `xp_events_select_own_anon` to scope reads to the caller. Both are live —
-- and irrelevant, because `"Public read xp_events"` is `USING (true)` and
-- permissive policies OR together. A scoped policy alongside an unscoped one is
-- just an unscoped one.
-- Verified: the only client read is `.eq("wallet_address", wallet)`
-- (zoneLeaderboardApi.js:332), which the scoped policies already satisfy.
DROP POLICY IF EXISTS "Public read xp_events" ON xp_events;

COMMIT;

-- ============================================================================
-- SECTION C — NOT closed here, because the client genuinely writes these
--
-- All three are real holes. None can be fixed by dropping a policy, because the
-- app depends on the write path. They need a server-side write route first, so
-- they are recorded rather than half-done.
--
-- 1. `xp_events."Service write xp_events"` (INSERT, WITH CHECK true)
--    `20260624120000_xp_server_authority.sql` states in a comment:
--        "No INSERT policy for anon or authenticated — only service_role can insert."
--    That is NOT what is deployed, and the client inserts XP events directly at
--    `zoneLeaderboardApi.js:257`. So the migration's intent and the app's
--    behaviour disagree, and this policy is what lets the app work. Dropping it
--    breaks XP awards; keeping it lets anyone mint XP.
--
-- 2. `user_xp_profiles."Anon write"` / `"Anon update"` (INSERT/UPDATE, true)
--    `cloudSync.syncXpProfileToCloud` upserts `total_xp` from the client. Note a
--    wallet-scoped policy would NOT actually fix this: it would stop you editing
--    someone else's XP but not your own, and the client is the one asserting the
--    number. XP gates entitlements (§10) and the "Experienced Breeder" chip
--    (§9.28), so this is a privilege surface, not just a score.
--
--    THE REAL FIX for 1 and 2 together: make `xp_events` the only writable
--    record (server-side, through an authenticated endpoint — `useXPSync`
--    already carries a Privy token for validation) and derive
--    `user_xp_profiles` from it. That is what "server authority" meant.
--
-- 3. `zones."Service write zones"` (FOR ALL, true/true)
--    `zoneLeaderboardApi.js:218` upserts zones from the client. Needs either a
--    server route or a policy scoped to zone creation rather than FOR ALL.
--
-- ── AND the `dev_*` social write bypasses, which are a separate pass ─────────
-- The full dump shows `dev_*` write policies well beyond the fourteen `002`
-- created — on expert_audits, follows, mentorships, messages, morph_submissions,
-- profiles, reactions, school_challenges, school_chat, school_invites,
-- school_members, schools, sonar_notifications, species_insights, tide_attendees,
-- tide_chat and tides. Several have un-prefixed twins with the same `true` shape
-- ("Allow follow inserts", "Allow sending messages", "Allow school creation",
-- "Users read messages", …).
--
-- Worst of that set, by consequence rather than by count:
--   profiles          dev_profiles_update  → rewrite any user's profile
--   messages          insert/select/update → send as anyone, read every DM
--   morph_submissions dev_morph_insert     → forge a submission into the
--                                            verified-morph pipeline (§9.13)
--   expert_audits     dev_expert_audits_insert → forge an expert audit
--   schools/school_members → delete any school, add or remove any member
--
-- Not attempted here: each needs a correct replacement written against columns
-- this audit has not read, and doing seventeen tables blind in one migration is
-- how a lockout happens. Do them in small, verifiable batches.
-- ============================================================================
