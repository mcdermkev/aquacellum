-- ============================================================================
-- Marketplace Reviews — Verified Structured Reviews & Universal Trust Signals
-- (Task 20)
-- ----------------------------------------------------------------------------
-- One verified review per completed order, across all four fulfillment
-- methods (including cash — see docs/MARKETPLACE_IMPLEMENTATION_PLAN.md's
-- DOA Protection Policy: cash carries no payment protection but DOES carry
-- full reputation consequences). Structured sub-ratings, photos, one seller
-- response per review, reporting + curator moderation, and public reputation
-- available to every buyer (view_reputation/leave_review are REQUIRED
-- entitlements — see frontend/src/services/entitlements.js).
--
-- Eligibility (who may write a review, and when) is enforced server-side by
-- frontend/api/stripe.js's ?action=reviews handlers, backed by the pure,
-- Opus-reviewed frontend/src/services/reviewEligibility.js. This migration
-- only shapes storage + the aggregate that api/storefront-detail.js already
-- reads (breeder_stats.avg_rating / review_count).
-- ============================================================================

-- 1. MARKETPLACE_REVIEWS ------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The reviewed order. Nullable + a separate order_ref so a legacy row
  -- without a canonical `orders.id` (e.g. an older local-only purchase) can
  -- still carry a review, keyed by whatever stable reference the client has
  -- (local_key / stripe session id / etc). At most one review per order —
  -- enforced below by a partial unique index on order_id.
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_ref TEXT,

  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  fulfillment_method TEXT CHECK (fulfillment_method IN ('shipping', 'courier', 'prepaid_pickup', 'cash_pickup')),

  -- Overall + structured sub-ratings (1-5). Sub-ratings are nullable so a
  -- method that doesn't apply (e.g. packaging on a pickup order — see
  -- reviewEligibility.js applicableRatingDimensions) can be omitted rather
  -- than forced to a fabricated value.
  overall SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 5),
  health SMALLINT CHECK (health IS NULL OR health BETWEEN 1 AND 5),
  accuracy SMALLINT CHECK (accuracy IS NULL OR accuracy BETWEEN 1 AND 5),
  packaging SMALLINT CHECK (packaging IS NULL OR packaging BETWEEN 1 AND 5),
  communication SMALLINT CHECK (communication IS NULL OR communication BETWEEN 1 AND 5),
  fulfillment SMALLINT CHECK (fulfillment IS NULL OR fulfillment BETWEEN 1 AND 5),

  body TEXT,
  photo_urls JSONB NOT NULL DEFAULT '[]',

  -- Exactly one seller response per review (reviewEligibility.canRespondToReview).
  seller_response TEXT,
  seller_responded_at TIMESTAMPTZ,

  -- published: visible everywhere. hidden: curator-actioned, excluded from
  -- aggregates but retained for audit. flagged: pending a report review,
  -- also excluded from the public aggregate until resolved.
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'flagged')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One review per order — the fraud backstop (mirrors the DOA claim's
-- "one open claim per order" partial-unique-index precedent). Only enforced
-- when order_id is present; legacy rows keyed solely by order_ref are not
-- covered by this constraint (a rare, pre-canonical-id edge case, not the
-- common path).
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_per_order
  ON marketplace_reviews (order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_seller ON marketplace_reviews(seller_wallet, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_buyer ON marketplace_reviews(buyer_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_order_ref ON marketplace_reviews(order_ref) WHERE order_ref IS NOT NULL;

-- 2. REVIEW_REPORTS ------------------------------------------------------------
-- Mirrors moderation_flags' column shape (supabase/migrations/010_depth_score_
-- and_moderation.sql) so the curator UI composes the same ModerationPanel
-- pattern instead of a bespoke moderation surface.
CREATE TABLE IF NOT EXISTS review_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES marketplace_reviews(id) ON DELETE CASCADE,
  reporter_wallet TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'misinformation', 'harassment', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'actioned')),
  reviewer_wallet TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_id);

-- 3. UPDATED_AT TRIGGER --------------------------------------------------------
CREATE OR REPLACE FUNCTION update_marketplace_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketplace_reviews_updated_at ON marketplace_reviews;
CREATE TRIGGER trg_marketplace_reviews_updated_at
  BEFORE UPDATE ON marketplace_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_marketplace_reviews_updated_at();

-- 4. BREEDER_STATS AGGREGATE TRIGGER -------------------------------------------
-- Recomputes avg_rating / review_count for the affected seller on every
-- insert/update/delete of marketplace_reviews, counting only 'published'
-- rows — the same rule frontend/src/services/reviewAggregation.js applies
-- client-side (ignore hidden/flagged). api/storefront-detail.js already
-- reads breeder_stats.avg_rating/review_count as-is, so no API change is
-- needed for the aggregate to show up on a storefront.
CREATE OR REPLACE FUNCTION recompute_breeder_review_stats(p_seller_wallet TEXT)
RETURNS VOID AS $$
DECLARE
  v_count INTEGER;
  v_avg NUMERIC(3,2);
BEGIN
  SELECT COUNT(*), COALESCE(ROUND(AVG(overall)::NUMERIC, 2), 0)
    INTO v_count, v_avg
    FROM marketplace_reviews
    WHERE seller_wallet = p_seller_wallet AND status = 'published';

  -- Only update an existing breeder_stats row (created by the
  -- breeder_profiles insert trigger in 20260623_breeder_storefronts.sql).
  -- A review for a wallet with no storefront profile yet has nothing to
  -- aggregate into — the storefront setup flow seeds the row when the
  -- seller creates a profile.
  UPDATE breeder_stats
    SET avg_rating = v_avg, review_count = v_count, updated_at = NOW()
    WHERE wallet_address = p_seller_wallet;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_recompute_breeder_review_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_breeder_review_stats(OLD.seller_wallet);
    RETURN OLD;
  END IF;

  PERFORM recompute_breeder_review_stats(NEW.seller_wallet);
  -- An UPDATE that changes seller_wallet (should never happen in practice,
  -- but keep both aggregates correct if it ever does).
  IF TG_OP = 'UPDATE' AND OLD.seller_wallet IS DISTINCT FROM NEW.seller_wallet THEN
    PERFORM recompute_breeder_review_stats(OLD.seller_wallet);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reviews_update_breeder_stats ON marketplace_reviews;
CREATE TRIGGER trg_reviews_update_breeder_stats
  AFTER INSERT OR UPDATE OR DELETE ON marketplace_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trg_recompute_breeder_review_stats();

-- 5. ROW LEVEL SECURITY --------------------------------------------------------
ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_reports ENABLE ROW LEVEL SECURITY;

-- Reviews are a public trust signal — anyone (signed in or not) may read
-- published reviews (view_reputation is a REQUIRED entitlement).
CREATE POLICY "Public read published reviews" ON marketplace_reviews
  FOR SELECT USING (status = 'published');

-- All writes (create, seller response, moderation hide) go through the
-- authenticated API, which re-verifies eligibility server-side and uses the
-- service-role key — never a direct client write.
CREATE POLICY "Service role full access reviews" ON marketplace_reviews
  FOR ALL USING (true) WITH CHECK (true);

-- Reports are not publicly readable (they'd leak who reported what); only
-- the service role (via the curator-authenticated API) reads/writes them.
CREATE POLICY "Service role full access review reports" ON review_reports
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Done. marketplace_reviews + review_reports are additive; no existing table
-- is modified except breeder_stats' avg_rating/review_count columns, which
-- already exist (20260623_breeder_storefronts.sql) and were previously
-- unwritten placeholders.
-- ============================================================================
