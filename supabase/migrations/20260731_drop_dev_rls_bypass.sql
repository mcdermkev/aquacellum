-- ============================================================================
-- Remove the development RLS bypass policies from production (§9.34)
--
-- `002_dev_rls_bypass.sql` created a set of unconditional policies for MVP
-- testing. Its own header says:
--
--     ⚠️  REMOVE THESE BEFORE PRODUCTION by running: [DROP POLICY ...]
--
-- Those DROPs were never run. A policy dump taken 2026-07-31 confirms they are
-- live, that every policy on this database is PERMISSIVE, and that several
-- non-`dev_` policies have the same unconditional shape.
--
-- WHY PERMISSIVE MATTERS: PostgreSQL combines permissive policies for the same
-- command with OR. So a single `USING (true)` policy makes every restrictive
-- sibling on that command irrelevant. `dev_comments_delete` does not "also allow"
-- deletes — it means "Users delete own comments" is not enforced at all, and
-- anyone holding the anon key can delete anyone's comment.
--
-- WHY DROPPING SERVER-FACING POLICIES IS SAFE: Supabase's `service_role` has
-- BYPASSRLS. Server-side writes do not depend on any policy, so a policy that
-- exists "so the backend can write" is not load-bearing — it is only a hole. The
-- `auth.role() = 'service_role'` policies elsewhere in this database are
-- belt-and-braces and are left alone for consistency.
--
-- ⚠️ APPLY IN A TRANSACTION AND VERIFY BEFORE COMMITTING. Section B changes
-- enforcement on paths real users hit. Each section notes what to check.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A — bypasses whose correct replacement ALREADY EXISTS
--
-- For each of these the properly-scoped policy is already in place alongside the
-- bypass, so dropping the bypass restores the intended rule and changes nothing
-- else. This is the low-risk half.
-- ─────────────────────────────────────────────────────────────────────────────

-- comments: "Users post comments" / "Users delete own comments" take over.
DROP POLICY IF EXISTS "dev_comments_insert" ON comments;
DROP POLICY IF EXISTS "dev_comments_delete" ON comments;

-- currents: "Authors insert/update/delete own currents" take over.
DROP POLICY IF EXISTS "dev_currents_insert" ON currents;
DROP POLICY IF EXISTS "dev_currents_update" ON currents;
DROP POLICY IF EXISTS "dev_currents_delete" ON currents;

-- connection_requests: "Users send requests" / "Recipients can update requests"
-- take over. The two "Allow connection request ..." policies are the same hole
-- without the `dev_` name, so they go too.
DROP POLICY IF EXISTS "dev_requests_insert" ON connection_requests;
DROP POLICY IF EXISTS "dev_requests_update" ON connection_requests;
DROP POLICY IF EXISTS "Allow connection request inserts" ON connection_requests;
DROP POLICY IF EXISTS "Allow connection request updates" ON connection_requests;

-- audit_requests: "Users create audit requests", "Anyone can read open audit
-- requests" and "Auditors claim/complete requests" take over.
DROP POLICY IF EXISTS "dev_audit_requests_insert" ON audit_requests;
DROP POLICY IF EXISTS "dev_audit_requests_select" ON audit_requests;
DROP POLICY IF EXISTS "dev_audit_requests_update" ON audit_requests;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B — holes where dropping alone is NOT enough
--
-- Either the "real" policy is itself unconditional, or dropping leaves the
-- command with no policy at all. Each is replaced rather than merely removed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── conversations: private messages were world-readable ─────────────────────
-- "Users read own conversations" was `USING (true)` — the policy name asserted a
-- restriction it did not implement — and `dev_conversations_select` was a second
-- `true` on the same command. Replaced with an actual participant check.
--
-- ⚠️ VERIFY: this now depends on the JWT bridge minting a `wallet_address` claim.
-- If it fails to mint, a user sees no conversations rather than someone else's.
-- That is the correct failure direction, but confirm the bridge is reliable
-- (§11.3 / §9.20) before shipping, or DMs will look empty.
DROP POLICY IF EXISTS "dev_conversations_select" ON conversations;
DROP POLICY IF EXISTS "dev_conversations_insert" ON conversations;
DROP POLICY IF EXISTS "dev_conversations_update" ON conversations;
DROP POLICY IF EXISTS "Users read own conversations" ON conversations;
DROP POLICY IF EXISTS "Allow conversation creation" ON conversations;
DROP POLICY IF EXISTS "Allow conversation updates" ON conversations;

CREATE POLICY "conversations_select_participant"
  ON conversations FOR SELECT
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address') IN (participant_a, participant_b)
  );

CREATE POLICY "conversations_insert_participant"
  ON conversations FOR INSERT
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address') IN (participant_a, participant_b)
  );

CREATE POLICY "conversations_update_participant"
  ON conversations FOR UPDATE
  USING (
    ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address') IN (participant_a, participant_b)
  )
  WITH CHECK (
    ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address') IN (participant_a, participant_b)
  );

-- ── credit_transactions: a money-adjacent table, open both ways ─────────────
-- "Users read own credits" was `(wallet_address = <claim>) OR true` — the `OR
-- true` made the wallet check decorative and the whole ledger world-readable.
-- "Service write credits" was `WITH CHECK (true)` on {public}, so any client
-- could mint itself credit rows. The server does not need it: service_role
-- bypasses RLS.
DROP POLICY IF EXISTS "Users read own credits" ON credit_transactions;
DROP POLICY IF EXISTS "Service write credits" ON credit_transactions;

CREATE POLICY "credits_select_own"
  ON credit_transactions FOR SELECT
  USING (
    wallet_address = ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address')
  );

-- No INSERT policy on purpose. Credits are issued server-side only, and
-- service_role bypasses RLS, so granting clients an insert path would be the
-- hole this migration exists to close.

-- ── breeder_profiles / breeder_stats: the Master Breeder flag was writable ───
-- Both carried "Service role full access ..." as {public} with USING (true) and
-- WITH CHECK (true) — the name claimed a role restriction the predicate did not
-- make. `breeder_profiles.is_master_breeder` is the ONLY remaining definition of
-- Master Breeder after §9.28, and `breederRegistry.updateBreederProfile` upserts
-- arbitrary fields, so any client could award itself the badge the whole §12
-- pedigree effort exists to make meaningful.
--
-- Replaced with the actual role check, matching the `canonical_*` convention
-- already used in this database. Public READ is intentional and stays.
DROP POLICY IF EXISTS "Service role full access profiles" ON breeder_profiles;
DROP POLICY IF EXISTS "Service role full access stats" ON breeder_stats;

CREATE POLICY "breeder_profiles_service_role"
  ON breeder_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "breeder_stats_service_role"
  ON breeder_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ⚠️ VERIFY: a breeder editing their own storefront profile now needs a
-- server-side path. If `updateBreederProfile` is called directly from the client
-- it will start failing — which is the point (it could set `is_master_breeder`),
-- but the legitimate self-edit fields need an endpoint or a narrower policy that
-- lists them explicitly. Check before shipping.

-- ── depth_score_events: reputation ledger was world-readable ────────────────
-- "Users read own depth events" was `USING (true)`, another policy whose name
-- described a restriction it did not implement.
DROP POLICY IF EXISTS "Users read own depth events" ON depth_score_events;

CREATE POLICY "depth_events_select_own"
  ON depth_score_events FOR SELECT
  USING (
    wallet_address = ((current_setting('request.jwt.claims', true))::json ->> 'wallet_address')
  );

-- ── auction_bids: anyone could place or alter a bid ─────────────────────────
-- "Users place own bids" already scopes INSERT to the bidder, so the dev insert
-- is redundant. The dev UPDATE is dropped with NO replacement: a bid is an
-- append-only record and its `status` transitions (active → outbid/won/refunded)
-- are settlement decisions that belong to the server, which bypasses RLS.
DROP POLICY IF EXISTS "dev_auction_bids_insert" ON auction_bids;
DROP POLICY IF EXISTS "dev_auction_bids_update" ON auction_bids;

COMMIT;

-- ============================================================================
-- SECTION C — DELIBERATELY NOT DONE HERE
--
-- 1. `dev_notifications_insert` ON sonar_notifications is LEFT IN PLACE.
--    `002` says it exists "(allows triggers to fire)", and `003` /
--    `004` are both notification-trigger repairs — so this database has a
--    history of breaking exactly this path. A trigger runs as the invoking role
--    unless its function is SECURITY DEFINER, so dropping this policy may stop
--    notifications being written with no error surfaced to the user.
--    The correct fix is to make the notification trigger function SECURITY
--    DEFINER and then drop the policy. Check the function first:
--
--      SELECT p.proname, p.prosecdef
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname ILIKE '%notif%';
--
--    `prosecdef = true` means it is already SECURITY DEFINER and the policy can
--    go; `false` means fix the function first.
--
-- 2. FOUR MORE BYPASSES NAMED IN `002` ARE NOT ADDRESSED, because the policy
--    dump was truncated alphabetically at `echo_companion_state` and these all
--    sort after it:
--
--      dev_profiles_insert, dev_profiles_update   ON profiles
--      dev_reactions_insert, dev_reactions_delete ON reactions
--      dev_follows_insert, dev_follows_delete     ON follows
--
--    `dev_profiles_update` is `USING (true)` on the profiles table, which would
--    mean any client can rewrite any user's profile. Get the rest of the dump
--    before assuming otherwise:
--
--      SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
--      FROM pg_policies
--      WHERE schemaname = 'public'
--        AND (qual = 'true' OR with_check = 'true' OR policyname LIKE 'dev_%')
--      ORDER BY tablename, policyname;
--
--    That filter returns only the suspicious policies, so it will not truncate.
--
-- 3. The `aquadex_*` header-vs-JWT dual mode is NOT touched. That is §9.20, a
--    documented and deliberate cutover, and it is a different (smaller) problem:
--    a spoofable identity, not an absent check. Complete it separately, after
--    confirming the JWT bridge mints reliably.
-- ============================================================================
