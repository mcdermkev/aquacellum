-- ============================================================================
-- aquadex_listings — RLS exposure check (Fish Finder Rework, Task 4c)
-- ============================================================================
-- READ-ONLY. Safe to run anytime. Answers the one question that matters for
-- the public availability endpoint (/api/species-availability):
--
--     Can the public `anon` role SELECT raw rows from aquadex_listings?
--
-- If yes, the raw listing `data` blobs (seller wallet addresses, exact prices,
-- full inventory) are publicly scrapable by anyone with the client anon key —
-- independent of the aggregate endpoint. The endpoint reads with the SERVICE
-- key and returns aggregates only; the goal is that it is the ONLY public
-- read path.
--
-- CORRECTION (T14): an earlier version of this note claimed aquadex_listings is
-- "not created by any tracked migration". It is — supabase/migrations/
-- 20260618_cloud_listings_table.sql creates the table and its original
-- `anon full access listings` policy, and 20260619_tighten_cloud_sync_rls.sql
-- replaces that with `listings_select_public` (anon, using (true)), which is the
-- exposure this check confirms. 20260624110000_jwt_bridge_rls_upgrade.sql adds
-- the `_jwt` (authenticated) counterparts. The expected policy set is therefore
-- known from the repo; this check verifies the LIVE database matches it.
--
-- HOW TO RUN (any one):
--   psql "<db-connection-string>" -f aquadex_listings_rls_check.sql
--   (connection string: `supabase link` then dashboard Settings→Database,
--    or copy the pooler/direct URL)
--   …or paste into the Supabase SQL editor.
-- ============================================================================

-- 1) Is RLS enabled on the table?
--    relrowsecurity = false  → RLS OFF → anon can read everything (EXPOSED).
--    relrowsecurity = true   → RLS ON  → see the policies in (2).
select relname            as table_name,
       relrowsecurity     as rls_enabled,
       relforcerowsecurity as rls_forced
from   pg_class
where  relname = 'aquadex_listings';

-- 2) Which policies apply, to which roles, with what condition?
--    EXPOSED if any row has:  cmd IN ('SELECT','ALL')
--      AND roles overlaps {anon, public}  AND  qual = 'true'.
--    SAFE if no SELECT/ALL policy applies to anon/public.
select policyname,
       cmd,
       roles,
       qual        as using_expression,
       with_check
from   pg_policies
where  tablename = 'aquadex_listings'
order  by cmd, policyname;

-- 3) Raw table grants — does the anon role even hold the SELECT privilege?
--    (Supabase grants anon SELECT on public tables by default, so RLS in (1)/(2)
--     is the real gate; this is a belt-and-suspenders view.)
select grantee,
       privilege_type
from   information_schema.role_table_grants
where  table_name = 'aquadex_listings'
order  by grantee, privilege_type;

-- ----------------------------------------------------------------------------
-- 4) THE DEFINITIVE REAL-WORLD TEST (run in a shell, not psql).
--    Uses ONLY the public anon key — exactly what a scraper has:
--
--    curl "https://<PROJECT-REF>.supabase.co/rest/v1/aquadex_listings?select=data&limit=1" \
--      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--
--    Rows returned  → anon CAN read raw listings (EXPOSED → see the fix file).
--    [] or an error → anon is blocked (SAFE).
--
--    <ANON_KEY> = VITE_SUPABASE_ANON_KEY (in .env / the client bundle).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- RESOLVED (T14) — this used to ask whether logged-out browsing was intended.
-- It is: marketplace.html, species.html (3 call sites) and store.html all read
-- listings anonymously. So a blunt anon revoke is NOT the fix; the fix is a
-- display-safe projecting view plus a lockdown of the raw table:
--     supabase/migrations/20260728_aquadex_listings_public_view.sql
--     frontend/supabase/checks/aquadex_listings_rls_lockdown.sql   (staged)
--
-- Second finding worth re-checking here: the in-app client is not reliably
-- `authenticated` either. src/services/supabaseClient.js falls back to the anon
-- role + x-wallet-address header whenever the /api/mint-session JWT bridge
-- fails, which is why the write policies are granted `to anon`. Confirm the
-- bridge works in production BEFORE applying the lockdown — see its
-- prerequisite 3.
-- ----------------------------------------------------------------------------
