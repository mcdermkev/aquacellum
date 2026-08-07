-- ─────────────────────────────────────────────────────────────────────────────
-- species_mastery — per-wallet per-species progression view
-- COSMETIC_EXPRESSION_SPEC.md §1
--
-- Derives mastery tiers from existing cloud-synced tables (aquadex_specimens,
-- aquadex_spawns, aquadex_spawn_growout) WITHOUT a new sync path or duplicated
-- data.
--
-- Mastery tiers:
--   kept   — species appears in the wallet's specimen history
--   bronze — first specimen is 30+ days old (sustained husbandry)
--   silver — 30+ days AND (spawned OR raised purchased fry 30+ days)
--   gold   — 30+ days AND spawned AND raised fry to 60+ days after spawn
--
-- All thresholds use the user's decision of 2026-08-06 (30 days for Bronze,
-- raised-purchased-fry counts as a separate Silver path).
--
-- This is a VIEW, not a materialized view — no refresh schedule needed, always
-- current. It reads from tables that are already indexed on owner_address.
-- If query cost becomes a concern at scale, it can be materialized with a
-- 5-minute refresh without changing the API.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.species_mastery AS
WITH

-- 1. Every species a wallet has ever owned, with the earliest specimen date.
--    `id` in aquadex_specimens is a timestamp-string from Dexie (epoch ms as text
--    for most rows, or a formatted date string). We use `updated_at` as the
--    server-side proxy for "when did we first know about this specimen", since it
--    is set to NOW() on first upsert and is always present.
kept AS (
  SELECT
    s.owner_address,
    LOWER(TRIM(s.data->>'scientificName')) AS species_key,
    COALESCE(s.data->>'commonName', '') AS common_name,
    MIN(s.updated_at) AS first_kept_at
  FROM public.aquadex_specimens s
  WHERE s.status IN (0, 1)  -- active or sold (they were kept)
    AND TRIM(COALESCE(s.data->>'scientificName', '')) != ''
    AND LOWER(TRIM(COALESCE(s.data->>'scientificName', ''))) NOT IN ('unknown', 'unknown species', 'n/a', 'none')
  GROUP BY s.owner_address, LOWER(TRIM(s.data->>'scientificName')), COALESCE(s.data->>'commonName', '')
),

-- 2. Has this wallet spawned this species?
spawned AS (
  SELECT DISTINCT
    sp.owner_address,
    LOWER(TRIM(sp.scientific_name)) AS species_key
  FROM public.aquadex_spawns sp
  WHERE TRIM(sp.scientific_name) != ''
),

-- 3. Has fry been raised 60+ days after a spawn? (Gold path)
--    A grow-out checkpoint 60+ days after the EARLIEST spawn for that species.
raised_fry AS (
  SELECT DISTINCT
    sp.owner_address,
    LOWER(TRIM(sp.scientific_name)) AS species_key
  FROM public.aquadex_spawns sp
  JOIN public.aquadex_spawn_growout g
    ON g.spawn_id = sp.spawn_id
   AND g.owner_address = sp.owner_address
  WHERE g.event_timestamp >= sp.event_timestamp + 5184000  -- 60 days in seconds
),

-- 4. Has fry been raised 30+ days (purchased-fry Silver path)?
--    A checkpoint exists at least 30 days after the earliest specimen of that
--    species was first recorded — regardless of whether the wallet spawned it.
--    This covers the case where someone BUYS juveniles and raises them.
raised_purchased AS (
  SELECT DISTINCT
    k.owner_address,
    k.species_key
  FROM kept k
  JOIN public.aquadex_spawns sp
    ON sp.owner_address = k.owner_address
   AND LOWER(TRIM(sp.scientific_name)) = k.species_key
  JOIN public.aquadex_spawn_growout g
    ON g.spawn_id = sp.spawn_id
   AND g.owner_address = k.owner_address
  WHERE g.event_timestamp >= EXTRACT(EPOCH FROM k.first_kept_at) + 2592000  -- 30 days
  UNION
  -- Also match any grow-out checkpoint on a spawn of this species that is 30+
  -- days after the spawn itself (even without a kept entry, since a batch
  -- purchase can land directly in a spawn tracker).
  SELECT DISTINCT
    sp.owner_address,
    LOWER(TRIM(sp.scientific_name)) AS species_key
  FROM public.aquadex_spawns sp
  JOIN public.aquadex_spawn_growout g
    ON g.spawn_id = sp.spawn_id
   AND g.owner_address = sp.owner_address
  WHERE g.event_timestamp >= sp.event_timestamp + 2592000  -- 30 days
)

SELECT
  k.owner_address   AS wallet_address,
  k.species_key,
  k.common_name,
  k.first_kept_at,
  EXTRACT(EPOCH FROM (NOW() - k.first_kept_at)) / 86400 AS days_kept,
  (sp.species_key IS NOT NULL)    AS has_spawned,
  (rf.species_key IS NOT NULL)    AS has_raised_fry,
  (rp.species_key IS NOT NULL)    AS has_raised_purchased,
  -- Derived tier
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - k.first_kept_at)) / 86400 >= 30
         AND sp.species_key IS NOT NULL
         AND rf.species_key IS NOT NULL
      THEN 'gold'
    WHEN EXTRACT(EPOCH FROM (NOW() - k.first_kept_at)) / 86400 >= 30
         AND (sp.species_key IS NOT NULL OR rp.species_key IS NOT NULL)
      THEN 'silver'
    WHEN EXTRACT(EPOCH FROM (NOW() - k.first_kept_at)) / 86400 >= 30
      THEN 'bronze'
    ELSE 'kept'
  END AS mastery_tier
FROM kept k
LEFT JOIN spawned sp
  ON sp.owner_address = k.owner_address AND sp.species_key = k.species_key
LEFT JOIN raised_fry rf
  ON rf.owner_address = k.owner_address AND rf.species_key = k.species_key
LEFT JOIN raised_purchased rp
  ON rp.owner_address = k.owner_address AND rp.species_key = k.species_key;

-- ─── RLS: read-only, scoped to the caller's own wallet OR public profiles ──
-- The view inherits RLS from its source tables. aquadex_specimens already has
-- "Public read" on the row level, so this view is readable for any wallet.
-- No INSERT/UPDATE/DELETE is possible on a view.

COMMENT ON VIEW public.species_mastery IS
  'Per-wallet per-species mastery progression. Read-only, derived from '
  'aquadex_specimens + aquadex_spawns + aquadex_spawn_growout. '
  'See docs/COSMETIC_EXPRESSION_SPEC.md §1.';
