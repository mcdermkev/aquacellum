-- ============================================================================
-- aquadex_listings — purge legacy fabricated location fields from stored rows
-- Fish Finder Rework, D3 follow-up (found while verifying T14) — STAGED
-- ============================================================================
-- ⚠️  DO NOT APPLY WITHOUT READING. This one MUTATES DATA (an UPDATE over the
--     listings table), unlike the other files here, and there is no way to
--     recover the stripped values except from a database backup. That is why it
--     lives in supabase/checks/ rather than migrations/.
--
--     Losing them is the intent — they are fabricated — but take a backup or a
--     Supabase PITR checkpoint first anyway.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Decision D3 ("no fabricated data") removed every code path that wrote
-- `fuzzedLocation` and `zoneHash` onto a listing — commit 4efa3b2, titled
-- "Purge fabricated marketplace/discovery location data". It purged the CODE.
-- The stored rows kept the fields, so they remained readable for anyone with
-- the public anon key right up until the T14 view shipped.
--
-- Verified against production while checking the T14 view (read-only, anon key):
--   * every sampled active row carried `fuzzedLocation` AND `zoneHash`
--   * every `fuzzedLocation` sat 0.0 miles from downtown SF (37.7749,-122.4194)
--     — the hardcoded default. So these are FABRICATED values, not real keeper
--     coordinates. No real user location was exposed.
--   * no current code reads or writes either field
--
-- The T14 view already stops anon from seeing them (they are not on the
-- allowlist — fail-closed working as designed). This finishes the job for the
-- paths the view does not cover: authenticated in-app reads
-- (`listings_select_public_jwt` returns the full blob) and every service_role
-- reader. It also means D3's claim finally matches reality.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--   * Touches ONLY these two keys; every other field is preserved.
--   * No-op for rows that don't have them (the WHERE clause filters).
--   * Handles the string-scalar case: the writer does JSON.stringify, so a
--     row's jsonb can hold a JSON string rather than an object, and `-` raises
--     "cannot delete from scalar" against those. They are normalized to objects
--     first, which is also what every JS reader already assumes.
--   * `updated_at` is deliberately NOT bumped: this is a data-hygiene cleanup,
--     not a seller edit, and bumping it would reorder the public marketplace
--     (several surfaces sort by updated_at/created_at).
--
-- Subtractive (`data - 'key'`) is correct HERE, unlike the T14 view: this is a
-- one-time removal of two known keys, not an ongoing publication boundary.
--
-- ── BEFORE / AFTER (run these around the update) ────────────────────────────
--   select count(*) filter (where data ? 'fuzzedLocation') as with_location,
--          count(*) filter (where data ? 'zoneHash')       as with_zone,
--          count(*)                                        as total
--   from   public.aquadex_listings
--   where  jsonb_typeof(data) = 'object';
--   -- after: with_location = 0 and with_zone = 0
-- ============================================================================

begin;

-- 1. Normalize any row whose jsonb holds a JSON string scalar into a real
--    object, so step 2's key deletion can apply to it.
update public.aquadex_listings
set    data = (data #>> '{}')::jsonb
where  jsonb_typeof(data) = 'string';

-- 2. Strip the two fabricated fields. Only rows that actually carry one are
--    touched, so this is idempotent and safe to re-run.
update public.aquadex_listings
set    data = data - 'fuzzedLocation' - 'zoneHash'
where  jsonb_typeof(data) = 'object'
  and  (data ? 'fuzzedLocation' or data ? 'zoneHash');

commit;

-- Verification (expect 0, 0):
--   select count(*) filter (where data ? 'fuzzedLocation') as with_location,
--          count(*) filter (where data ? 'zoneHash')       as with_zone
--   from   public.aquadex_listings;
