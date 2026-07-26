-- ============================================================================
-- aquadex_listings — RLS lockdown (Fish Finder Rework, Task 4c) — STAGED FIX
-- ============================================================================
-- ⚠️  DO NOT APPLY YET. This file lives in supabase/checks/ (NOT migrations/)
--     on purpose, so `supabase db push` cannot auto-apply a security change
--     before it is verified. Promote it only after the two prerequisites below.
--
-- PURPOSE: make the aggregate endpoint (/api/species-availability) the ONLY
-- public read path for listings by removing anonymous read of the raw table.
--
-- PREREQUISITES (both required before applying):
--   1. Run aquadex_listings_rls_check.sql — confirm anon CAN currently read
--      (otherwise there's nothing to fix).
--   2. Confirm the in-app marketplace board is LOGIN-GATED (not browsable while
--      logged out). If logged-out browsing is intended, DO NOT apply this —
--      anon must keep read access; see "Variant B" at the bottom instead.
--
-- WHY THIS IS SAFE FOR THE SERVER: the Supabase service_role BYPASSES RLS, so
-- /api/species-availability and all server-side writes keep working unchanged.
-- This only affects the browser `anon`/`authenticated` roles.
--
-- TO APPLY when ready:
--   1. Move/rename this file into migrations/ with a date prefix AFTER the
--      latest migration, e.g.  migrations/20260728_aquadex_listings_rls.sql
--   2. supabase db push
--   3. Re-run the curl anon test in the check file — it should now return []/error.
--   4. Smoke-test the in-app marketplace board while LOGGED IN (should still
--      list) and LOGGED OUT (expected empty if login-gated).
--
-- REVERSIBILITY: to roll back, re-grant read — either
--   `alter table aquadex_listings disable row level security;`
--   or add back a permissive policy (see Variant B).
-- ============================================================================

-- Variant A (RECOMMENDED — marketplace requires login to browse):
-- Enable RLS, drop any permissive public-read policy, and allow reads only for
-- authenticated sessions (the app's Privy-bridged JWT counts as authenticated).
-- anon is blocked; service_role bypasses RLS.

alter table aquadex_listings enable row level security;

-- Drop a permissive public-read policy if one exists (name may differ — check
-- pg_policies output from the check file and adjust). Harmless if absent.
drop policy if exists "Public read access"        on aquadex_listings;
drop policy if exists "Allow public read"          on aquadex_listings;
drop policy if exists "Enable read access for all" on aquadex_listings;

-- Authenticated (logged-in) users can read listings; anon cannot.
create policy "Authenticated read listings"
  on aquadex_listings
  for select
  to authenticated
  using (true);

-- Server writes go through the service role, which bypasses RLS; no explicit
-- write policy is required. (Add one only if a non-service path writes here.)

-- ----------------------------------------------------------------------------
-- Variant B — marketplace IS meant to be publicly browsable (logged out).
-- Then anon MUST keep read access and you should NOT run Variant A. In that
-- case raw listings are public by design, the aggregate endpoint adds no new
-- exposure, and the real mitigation is to ensure the row `data` blob contains
-- no sensitive fields you don't intend to publish. Keep (or (re)create):
--
--   alter table aquadex_listings enable row level security;
--   create policy "Public read listings" on aquadex_listings
--     for select using (true);   -- applies to anon + authenticated
-- ----------------------------------------------------------------------------
