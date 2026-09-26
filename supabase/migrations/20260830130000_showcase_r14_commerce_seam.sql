-- Fish Room R1.4 (P2) — the tank -> listing commerce seam.
--
-- Additive on top of the frozen R1.2/R1.3 showcase chain. It lets an owner link a published tank
-- (tub) to one of their own buyable aquadex_listings packs, and surfaces that link in the public
-- projection as a bounded commerce snapshot.
--
-- Authorization invariant (the Tier A heart of P2): a listing may only be linked/surfaced when its
-- seller_address is an ACTIVE (revoked_at IS NULL) verified wallet of the room's owner. This is
-- enforced at BOTH write time (showcase_set_room_tank_commerce) and read time
-- (showcase_resolve_tank_commerce), so a later wallet revocation or listing deactivation silently
-- drops the snapshot with no broken CTA and no leak.
--
-- This migration never edits an already-applied file: the two projection functions are refreshed
-- with CREATE OR REPLACE, which preserves their existing ownership and grants.

BEGIN;

-- ── 1. Tank commerce link columns (additive, coherent, closed) ──────────────
ALTER TABLE public.showcase_room_tanks
  ADD COLUMN commerce_listing_key text,
  ADD COLUMN commerce_visibility text;

ALTER TABLE public.showcase_room_tanks
  ADD CONSTRAINT showcase_room_tanks_commerce_key_format
    CHECK (commerce_listing_key IS NULL
      OR commerce_listing_key ~ '^(single|batch)-[1-9][0-9]*$'),
  ADD CONSTRAINT showcase_room_tanks_commerce_visibility_closed
    CHECK (commerce_visibility IS NULL OR commerce_visibility = 'public'),
  ADD CONSTRAINT showcase_room_tanks_commerce_coherent
    CHECK ((commerce_listing_key IS NULL AND commerce_visibility IS NULL)
        OR (commerce_listing_key IS NOT NULL AND commerce_visibility IS NOT NULL));

-- ── 2. Read-time resolver: listing key -> bounded public commerce snapshot ───
-- Returns NULL unless the listing is active AND its seller is an active verified wallet of
-- p_owner_id. Output is an explicit allowlist (never the raw listing row / data blob).
CREATE FUNCTION public.showcase_resolve_tank_commerce(p_owner_id uuid, p_listing_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_batch boolean;
  v_id text;
  listing_row record;
  data_obj jsonb;
  pack_size integer;
  price_cents bigint;
  fulfillment text;
BEGIN
  IF p_owner_id IS NULL OR p_listing_key IS NULL
     OR p_listing_key !~ '^(single|batch)-[1-9][0-9]*$' THEN
    RETURN NULL;
  END IF;
  v_is_batch := split_part(p_listing_key, '-', 1) = 'batch';
  v_id := split_part(p_listing_key, '-', 2);

  SELECT l.id, l.is_batch, l.seller_address, l.data
    INTO listing_row
  FROM public.aquadex_listings l
  WHERE l.id = v_id
    AND l.is_batch = v_is_batch
    AND l.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.showcase_owner_wallets w
      WHERE w.owner_id = p_owner_id
        AND w.revoked_at IS NULL
        AND w.normalized_wallet_address = lower(l.seller_address)
    );
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  data_obj := CASE jsonb_typeof(listing_row.data)
    WHEN 'string' THEN (listing_row.data #>> '{}')::jsonb
    WHEN 'object' THEN listing_row.data
    ELSE '{}'::jsonb
  END;

  IF v_is_batch THEN
    pack_size := CASE WHEN (data_obj->>'quantity') ~ '^[0-9]+$'
      THEN LEAST((data_obj->>'quantity')::bigint, 2147483647)::integer ELSE NULL END;
  ELSE
    pack_size := 1;
  END IF;

  price_cents := CASE WHEN (data_obj->>'priceCentsUSD') ~ '^[0-9]+$'
    THEN (data_obj->>'priceCentsUSD')::bigint ELSE NULL END;

  fulfillment := CASE
    WHEN (data_obj->>'isShipping') = 'true' THEN 'shipping'
    WHEN (data_obj->>'localPickup') = 'true' THEN 'pickup'
    ELSE 'ask'
  END;

  RETURN jsonb_build_object(
    'listingKey', p_listing_key,
    'isBatch', v_is_batch,
    'packSize', pack_size,
    'priceCents', price_cents,
    'price', data_obj->>'price',
    'fulfillment', fulfillment,
    'buyPath', '/app/products/' || p_listing_key
  );
END;
$$;

-- ── 3. Refresh showcase_public_room to emit the tank-level commerce snapshot ─
CREATE OR REPLACE FUNCTION public.showcase_public_room(
  normalized_room_slug text,
  normalized_tank_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_row public.showcase_rooms%ROWTYPE;
  tank_row record;
  specimen_row record;
  room_json jsonb;
  tank_json jsonb;
  specimen_json jsonb;
  species_json jsonb;
  facts_json jsonb;
  placement_json jsonb;
  commerce_json jsonb;
  tanks_json jsonb := '[]'::jsonb;
  specimens_json jsonb;
  result_json jsonb;
  tank_count integer := 0;
  specimen_count integer;
  total_specimen_count integer := 0;
BEGIN
  IF NOT public.showcase_slug_is_valid(normalized_room_slug) THEN
    RETURN NULL;
  END IF;
  IF normalized_tank_slug IS NOT NULL
     AND NOT public.showcase_slug_is_valid(normalized_tank_slug) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO room_row
  FROM public.showcase_rooms
  WHERE slug = normalized_room_slug
    AND visibility IN ('unlisted', 'public');
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM public.showcase_assert_owner_publication_bounds(room_row.owner_id);

  FOR tank_row IN
    SELECT
      rt.room_id, rt.tank_key, rt.owner_id, rt.slug, rt.visibility,
      rt.public_label, rt.caption, rt.show_volume, rt.show_tank_type,
      rt.show_published_inhabitant_count, rt.x, rt.y, rt.zone_id, rt.display_order,
      rt.commerce_listing_key, rt.commerce_visibility,
      t.volume_liters, t.tank_type
    FROM public.showcase_room_tanks rt
    JOIN public.showcase_tanks t
      ON t.tank_key = rt.tank_key AND t.owner_id = rt.owner_id
    JOIN public.showcase_entities te
      ON te.public_key = rt.tank_key AND te.owner_id = rt.owner_id AND te.entity_kind = 'tank'
    WHERE rt.room_id = room_row.id
      AND rt.owner_id = room_row.owner_id
      AND t.is_active = true
      AND te.identity_state = 'verified'
      AND NOT public.showcase_entity_has_open_conflict(rt.tank_key)
      AND (
        (normalized_tank_slug IS NULL AND rt.visibility = 'public')
        OR (normalized_tank_slug IS NOT NULL
          AND rt.slug = normalized_tank_slug
          AND rt.visibility IN ('unlisted', 'public'))
      )
    ORDER BY rt.display_order, rt.tank_key
  LOOP
    tank_count := tank_count + 1;
    IF tank_count > 100 THEN
      RAISE EXCEPTION 'SHOWCASE_ROOM_TANK_LIMIT' USING ERRCODE = '54000';
    END IF;

    specimens_json := '[]'::jsonb;
    specimen_count := 0;

    FOR specimen_row IN
      SELECT
        ss.specimen_key, ss.public_name, ss.story,
        ss.show_species, ss.show_sex, ss.show_life_stage,
        s.common_name, s.scientific_name, s.sex, s.life_stage
      FROM public.showcase_specimen_settings ss
      JOIN public.showcase_specimens s
        ON s.specimen_key = ss.specimen_key AND s.owner_id = ss.owner_id
      JOIN public.showcase_entities se
        ON se.public_key = ss.specimen_key
        AND se.owner_id = ss.owner_id
        AND se.entity_kind = 'specimen'
      WHERE ss.owner_id = room_row.owner_id
        AND ss.visibility = 'public'
        AND s.current_tank_key = tank_row.tank_key
        AND se.identity_state = 'verified'
        AND NOT public.showcase_entity_has_open_conflict(ss.specimen_key)
      ORDER BY ss.public_name NULLS LAST, ss.specimen_key
    LOOP
      specimen_count := specimen_count + 1;
      total_specimen_count := total_specimen_count + 1;
      IF specimen_count > 25 THEN
        RAISE EXCEPTION 'SHOWCASE_TANK_SPECIMEN_LIMIT' USING ERRCODE = '54000';
      END IF;
      IF total_specimen_count > 100 THEN
        RAISE EXCEPTION 'SHOWCASE_ROOM_SPECIMEN_LIMIT' USING ERRCODE = '54000';
      END IF;

      specimen_json := jsonb_build_object(
        'specimenKey', 'spec_' || specimen_row.specimen_key::text,
        'media', NULL,
        'commerce', NULL
      );

      IF specimen_row.public_name IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('publicName', specimen_row.public_name);
      END IF;
      IF specimen_row.story IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('story', specimen_row.story);
      END IF;
      IF specimen_row.show_species
         AND (specimen_row.common_name IS NOT NULL OR specimen_row.scientific_name IS NOT NULL) THEN
        species_json := '{}'::jsonb;
        IF specimen_row.common_name IS NOT NULL THEN
          species_json := species_json || jsonb_build_object('commonName', specimen_row.common_name);
        END IF;
        IF specimen_row.scientific_name IS NOT NULL THEN
          species_json := species_json || jsonb_build_object('scientificName', specimen_row.scientific_name);
        END IF;
        specimen_json := specimen_json || jsonb_build_object('species', species_json);
      END IF;
      IF specimen_row.show_sex AND specimen_row.sex IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('sex', specimen_row.sex);
      END IF;
      IF specimen_row.show_life_stage AND specimen_row.life_stage IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('lifeStage', specimen_row.life_stage);
      END IF;

      -- approximateSize/provenance/pedigree stay omitted until their ingest/source contracts are reviewed.
      specimens_json := specimens_json || jsonb_build_array(specimen_json);
    END LOOP;

    facts_json := '{}'::jsonb;
    IF tank_row.show_volume AND tank_row.volume_liters IS NOT NULL THEN
      facts_json := facts_json || jsonb_build_object('volumeLiters', tank_row.volume_liters);
    END IF;
    IF tank_row.show_tank_type AND tank_row.tank_type IS NOT NULL THEN
      facts_json := facts_json || jsonb_build_object('tankType', tank_row.tank_type);
    END IF;
    IF tank_row.show_published_inhabitant_count THEN
      facts_json := facts_json || jsonb_build_object('inhabitantCount', specimen_count);
    END IF;
    -- establishedAt and careFact stay omitted until reviewed canonical population/event sources exist.

    placement_json := jsonb_build_object(
      'x', tank_row.x,
      'y', tank_row.y,
      'order', tank_row.display_order
    );
    IF tank_row.zone_id IS NOT NULL THEN
      placement_json := placement_json || jsonb_build_object('zoneId', tank_row.zone_id);
    END IF;

    tank_json := jsonb_build_object(
      'tankKey', 'tank_' || tank_row.tank_key::text,
      'slug', tank_row.slug,
      'label', tank_row.public_label,
      'placement', placement_json,
      'facts', facts_json,
      'media', NULL,
      'specimens', specimens_json
    );
    IF tank_row.caption IS NOT NULL THEN
      tank_json := tank_json || jsonb_build_object('caption', tank_row.caption);
    END IF;

    -- Commerce seam (R1.4/P2): only when the tank carries a public commerce link AND the linked
    -- listing still resolves (active + seller is an active verified wallet of the room owner).
    IF tank_row.commerce_visibility = 'public' AND tank_row.commerce_listing_key IS NOT NULL THEN
      commerce_json := public.showcase_resolve_tank_commerce(room_row.owner_id, tank_row.commerce_listing_key);
      IF commerce_json IS NOT NULL THEN
        tank_json := tank_json || jsonb_build_object('commerce', commerce_json);
      END IF;
    END IF;

    tanks_json := tanks_json || jsonb_build_array(tank_json);
  END LOOP;

  IF normalized_tank_slug IS NOT NULL AND tank_count = 0 THEN
    RETURN NULL;
  END IF;

  room_json := jsonb_build_object(
    'slug', room_row.slug,
    'title', room_row.title,
    'visibility', room_row.visibility,
    'keeper', NULL,
    'schematic', jsonb_build_object(
      'version', room_row.schematic_version,
      'zones', room_row.schematic_data->'zones'
    ),
    'hero', NULL,
    'tanks', tanks_json
  );
  IF room_row.description IS NOT NULL THEN
    room_json := room_json || jsonb_build_object('description', room_row.description);
  END IF;

  result_json := jsonb_build_object('schemaVersion', 1, 'room', room_json);
  IF octet_length(result_json::text) > 1048576 THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;

  RETURN result_json;
END;
$$;

-- ── 4. Refresh showcase_render_room_projection (owner-preview mirror) ────────
CREATE OR REPLACE FUNCTION public.showcase_render_room_projection(p_room public.showcase_rooms)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  tank_row record; specimen_row record;
  tank_json jsonb; specimen_json jsonb; species_json jsonb; facts_json jsonb; placement_json jsonb;
  commerce_json jsonb;
  tanks_json jsonb := '[]'::jsonb; specimens_json jsonb; room_json jsonb; result_json jsonb;
  tank_count integer := 0; specimen_count integer; total_specimen_count integer := 0;
BEGIN
  FOR tank_row IN
    SELECT rt.tank_key, rt.slug, rt.public_label, rt.caption, rt.show_volume, rt.show_tank_type,
           rt.show_published_inhabitant_count, rt.x, rt.y, rt.zone_id, rt.display_order,
           rt.commerce_listing_key, rt.commerce_visibility,
           t.volume_liters, t.tank_type
    FROM public.showcase_room_tanks rt
    JOIN public.showcase_tanks t ON t.tank_key = rt.tank_key AND t.owner_id = rt.owner_id
    JOIN public.showcase_entities te
      ON te.public_key = rt.tank_key AND te.owner_id = rt.owner_id AND te.entity_kind = 'tank'
    WHERE rt.room_id = p_room.id AND rt.owner_id = p_room.owner_id
      AND t.is_active = true AND te.identity_state = 'verified'
      AND NOT public.showcase_entity_has_open_conflict(rt.tank_key)
      AND rt.visibility = 'public'
    ORDER BY rt.display_order, rt.tank_key
  LOOP
    tank_count := tank_count + 1;
    IF tank_count > 100 THEN RAISE EXCEPTION 'SHOWCASE_ROOM_TANK_LIMIT' USING ERRCODE = '54000'; END IF;
    specimens_json := '[]'::jsonb; specimen_count := 0;
    FOR specimen_row IN
      SELECT ss.specimen_key, ss.public_name, ss.story, ss.show_species, ss.show_sex, ss.show_life_stage,
             s.common_name, s.scientific_name, s.sex, s.life_stage
      FROM public.showcase_specimen_settings ss
      JOIN public.showcase_specimens s ON s.specimen_key = ss.specimen_key AND s.owner_id = ss.owner_id
      JOIN public.showcase_entities se
        ON se.public_key = ss.specimen_key AND se.owner_id = ss.owner_id AND se.entity_kind = 'specimen'
      WHERE ss.owner_id = p_room.owner_id AND ss.visibility = 'public'
        AND s.current_tank_key = tank_row.tank_key AND se.identity_state = 'verified'
        AND NOT public.showcase_entity_has_open_conflict(ss.specimen_key)
      ORDER BY ss.public_name NULLS LAST, ss.specimen_key
    LOOP
      specimen_count := specimen_count + 1; total_specimen_count := total_specimen_count + 1;
      IF specimen_count > 25 THEN RAISE EXCEPTION 'SHOWCASE_TANK_SPECIMEN_LIMIT' USING ERRCODE = '54000'; END IF;
      IF total_specimen_count > 100 THEN RAISE EXCEPTION 'SHOWCASE_ROOM_SPECIMEN_LIMIT' USING ERRCODE = '54000'; END IF;
      specimen_json := jsonb_build_object(
        'specimenKey', 'spec_' || specimen_row.specimen_key::text, 'media', NULL, 'commerce', NULL);
      IF specimen_row.public_name IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('publicName', specimen_row.public_name);
      END IF;
      IF specimen_row.story IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('story', specimen_row.story);
      END IF;
      IF specimen_row.show_species
         AND (specimen_row.common_name IS NOT NULL OR specimen_row.scientific_name IS NOT NULL) THEN
        species_json := '{}'::jsonb;
        IF specimen_row.common_name IS NOT NULL THEN
          species_json := species_json || jsonb_build_object('commonName', specimen_row.common_name);
        END IF;
        IF specimen_row.scientific_name IS NOT NULL THEN
          species_json := species_json || jsonb_build_object('scientificName', specimen_row.scientific_name);
        END IF;
        specimen_json := specimen_json || jsonb_build_object('species', species_json);
      END IF;
      IF specimen_row.show_sex AND specimen_row.sex IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('sex', specimen_row.sex);
      END IF;
      IF specimen_row.show_life_stage AND specimen_row.life_stage IS NOT NULL THEN
        specimen_json := specimen_json || jsonb_build_object('lifeStage', specimen_row.life_stage);
      END IF;
      specimens_json := specimens_json || jsonb_build_array(specimen_json);
    END LOOP;

    facts_json := '{}'::jsonb;
    IF tank_row.show_volume AND tank_row.volume_liters IS NOT NULL THEN
      facts_json := facts_json || jsonb_build_object('volumeLiters', tank_row.volume_liters);
    END IF;
    IF tank_row.show_tank_type AND tank_row.tank_type IS NOT NULL THEN
      facts_json := facts_json || jsonb_build_object('tankType', tank_row.tank_type);
    END IF;
    IF tank_row.show_published_inhabitant_count THEN
      facts_json := facts_json || jsonb_build_object('inhabitantCount', specimen_count);
    END IF;

    placement_json := jsonb_build_object('x', tank_row.x, 'y', tank_row.y, 'order', tank_row.display_order);
    IF tank_row.zone_id IS NOT NULL THEN
      placement_json := placement_json || jsonb_build_object('zoneId', tank_row.zone_id);
    END IF;

    tank_json := jsonb_build_object(
      'tankKey', 'tank_' || tank_row.tank_key::text, 'slug', tank_row.slug, 'label', tank_row.public_label,
      'placement', placement_json, 'facts', facts_json, 'media', NULL, 'specimens', specimens_json);
    IF tank_row.caption IS NOT NULL THEN
      tank_json := tank_json || jsonb_build_object('caption', tank_row.caption);
    END IF;

    IF tank_row.commerce_visibility = 'public' AND tank_row.commerce_listing_key IS NOT NULL THEN
      commerce_json := public.showcase_resolve_tank_commerce(p_room.owner_id, tank_row.commerce_listing_key);
      IF commerce_json IS NOT NULL THEN
        tank_json := tank_json || jsonb_build_object('commerce', commerce_json);
      END IF;
    END IF;

    tanks_json := tanks_json || jsonb_build_array(tank_json);
  END LOOP;

  room_json := jsonb_build_object(
    'slug', p_room.slug, 'title', p_room.title, 'visibility', p_room.visibility, 'keeper', NULL,
    'schematic', jsonb_build_object('version', p_room.schematic_version, 'zones', p_room.schematic_data->'zones'),
    'hero', NULL, 'tanks', tanks_json);
  IF p_room.description IS NOT NULL THEN
    room_json := room_json || jsonb_build_object('description', p_room.description);
  END IF;
  result_json := jsonb_build_object('schemaVersion', 1, 'room', room_json);
  IF octet_length(result_json::text) > 1048576 THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;
  RETURN result_json;
END;
$$;

-- ── 5. Owner write path: set or clear a tank's commerce link ─────────────────
-- Mirrors showcase_put_room_tank's model: owner lock, room must be private, CAS on the tank
-- revision, projection invalidation. Linking (non-NULL key) requires the seller-ownership check.
CREATE FUNCTION public.showcase_set_room_tank_commerce(
  p_owner_id uuid, p_room_id uuid, p_tank_key uuid, p_expected_revision bigint, p_listing_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_vis text;
  v_is_batch boolean;
  v_id text;
  seller_ok boolean;
  result_row public.showcase_room_tanks%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_tank_key IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_listing_key IS NOT NULL AND p_listing_key !~ '^(single|batch)-[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT visibility INTO room_vis FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR room_vis <> 'private' THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  IF p_listing_key IS NOT NULL THEN
    v_is_batch := split_part(p_listing_key, '-', 1) = 'batch';
    v_id := split_part(p_listing_key, '-', 2);
    SELECT EXISTS (
      SELECT 1 FROM public.aquadex_listings l
      WHERE l.id = v_id AND l.is_batch = v_is_batch AND l.is_active = true
        AND EXISTS (
          SELECT 1 FROM public.showcase_owner_wallets w
          WHERE w.owner_id = p_owner_id AND w.revoked_at IS NULL
            AND w.normalized_wallet_address = lower(l.seller_address)
        )
    ) INTO seller_ok;
    IF NOT seller_ok THEN
      -- Non-enumerating: same signal for "no such listing", "not active", "not your wallet".
      RAISE EXCEPTION 'SHOWCASE_COMMERCE_LISTING_UNAVAILABLE' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.showcase_room_tanks
    SET commerce_listing_key = p_listing_key,
        commerce_visibility = CASE WHEN p_listing_key IS NULL THEN NULL ELSE 'public' END,
        revision = revision + 1
    WHERE room_id = p_room_id AND tank_key = p_tank_key AND owner_id = p_owner_id
      AND revision = p_expected_revision
    RETURNING * INTO result_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
  VALUES (p_owner_id, p_tank_key, 'publication_change');

  RETURN jsonb_build_object(
    'tankId', 'tank_' || result_row.tank_key::text,
    'commerceListingKey', result_row.commerce_listing_key,
    'revision', result_row.revision);
END;
$$;

-- ── 6. Ownership + ACL (new functions only; CREATE OR REPLACE preserves the two projections') ─
ALTER FUNCTION public.showcase_resolve_tank_commerce(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.showcase_set_room_tank_commerce(uuid, uuid, uuid, bigint, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.showcase_resolve_tank_commerce(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_set_room_tank_commerce(uuid, uuid, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- The resolver is internal (called only by the SECURITY DEFINER projections, which run as postgres),
-- so it gets NO role grant. The setter is called by the authenticated owner endpoint via service_role.
GRANT EXECUTE ON FUNCTION public.showcase_set_room_tank_commerce(uuid, uuid, uuid, bigint, text) TO service_role;

COMMIT;
