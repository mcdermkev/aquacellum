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
-- NOTE: aquadex_listings is not created by any tracked migration in this repo,
-- so its RLS state lives only in the live database — hence this check.
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
-- ALSO VERIFY (product decision, not SQL): is the in-app marketplace board
-- meant to be browsable while LOGGED OUT? The app's Supabase client falls back
-- to the anon role when unauthenticated (see src/services/supabaseClient.js),
-- so if the board is public-by-design, anon MUST read listings and locking it
-- would break logged-out browsing. Decide that before applying the fix.
-- ----------------------------------------------------------------------------
