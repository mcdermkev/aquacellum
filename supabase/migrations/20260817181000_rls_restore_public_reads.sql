-- ═══════════════════════════════════════════════════════════════════════════
-- RLS phase 1b: restore the public reads that phase 1 removed by mistake
--
-- 20260817180000 dropped every policy whose USING and WITH CHECK were both
-- unconditional. That correctly removed the 43 dev_* bypasses and the
-- unconditionally-true policies guarding private direct messages.
--
-- It also removed policies that were unconditional ON PURPOSE. "Anyone can read
-- profiles" is not a bug: this is a social product with public profile pages, a
-- public marketplace and a public school directory. Read access there is meant to
-- be open, and the sweep could not tell intent from accident because both look
-- identical in pg_policies.
--
-- Caught immediately by frontend/scripts/verify-rls.mjs, which could no longer
-- read `profiles` with the anon key — the same probe that found the original
-- exposure. That is the argument for verifying a security change by observing
-- behaviour rather than reading the diff.
--
-- What this restores is READ ONLY, and only where public reading is the actual
-- product. Every write path keeps the strict ownership check from phase 1. The
-- distinction that matters and was previously absent:
--
--   before:  anyone could READ and WRITE these tables
--   after:   anyone can READ the public ones; only the owner can WRITE
--
-- Deliberately NOT restored: canonical_* order internals, pickup_locations and
-- pickup_arrangements (reveal-gated through an order-scoped endpoint),
-- seller_stripe_accounts, push_subscriptions, api_keys and the log tables. Those
-- had no business being world-readable and are reached by the service role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Public identity + social graph ─────────────────────────────────────────
-- Profile pages, ProfileCard lookups across the Reef, follower lists and
-- reaction counts all render for signed-out visitors.
DROP POLICY IF EXISTS "Public profiles are readable" ON profiles;
CREATE POLICY "Public profiles are readable" ON profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Follows are public" ON follows;
CREATE POLICY "Follows are public" ON follows FOR SELECT USING (true);

DROP POLICY IF EXISTS "Reactions are public" ON reactions;
CREATE POLICY "Reactions are public" ON reactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Comments are public" ON comments;
CREATE POLICY "Comments are public" ON comments FOR SELECT USING (true);

-- ── School directory ──────────────────────────────────────────────────────
-- Schools are browsable before joining; that is how anyone finds one.
DROP POLICY IF EXISTS "Schools are browsable" ON schools;
CREATE POLICY "Schools are browsable" ON schools FOR SELECT USING (true);

DROP POLICY IF EXISTS "School rosters are readable" ON school_members;
CREATE POLICY "School rosters are readable" ON school_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "School challenges are readable" ON school_challenges;
CREATE POLICY "School challenges are readable" ON school_challenges FOR SELECT USING (true);

-- ── Marketplace + storefronts ─────────────────────────────────────────────
-- The marketplace is a public shopfront, including for guests mid-checkout.
DROP POLICY IF EXISTS "Listings are publicly browsable" ON aquadex_listings;
CREATE POLICY "Listings are publicly browsable" ON aquadex_listings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Breeder profiles are public" ON breeder_profiles;
CREATE POLICY "Breeder profiles are public" ON breeder_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Breeder stats are public" ON breeder_stats;
CREATE POLICY "Breeder stats are public" ON breeder_stats FOR SELECT USING (true);

DROP POLICY IF EXISTS "Store sections are public" ON store_sections;
CREATE POLICY "Store sections are public" ON store_sections FOR SELECT USING (true);

DROP POLICY IF EXISTS "Seller promotions are public" ON seller_promotions;
CREATE POLICY "Seller promotions are public" ON seller_promotions FOR SELECT USING (true);

-- Ship-from is a seller's origin region, shown on listings for shipping
-- estimates. Public by design; it is a region, not a street address.
DROP POLICY IF EXISTS "Seller ship-from is public" ON seller_ship_from;
CREATE POLICY "Seller ship-from is public" ON seller_ship_from FOR SELECT USING (true);

-- ── Reference data ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Species map is public" ON species_id_map;
CREATE POLICY "Species map is public" ON species_id_map FOR SELECT USING (true);

DROP POLICY IF EXISTS "Zones are public" ON zones;
CREATE POLICY "Zones are public" ON zones FOR SELECT USING (true);

-- Community suggestions and their vote tallies are shown in the approval queue.
DROP POLICY IF EXISTS "Species suggestions are readable" ON species_suggestions;
CREATE POLICY "Species suggestions are readable" ON species_suggestions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Suggestion votes are readable" ON species_suggestion_votes;
CREATE POLICY "Suggestion votes are readable" ON species_suggestion_votes FOR SELECT USING (true);

-- ── Signed-in, but not owner-scoped ───────────────────────────────────────
-- Pedigree audits are part of a certificate's public credibility.
DROP POLICY IF EXISTS "Audits are readable" ON expert_audits;
CREATE POLICY "Audits are readable" ON expert_audits FOR SELECT USING (true);

-- Live stream metadata for a tide, readable by anyone who can see the tide.
DROP POLICY IF EXISTS "Tide streams are readable" ON tide_streams;
CREATE POLICY "Tide streams are readable" ON tide_streams FOR SELECT USING (true);

-- ── Owner-scoped reads that lost their policy ────────────────────────────
DROP POLICY IF EXISTS "Own XP profile" ON user_xp_profiles;
CREATE POLICY "Own XP profile" ON user_xp_profiles
  FOR SELECT USING (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Own roles" ON user_roles;
CREATE POLICY "Own roles" ON user_roles
  FOR SELECT USING (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Own watchlist" ON order_watchlist;
CREATE POLICY "Own watchlist" ON order_watchlist
  FOR SELECT USING (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Own push subscriptions" ON push_subscriptions;
CREATE POLICY "Own push subscriptions" ON push_subscriptions
  FOR SELECT USING (lower(wallet_address) = current_wallet());

-- A seller's own Stripe Connect record. Never public — it links a wallet to a
-- payment account.
DROP POLICY IF EXISTS "Own stripe account" ON seller_stripe_accounts;
CREATE POLICY "Own stripe account" ON seller_stripe_accounts
  FOR SELECT USING (lower(wallet_address) = current_wallet());

-- Bids are visible to anyone who can see the auction, which is how a live
-- auction works — you must be able to see what you are bidding against.
DROP POLICY IF EXISTS "Auction bids are readable" ON auction_bids;
CREATE POLICY "Auction bids are readable" ON auction_bids FOR SELECT USING (true);
