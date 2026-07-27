-- ============================================================================
-- aquadex_listings — remove anonymous read of the RAW table
-- Fish Finder Rework, Task 14 (Tier A) — STAGED, DO NOT APPLY YET
-- ============================================================================
-- This file lives in supabase/checks/ (NOT migrations/) on purpose so
-- `supabase db push` cannot apply a security change before its prerequisites
-- are actually verified. Promote it only after step 3 below passes.
--
-- Supersedes the earlier `aquadex_listings_rls_fix.sql`, which was WRONG on two
-- counts. Recording both, because either would have caused an outage:
--
--   1. It offered "Variant A — lock SELECT to `authenticated`, marketplace
--      requires login to browse". The marketplace does NOT require login:
--      marketplace.html, species.html (3 call sites) and store.html all browse
--      listings anonymously with the public anon key. Variant A would have
--      blanked the public marketplace.
--   2. Even for the logged-in app, "authenticated" is not a safe assumption.
--      `src/services/supabaseClient.js` mints a Supabase JWT from the Privy
--      token via /api/mint-session, but on ANY failure (endpoint not deployed,
--      missing SUPABASE_JWT_SECRET → 503, network error) it deliberately falls
--      back to the **anon** role plus an `x-wallet-address` header — which is
--      why the write policies (`listings_insert_own` etc.) are granted `to
--      anon`. So revoking anon SELECT also blanks the IN-APP board for any user
--      whose JWT bridge failed. That is the real precondition below.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
-- Drops the `listings_select_public` policy (anon, `using (true)`) created by
-- supabase/migrations/20260619_tighten_cloud_sync_rls.sql, so the RAW row —
-- including the unbounded `data` blob — is no longer anonymously scrapable.
-- Public browsing continues through the `aquadex_listings_public` VIEW, which
-- exposes only allowlisted display fields.
--
-- Deliberately UNCHANGED:
--   * `listings_select_public_jwt`  (authenticated, true) — logged-in app reads
--     the full blob, which it needs (packing profile, DOA terms, care notes).
--   * `listings_insert_own` / `_update_own` / `_delete_own` (anon, header-gated)
--     and their `_jwt` counterparts — sellers keep writing. This changes READ
--     access only.
--   * Everything on `service_role`, which bypasses RLS: the availability
--     aggregate (frontend/api/species.js), storefront-detail.js, and — most
--     importantly — stripe.js's authoritative price validation. No money path
--     is touched.
--
-- ── PREREQUISITES (all three; do not skip 3) ────────────────────────────────
--   1. Apply supabase/migrations/20260728_aquadex_listings_public_view.sql and
--      confirm anon can read the view.
--   2. Deploy the frontend that reads the view (/js/public-listings.js +
--      marketplace.html / species.html / store.html) and smoke-test all three
--      LOGGED OUT. They must show listings.
--   3. Confirm the in-app JWT bridge actually works in production, i.e. that
--      logged-in users reach the `authenticated` role rather than the anon
--      fallback. Practical check: sign in, then in devtools confirm
--      `isFullyAuthenticated()` is true / the request Authorization header
--      carries the minted JWT (not the anon key), and that
--      `supabase.auth.getSession()` returns a session with a `wallet_address`
--      claim. If the bridge is NOT working, applying this WILL empty the in-app
--      marketplace board — fix the bridge first.
--
--      Belt-and-braces alternative if you'd rather not depend on the bridge:
--      instead of relying on `listings_select_public_jwt`, point the in-app
--      `pullCloudListings` (src/services/cloudSync.js) at the public view too,
--      and keep the full-blob read on a service-key endpoint. That decouples
--      the lockdown from the bridge's health, at the cost of one more endpoint.
--
-- ── TO APPLY ────────────────────────────────────────────────────────────────
--   1. Move this file to supabase/migrations/ with a date prefix after the
--      view migration, e.g. migrations/20260729_aquadex_listings_rls_lockdown.sql
--   2. supabase db push
--   3. Verify with the public anon key (should now return [] or an error):
--        curl "https://<REF>.supabase.co/rest/v1/aquadex_listings?select=data&limit=1" \
--          -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      …while the VIEW still returns rows:
--        curl "https://<REF>.supabase.co/rest/v1/aquadex_listings_public?select=data&limit=1" \
--          -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--   4. Smoke-test: public marketplace.html (listings visible), in-app board
--      while LOGGED IN (listings visible), seller can still create a listing.
--
-- ── ROLLBACK (immediate, one statement) ─────────────────────────────────────
--   create policy "listings_select_public" on public.aquadex_listings
--     for select to anon using (true);
-- ============================================================================

-- RLS is already enabled on this table (see 20260618_cloud_listings_table.sql);
-- asserted rather than assumed, and harmless if already on.
alter table public.aquadex_listings enable row level security;

-- The anon read of raw rows. This is the exposure confirmed by
-- aquadex_listings_rls_check.sql (Decision D2).
drop policy if exists "listings_select_public" on public.aquadex_listings;

-- Defensive: earlier permissive names, in case an environment predates the
-- 20260619 migration. No-ops when absent.
drop policy if exists "anon full access listings"     on public.aquadex_listings;
drop policy if exists "Public read access"            on public.aquadex_listings;
drop policy if exists "Allow public read"             on public.aquadex_listings;
drop policy if exists "Enable read access for all"    on public.aquadex_listings;
drop policy if exists "Public read listings"          on public.aquadex_listings;

-- NOTE: no new SELECT policy is created here. Authenticated reads already work
-- via `listings_select_public_jwt` (supabase/migrations/20260624110000_jwt_bridge_rls_upgrade.sql),
-- anonymous reads go through the aquadex_listings_public view, and service_role
-- bypasses RLS.
