-- ============================================================================
-- JWT Bridge RLS Upgrade — Cloud Sync & Marketplace Tables
--
-- BEFORE: Header-only (x-wallet-address) for anon role
-- AFTER:  Dual-mode policies that support both:
--   1. Authenticated role (JWT bridge active) — uses auth.jwt()->>'wallet_address'
--   2. Anon role (fallback) — uses request.headers->>'x-wallet-address'
--
-- This allows the transition from header-based to JWT-based auth without
-- breaking existing clients that haven't upgraded yet.
--
-- Once all clients are using the JWT bridge, the anon policies can be
-- dropped entirely by running:
--   DROP POLICY "tanks_select_own" ON public.aquadex_tanks;
--   (repeat for all *_own policies on anon role)
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- TANKS — Authenticated role policies (JWT bridge)
-- ══════════════════════════════════════════════════════════════════════════════

create policy "tanks_select_own_jwt"
  on public.aquadex_tanks for select
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "tanks_insert_own_jwt"
  on public.aquadex_tanks for insert
  to authenticated
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "tanks_update_own_jwt"
  on public.aquadex_tanks for update
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  )
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "tanks_delete_own_jwt"
  on public.aquadex_tanks for delete
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- SPECIMENS — Authenticated role policies (JWT bridge)
-- ══════════════════════════════════════════════════════════════════════════════

create policy "specimens_select_own_jwt"
  on public.aquadex_specimens for select
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "specimens_insert_own_jwt"
  on public.aquadex_specimens for insert
  to authenticated
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "specimens_update_own_jwt"
  on public.aquadex_specimens for update
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  )
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "specimens_delete_own_jwt"
  on public.aquadex_specimens for delete
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- ACTION LOGS — Authenticated role policies (JWT bridge)
-- ══════════════════════════════════════════════════════════════════════════════

create policy "action_logs_select_own_jwt"
  on public.aquadex_action_logs for select
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "action_logs_insert_own_jwt"
  on public.aquadex_action_logs for insert
  to authenticated
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "action_logs_update_own_jwt"
  on public.aquadex_action_logs for update
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  )
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "action_logs_delete_own_jwt"
  on public.aquadex_action_logs for delete
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- LISTINGS — Authenticated role policies (JWT bridge)
-- Public read for browsing, write scoped to seller
-- ══════════════════════════════════════════════════════════════════════════════

create policy "listings_select_public_jwt"
  on public.aquadex_listings for select
  to authenticated
  using (true);

create policy "listings_insert_own_jwt"
  on public.aquadex_listings for insert
  to authenticated
  with check (
    seller_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "listings_update_own_jwt"
  on public.aquadex_listings for update
  to authenticated
  using (
    seller_address = lower(auth.jwt()->>'wallet_address')
  )
  with check (
    seller_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "listings_delete_own_jwt"
  on public.aquadex_listings for delete
  to authenticated
  using (
    seller_address = lower(auth.jwt()->>'wallet_address')
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- SOCIAL TABLES (profiles, currents, reactions, etc.)
-- These already have JWT-based policies from 001_reef_mvp_schema.sql that use:
--   current_setting('request.jwt.claims', true)::json->>'wallet_address'
--
-- However, Supabase also supports auth.jwt() which is the preferred method.
-- The existing policies will work with our minted JWT because Supabase
-- populates request.jwt.claims from the Authorization header JWT.
-- No changes needed for social tables.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- CLEANUP NOTE:
-- The dev bypass policies from 002_dev_rls_bypass.sql are still active.
-- Once the JWT bridge is confirmed working in production, drop them:
--
--   DROP POLICY "dev_profiles_insert" ON profiles;
--   DROP POLICY "dev_profiles_update" ON profiles;
--   DROP POLICY "dev_currents_insert" ON currents;
--   DROP POLICY "dev_currents_update" ON currents;
--   DROP POLICY "dev_currents_delete" ON currents;
--   DROP POLICY "dev_reactions_insert" ON reactions;
--   DROP POLICY "dev_reactions_delete" ON reactions;
--   DROP POLICY "dev_comments_insert" ON comments;
--   DROP POLICY "dev_comments_delete" ON comments;
--   DROP POLICY "dev_follows_insert" ON follows;
--   DROP POLICY "dev_follows_delete" ON follows;
--   DROP POLICY "dev_requests_insert" ON connection_requests;
--   DROP POLICY "dev_requests_update" ON connection_requests;
--   DROP POLICY "dev_notifications_insert" ON sonar_notifications;
--
-- And the anon header-based policies from 20260619_tighten_cloud_sync_rls.sql:
--   DROP POLICY "tanks_select_own" ON public.aquadex_tanks;
--   DROP POLICY "tanks_insert_own" ON public.aquadex_tanks;
--   DROP POLICY "tanks_update_own" ON public.aquadex_tanks;
--   DROP POLICY "tanks_delete_own" ON public.aquadex_tanks;
--   (repeat for specimens, action_logs, listings)
-- ══════════════════════════════════════════════════════════════════════════════
