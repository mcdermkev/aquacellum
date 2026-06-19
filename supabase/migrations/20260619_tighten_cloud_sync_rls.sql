-- ============================================================================
-- Tighten RLS on Cloud Sync Tables
-- 
-- BEFORE: anon full access (anyone can read/write all rows)
-- AFTER:  scoped by owner_address — users can only access their own data
--
-- Strategy:
--   Since the JWT auth bridge isn't deployed yet, we use a simpler approach:
--   the client must pass the wallet address via a custom request header
--   (x-wallet-address). RLS policies check that owner_address matches.
--
--   This isn't cryptographically secure (a user could spoof the header),
--   but it prevents accidental cross-user data access and raises the bar
--   significantly vs. fully open policies. When the Edge Function JWT
--   bridge is deployed, replace these with auth.jwt()->>... claims.
--
-- Run this in the Supabase SQL Editor after the cloud_sync_tables migration.
-- ============================================================================

-- ── Drop old permissive policies ─────────────────────────────────────────────

drop policy if exists "anon full access tanks" on public.aquadex_tanks;
drop policy if exists "anon full access specimens" on public.aquadex_specimens;
drop policy if exists "anon full access action_logs" on public.aquadex_action_logs;

-- ── TANKS: users can only read/write their own rows ──────────────────────────

create policy "tanks_select_own"
  on public.aquadex_tanks for select
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "tanks_insert_own"
  on public.aquadex_tanks for insert
  to anon
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "tanks_update_own"
  on public.aquadex_tanks for update
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  )
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "tanks_delete_own"
  on public.aquadex_tanks for delete
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

-- ── SPECIMENS: users can only read/write their own rows ──────────────────────

create policy "specimens_select_own"
  on public.aquadex_specimens for select
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "specimens_insert_own"
  on public.aquadex_specimens for insert
  to anon
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "specimens_update_own"
  on public.aquadex_specimens for update
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  )
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "specimens_delete_own"
  on public.aquadex_specimens for delete
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

-- ── ACTION LOGS: users can only read/write their own rows ────────────────────

create policy "action_logs_select_own"
  on public.aquadex_action_logs for select
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "action_logs_insert_own"
  on public.aquadex_action_logs for insert
  to anon
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "action_logs_update_own"
  on public.aquadex_action_logs for update
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  )
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "action_logs_delete_own"
  on public.aquadex_action_logs for delete
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

-- ── LISTINGS: public read, write scoped to seller ────────────────────────────
-- Marketplace listings should be readable by everyone (browsing).
-- Only the seller can insert/update/deactivate their own listings.

drop policy if exists "anon full access listings" on public.aquadex_listings;

create policy "listings_select_public"
  on public.aquadex_listings for select
  to anon
  using (true);

create policy "listings_insert_own"
  on public.aquadex_listings for insert
  to anon
  with check (
    seller_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "listings_update_own"
  on public.aquadex_listings for update
  to anon
  using (
    seller_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  )
  with check (
    seller_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "listings_delete_own"
  on public.aquadex_listings for delete
  to anon
  using (
    seller_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );
