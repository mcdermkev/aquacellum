-- ============================================================================
-- Published tanks — the public tank page behind a printed QR label
-- (BOOTH_BUILD_SPEC.md §5, decision D5)
--
-- WHY A NEW TABLE AND A SNAPSHOT
-- A vendor tapes a QR to a tank so a buyer can scan it and learn which fish they
-- are looking at, then buy one. Three findings forced this shape:
--
--   1. There is NO tank↔listing association in the system. The only join is
--      Dexie-local and transitive (tank → specimens.currentTankId → localListings
--      via id === tokenId), and it BREAKS for batch listings — which is exactly
--      why the curated showcase hardcodes /app/products/batch-8000001…7. The
--      server cannot walk that join, so publishing must MATERIALISE it.
--   2. `aquadex_tanks` is mirrored with anon-full-access RLS and holds the
--      keeper's entire tank blob. It must never be the public read path.
--   3. Real tank ids are `Date.now()` timestamps — sequential and enumerable. A
--      public URL keyed on them would let anyone walk other people's tanks, so
--      the public handle is an unguessable random token instead.
--
-- Publishing is therefore explicit and opt-in: nothing about a tank is public
-- until the owner publishes it, and what goes public is a reviewed projection
-- rather than the underlying record.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS published_tanks (
  -- The public handle. Random, not derived from the tank id, so it is not
  -- enumerable and reveals nothing about how many tanks anyone has.
  token           TEXT PRIMARY KEY CHECK (char_length(token) BETWEEN 16 AND 128),

  owner_wallet    TEXT NOT NULL,
  -- The owner's local tank identifier. Opaque to the server; only used so a
  -- re-publish updates the SAME token rather than minting a new one — otherwise
  -- every already-printed label would die on the next edit.
  tank_ref        TEXT NOT NULL,

  title           TEXT NOT NULL DEFAULT '',
  -- The reviewed public projection: label, caption, photo, facts, the fish in the
  -- tank, and the resolved sellable lines. Server-built, never client-trusted for
  -- price (see the publish handler).
  snapshot        JSONB NOT NULL DEFAULT '{}',

  is_public       BOOLEAN NOT NULL DEFAULT true,
  view_count      BIGINT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT published_tanks_owner_tank_key UNIQUE (owner_wallet, tank_ref),
  CONSTRAINT published_tanks_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
  -- Bound the payload so a runaway client cannot store megabytes per tank.
  CONSTRAINT published_tanks_snapshot_bounded CHECK (octet_length(snapshot::text) <= 65536)
);

CREATE INDEX IF NOT EXISTS idx_published_tanks_owner
  ON published_tanks(owner_wallet, updated_at DESC);

ALTER TABLE published_tanks ENABLE ROW LEVEL SECURITY;

-- Read and write ONLY through the server (service role). The public page is served
-- by an API handler that checks is_public and returns just the snapshot — clients
-- never select from this table directly, so a future RLS mistake cannot leak
-- unpublished tanks or owner wallets.
DROP POLICY IF EXISTS "service_role full access on published_tanks" ON published_tanks;
CREATE POLICY "service_role full access on published_tanks"
  ON published_tanks FOR ALL USING (auth.role() = 'service_role');

-- Reuse the existing touch trigger if this project has one; define a local
-- fallback so this migration does not depend on another file's function.
CREATE OR REPLACE FUNCTION touch_published_tanks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A scan increments view_count and nothing else. That is not an edit, so leave
  -- updated_at alone — otherwise `updated_at` would silently come to mean "last
  -- scanned", and the public page reports it to the buyer as when the tank was
  -- last updated.
  IF NEW.view_count <> OLD.view_count
     AND NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.is_public IS NOT DISTINCT FROM OLD.is_public THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_published_tanks ON published_tanks;
CREATE TRIGGER trg_touch_published_tanks
  BEFORE UPDATE ON published_tanks
  FOR EACH ROW EXECUTE FUNCTION touch_published_tanks_updated_at();

-- Popularity counter for the public page. Deliberately a function rather than a
-- direct UPDATE from the handler: it must not fire the updated_at touch trigger
-- (a scan is not an edit) and it must never fail a page load, so the handler calls
-- it fire-and-forget.
CREATE OR REPLACE FUNCTION increment_published_tank_views(p_token TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE published_tanks
  SET view_count = view_count + 1
  WHERE token = p_token AND is_public = true;
$$;

REVOKE ALL ON FUNCTION increment_published_tank_views(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_published_tank_views(TEXT) TO service_role;

COMMIT;
