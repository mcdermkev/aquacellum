-- Fish Room R1.3A Tier A owner Room + publication API.
-- Additive only. Inherits the R1.2 publication foundation (20260829120000) and RLS/projection
-- boundary (20260829130000). Every RPC is SECURITY DEFINER, owned by postgres, pins
-- search_path, fully qualifies relations, returns bounded JSON, and is execute-revoked here;
-- the exact service_role allowlist is granted convergently in 20260829143000.
--
-- Publication lock order (freeze section 6.2): acquire the publication owner advisory lock first,
-- then the Room row, then placements/settings/attachments, then invalidations. Every post-create
-- mutation is CAS-guarded on a nonnegative expected revision and treats zero affected rows as a
-- single non-enumerating conflict that never distinguishes another owner's row from a missing row.

BEGIN;

-- 4.4 Owner reset authorization: additively replace the specimen-setting delete guard so deletion
-- is permitted under EITHER the existing transfer context OR an owner-reset context whose Room/owner
-- match the deleted row's owner. The missing half of the archive_reason<->transfer_evidence_id
-- biconditional is added as an additive CHECK below (the inherited constraint only bound the
-- transfer direction).
CREATE OR REPLACE FUNCTION public.showcase_guard_specimen_setting_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_ctx text := NULLIF(current_setting('showcase.transfer_evidence_id', true), '');
  reset_room_ctx text := NULLIF(current_setting('showcase.owner_reset_room_id', true), '');
  reset_owner_ctx text := NULLIF(current_setting('showcase.owner_reset_owner_id', true), '');
BEGIN
  IF transfer_ctx IS NOT NULL THEN
    RETURN OLD;
  END IF;
  IF reset_room_ctx IS NOT NULL AND reset_owner_ctx IS NOT NULL
     AND reset_owner_ctx = OLD.owner_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SHOWCASE_SETTING_DELETE_REQUIRES_CONTEXT' USING ERRCODE = '55000';
END;
$$;

-- Freeze section 4.4 biconditional: archive_reason <=> transfer_evidence_id presence in BOTH
-- directions. The inherited showcase_specimen_setting_history_transfer_required check only enforced
-- transfer -> NOT NULL and left owner_reset rows free to carry a non-null transfer evidence id.
ALTER TABLE public.showcase_specimen_setting_history
  ADD CONSTRAINT showcase_specimen_setting_history_reason_evidence_biconditional
  CHECK (
    (archive_reason = 'transfer' AND transfer_evidence_id IS NOT NULL)
    OR (archive_reason = 'owner_reset' AND transfer_evidence_id IS NULL)
  );

-- Bounded owner-facing Room DTO builder shared by create/update/reset/visibility responses.
CREATE FUNCTION public.showcase_owner_room_dto(p_room public.showcase_rooms)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'roomId', p_room.id,
    'slug', p_room.slug,
    'title', p_room.title,
    'description', p_room.description,
    'visibility', p_room.visibility,
    'schematic', jsonb_build_object('version', p_room.schematic_version, 'zones', p_room.schematic_data->'zones'),
    'revision', p_room.revision,
    'publishedAt', p_room.published_at,
    'firstPublishedAt', p_room.first_published_at
  );
$$;

-- Internal projection used by preview: mirrors showcase_public_room's child predicates/allowlist
-- but treats the Room ancestor as visible regardless of its stored visibility. Never mutates.
CREATE FUNCTION public.showcase_render_room_projection(p_room public.showcase_rooms)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  tank_row record; specimen_row record;
  tank_json jsonb; specimen_json jsonb; species_json jsonb; facts_json jsonb; placement_json jsonb;
  tanks_json jsonb := '[]'::jsonb; specimens_json jsonb; room_json jsonb; result_json jsonb;
  tank_count integer := 0; specimen_count integer; total_specimen_count integer := 0;
BEGIN
  FOR tank_row IN
    SELECT rt.tank_key, rt.slug, rt.public_label, rt.caption, rt.show_volume, rt.show_tank_type,
           rt.show_published_inhabitant_count, rt.x, rt.y, rt.zone_id, rt.display_order,
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

CREATE FUNCTION public.showcase_create_owner_room(
  p_owner_id uuid, p_slug text, p_title text, p_description text, p_schematic_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE new_room public.showcase_rooms%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.showcase_owner_principals WHERE id = p_owner_id)
     OR NOT public.showcase_slug_is_valid(p_slug)
     OR p_title IS NULL OR p_title <> btrim(p_title) OR char_length(p_title) NOT BETWEEN 1 AND 80
     OR (p_description IS NOT NULL AND char_length(p_description) > 1000)
     OR p_schematic_data IS NULL OR NOT public.showcase_schematic_is_valid(p_schematic_data) THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  BEGIN
    INSERT INTO public.showcase_rooms (owner_id, slug, title, description, schematic_data)
    VALUES (p_owner_id, p_slug, p_title, p_description, p_schematic_data)
    RETURNING * INTO new_room;
  EXCEPTION WHEN unique_violation THEN
    -- One lifetime Room per owner; a taken slug is also non-enumerating.
    RAISE EXCEPTION 'SHOWCASE_ROOM_UNAVAILABLE' USING ERRCODE = '23505';
  END;
  RETURN public.showcase_owner_room_dto(new_room) || jsonb_build_object('replay', false);
END;
$$;

CREATE FUNCTION public.showcase_update_owner_room(
  p_owner_id uuid, p_room_id uuid, p_expected_revision bigint,
  p_slug text, p_title text, p_description text, p_schematic_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE updated public.showcase_rooms%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR NOT public.showcase_slug_is_valid(p_slug)
     OR p_title IS NULL OR p_title <> btrim(p_title) OR char_length(p_title) NOT BETWEEN 1 AND 80
     OR (p_description IS NOT NULL AND char_length(p_description) > 1000)
     OR p_schematic_data IS NULL OR NOT public.showcase_schematic_is_valid(p_schematic_data) THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  -- Content edits require a private Room; visibility/keeper flags are untouched here.
  UPDATE public.showcase_rooms
    SET slug = p_slug, title = p_title, description = p_description,
        schematic_data = p_schematic_data, revision = revision + 1
    WHERE id = p_room_id AND owner_id = p_owner_id
      AND revision = p_expected_revision AND visibility = 'private'
    RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;
  RETURN public.showcase_owner_room_dto(updated);
END;
$$;

CREATE FUNCTION public.showcase_set_owner_room_visibility(
  p_owner_id uuid, p_room_id uuid, p_expected_revision bigint, p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE updated public.showcase_rooms%ROWTYPE; preview_json jsonb := NULL;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_visibility IS NULL OR p_visibility NOT IN ('private', 'unlisted', 'public') THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  -- Visibility-set is the only ordinary visibility transition (any -> any). Unpublish is deny-first
  -- because the row is flipped private before the invalidation/return; publish computes the exact
  -- post-change preview in-transaction and rolls back if it is invalid or over bounds.
  UPDATE public.showcase_rooms
    SET visibility = p_visibility, revision = revision + 1
    WHERE id = p_room_id AND owner_id = p_owner_id AND revision = p_expected_revision
    RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.showcase_projection_invalidations (owner_id, reason)
  VALUES (p_owner_id, 'publication_change');
  IF updated.visibility <> 'private' THEN
    preview_json := public.showcase_public_room(updated.slug, NULL);
    IF preview_json IS NULL THEN
      RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN public.showcase_owner_room_dto(updated) || jsonb_build_object('preview', preview_json);
END;
$$;

CREATE FUNCTION public.showcase_owner_publication_preview(p_owner_id uuid, p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE room_row public.showcase_rooms%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO room_row FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.showcase_render_room_projection(room_row);
END;
$$;

CREATE FUNCTION public.showcase_put_room_tank(
  p_owner_id uuid, p_room_id uuid, p_tank_key uuid, p_expected_revision bigint, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_vis text; facts jsonb; placement jsonb; v_visibility text; v_label text;
  result_row public.showcase_room_tanks%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_tank_key IS NULL
     OR (p_expected_revision IS NOT NULL AND p_expected_revision < 0)
     OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['slug','visibility','label','caption','facts','placement']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload)) <> 6 THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  facts := p_payload->'facts'; placement := p_payload->'placement';
  IF jsonb_typeof(p_payload->'slug') <> 'string' OR NOT public.showcase_slug_is_valid(p_payload->>'slug')
     OR jsonb_typeof(p_payload->'visibility') <> 'string'
     OR (p_payload->>'visibility') NOT IN ('private','unlisted','public')
     OR NOT (p_payload->'label' = 'null'::jsonb OR jsonb_typeof(p_payload->'label') = 'string')
     OR NOT (p_payload->'caption' = 'null'::jsonb OR jsonb_typeof(p_payload->'caption') = 'string')
     OR jsonb_typeof(facts) <> 'object'
     OR facts - ARRAY['volume','tankType','publishedInhabitantCount']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(facts)) <> 3
     OR jsonb_typeof(facts->'volume') <> 'boolean'
     OR jsonb_typeof(facts->'tankType') <> 'boolean'
     OR jsonb_typeof(facts->'publishedInhabitantCount') <> 'boolean'
     OR jsonb_typeof(placement) <> 'object'
     OR placement - ARRAY['x','y','width','height','focalX','focalY','zoneId','order']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(placement)) <> 8
     OR jsonb_typeof(placement->'x') <> 'number' OR jsonb_typeof(placement->'y') <> 'number'
     OR NOT (placement->'width' = 'null'::jsonb OR jsonb_typeof(placement->'width') = 'number')
     OR NOT (placement->'height' = 'null'::jsonb OR jsonb_typeof(placement->'height') = 'number')
     OR NOT (placement->'focalX' = 'null'::jsonb OR jsonb_typeof(placement->'focalX') = 'number')
     OR NOT (placement->'focalY' = 'null'::jsonb OR jsonb_typeof(placement->'focalY') = 'number')
     OR NOT (placement->'zoneId' = 'null'::jsonb OR jsonb_typeof(placement->'zoneId') = 'string')
     OR NOT public.showcase_ijson_safe_uint_ok(placement->'order')
     OR (placement->>'order')::numeric > 2147483647 THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  v_visibility := p_payload->>'visibility';
  v_label := CASE WHEN p_payload->'label' = 'null'::jsonb THEN NULL ELSE p_payload->>'label' END;
  IF v_visibility <> 'private' AND (v_label IS NULL OR btrim(v_label) = '') THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_LABEL_REQUIRED' USING ERRCODE = '23514';
  END IF;

  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT visibility INTO room_vis FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR room_vis <> 'private' THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  IF p_expected_revision IS NULL THEN
    BEGIN
      INSERT INTO public.showcase_room_tanks (
        room_id, tank_key, owner_id, slug, visibility, public_label, caption,
        show_volume, show_tank_type, show_published_inhabitant_count,
        x, y, width, height, focal_x, focal_y, zone_id, display_order
      ) VALUES (
        p_room_id, p_tank_key, p_owner_id, p_payload->>'slug', v_visibility, v_label,
        CASE WHEN p_payload->'caption' = 'null'::jsonb THEN NULL ELSE p_payload->>'caption' END,
        (facts->>'volume')::boolean, (facts->>'tankType')::boolean, (facts->>'publishedInhabitantCount')::boolean,
        (placement->>'x')::double precision, (placement->>'y')::double precision,
        (placement->>'width')::double precision, (placement->>'height')::double precision,
        (placement->>'focalX')::double precision, (placement->>'focalY')::double precision,
        CASE WHEN placement->'zoneId' = 'null'::jsonb THEN NULL ELSE placement->>'zoneId' END,
        (placement->>'order')::integer
      ) RETURNING * INTO result_row;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'SHOWCASE_PLACEMENT_UNAVAILABLE' USING ERRCODE = '23505';
      WHEN foreign_key_violation THEN
        -- Tank not owned by this principal (or absent): non-enumerating conflict, never a 500.
        RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
    END;
  ELSE
    UPDATE public.showcase_room_tanks
      SET slug = p_payload->>'slug', visibility = v_visibility, public_label = v_label,
          caption = CASE WHEN p_payload->'caption' = 'null'::jsonb THEN NULL ELSE p_payload->>'caption' END,
          show_volume = (facts->>'volume')::boolean, show_tank_type = (facts->>'tankType')::boolean,
          show_published_inhabitant_count = (facts->>'publishedInhabitantCount')::boolean,
          x = (placement->>'x')::double precision, y = (placement->>'y')::double precision,
          width = (placement->>'width')::double precision, height = (placement->>'height')::double precision,
          focal_x = (placement->>'focalX')::double precision, focal_y = (placement->>'focalY')::double precision,
          zone_id = CASE WHEN placement->'zoneId' = 'null'::jsonb THEN NULL ELSE placement->>'zoneId' END,
          display_order = (placement->>'order')::integer, revision = revision + 1
      WHERE room_id = p_room_id AND tank_key = p_tank_key AND owner_id = p_owner_id
        AND revision = p_expected_revision
      RETURNING * INTO result_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
  VALUES (p_owner_id, p_tank_key, 'publication_change');
  RETURN jsonb_build_object(
    'tankId', 'tank_' || result_row.tank_key::text, 'slug', result_row.slug,
    'visibility', result_row.visibility, 'revision', result_row.revision);
END;
$$;

CREATE FUNCTION public.showcase_remove_room_tank(
  p_owner_id uuid, p_room_id uuid, p_tank_key uuid, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE room_vis text; deleted_count integer;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_tank_key IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT visibility INTO room_vis FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR room_vis <> 'private' THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.showcase_room_tanks
  WHERE room_id = p_room_id AND tank_key = p_tank_key AND owner_id = p_owner_id
    AND revision = p_expected_revision;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
  VALUES (p_owner_id, p_tank_key, 'publication_change');
  RETURN jsonb_build_object('tankId', 'tank_' || p_tank_key::text, 'removed', true);
END;
$$;

CREATE FUNCTION public.showcase_put_specimen_settings(
  p_owner_id uuid, p_specimen_key uuid, p_expected_revision bigint, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_vis text; facts jsonb; v_visibility text; result_row public.showcase_specimen_settings%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL OR p_specimen_key IS NULL
     OR (p_expected_revision IS NOT NULL AND p_expected_revision < 0)
     OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload - ARRAY['visibility','publicName','story','facts']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload)) <> 4 THEN
    RAISE EXCEPTION 'SHOWCASE_SETTING_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  facts := p_payload->'facts';
  IF jsonb_typeof(p_payload->'visibility') <> 'string'
     OR (p_payload->>'visibility') NOT IN ('private','public')
     OR NOT (p_payload->'publicName' = 'null'::jsonb OR jsonb_typeof(p_payload->'publicName') = 'string')
     OR NOT (p_payload->'story' = 'null'::jsonb OR jsonb_typeof(p_payload->'story') = 'string')
     OR jsonb_typeof(facts) <> 'object'
     OR facts - ARRAY['species','sex','lifeStage']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(facts)) <> 3
     OR jsonb_typeof(facts->'species') <> 'boolean'
     OR jsonb_typeof(facts->'sex') <> 'boolean'
     OR jsonb_typeof(facts->'lifeStage') <> 'boolean' THEN
    RAISE EXCEPTION 'SHOWCASE_SETTING_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  v_visibility := p_payload->>'visibility';

  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  -- Settings put requires the owner's Room (if any) to be private.
  SELECT visibility INTO room_vis FROM public.showcase_rooms WHERE owner_id = p_owner_id FOR UPDATE;
  IF FOUND AND room_vis <> 'private' THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  IF p_expected_revision IS NULL THEN
    BEGIN
      INSERT INTO public.showcase_specimen_settings (
        owner_id, specimen_key, visibility, public_name, story, show_species, show_sex, show_life_stage
      ) VALUES (
        p_owner_id, p_specimen_key, v_visibility,
        CASE WHEN p_payload->'publicName' = 'null'::jsonb THEN NULL ELSE p_payload->>'publicName' END,
        CASE WHEN p_payload->'story' = 'null'::jsonb THEN NULL ELSE p_payload->>'story' END,
        (facts->>'species')::boolean, (facts->>'sex')::boolean, (facts->>'lifeStage')::boolean
      ) RETURNING * INTO result_row;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'SHOWCASE_SETTING_UNAVAILABLE' USING ERRCODE = '23505';
      WHEN foreign_key_violation THEN
        -- Specimen not owned by this principal (or absent): non-enumerating conflict, never a 500.
        RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
    END;
  ELSE
    UPDATE public.showcase_specimen_settings
      SET visibility = v_visibility,
          public_name = CASE WHEN p_payload->'publicName' = 'null'::jsonb THEN NULL ELSE p_payload->>'publicName' END,
          story = CASE WHEN p_payload->'story' = 'null'::jsonb THEN NULL ELSE p_payload->>'story' END,
          show_species = (facts->>'species')::boolean, show_sex = (facts->>'sex')::boolean,
          show_life_stage = (facts->>'lifeStage')::boolean, revision = revision + 1
      WHERE owner_id = p_owner_id AND specimen_key = p_specimen_key AND revision = p_expected_revision
      RETURNING * INTO result_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
  VALUES (p_owner_id, p_specimen_key, 'publication_change');
  RETURN jsonb_build_object(
    'specimenId', 'spec_' || result_row.specimen_key::text,
    'visibility', result_row.visibility, 'revision', result_row.revision);
END;
$$;

CREATE FUNCTION public.showcase_reset_owner_room(
  p_owner_id uuid, p_room_id uuid, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE room_row public.showcase_rooms%ROWTYPE; updated public.showcase_rooms%ROWTYPE; media_touched boolean := false;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  -- Validate CAS under lock before any destructive step; reset may target a currently visible Room.
  SELECT * INTO room_row FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR room_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  -- Set owner-reset context so the specimen-setting delete guard permits reset deletes.
  PERFORM set_config('showcase.owner_reset_room_id', p_room_id::text, true);
  PERFORM set_config('showcase.owner_reset_owner_id', p_owner_id::text, true);

  -- Remove every placement (published slugs are tombstoned by the inherited BEFORE DELETE trigger).
  DELETE FROM public.showcase_room_tanks WHERE room_id = p_room_id AND owner_id = p_owner_id;

  -- Archive then remove every specimen setting under owner-reset context.
  INSERT INTO public.showcase_specimen_setting_history (
    owner_id, specimen_key, visibility, public_name, story, show_species, show_sex, show_life_stage,
    show_approximate_size, show_provenance, show_pedigree, source_revision, archive_reason, transfer_evidence_id
  )
  SELECT owner_id, specimen_key, visibility, public_name, story, show_species, show_sex, show_life_stage,
         show_approximate_size, show_provenance, show_pedigree, revision, 'owner_reset', NULL
  FROM public.showcase_specimen_settings WHERE owner_id = p_owner_id;
  DELETE FROM public.showcase_specimen_settings WHERE owner_id = p_owner_id;

  -- Archive any active publishable media attachments on this owner's Room/tanks/specimens, if present.
  IF EXISTS (
    SELECT 1 FROM public.showcase_media_attachments
    WHERE owner_id = p_owner_id AND state IN ('private', 'published')
  ) THEN
    UPDATE public.showcase_media_attachments
      SET state = 'archived', revoked_at = now(), revision = revision + 1
      WHERE owner_id = p_owner_id AND state IN ('private', 'published');
    media_touched := true;
  END IF;

  -- One Room update: private, cleared description/zones, keeper flags false, revision +1.
  UPDATE public.showcase_rooms
    SET visibility = 'private', description = NULL, schematic_data = '{"zones":[]}'::jsonb,
        show_keeper_display_name = false, show_keeper_profile_path = false, show_keeper_avatar = false,
        revision = revision + 1
    WHERE id = p_room_id AND owner_id = p_owner_id AND revision = p_expected_revision
    RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.showcase_projection_invalidations (owner_id, reason) VALUES (p_owner_id, 'publication_change');
  IF media_touched THEN
    INSERT INTO public.showcase_projection_invalidations (owner_id, reason) VALUES (p_owner_id, 'media_change');
  END IF;
  RETURN public.showcase_owner_room_dto(updated) || jsonb_build_object('reset', true);
END;
$$;

CREATE FUNCTION public.showcase_owner_room(
  p_owner_id uuid,
  p_after_placement_key uuid DEFAULT NULL, p_placement_limit integer DEFAULT 25,
  p_after_setting_key uuid DEFAULT NULL, p_setting_limit integer DEFAULT 25,
  p_after_available_kind text DEFAULT NULL, p_after_available_key uuid DEFAULT NULL,
  p_available_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_row public.showcase_rooms%ROWTYPE; room_json jsonb;
  placements_json jsonb; placement_next uuid;
  settings_json jsonb; setting_next uuid;
  available_json jsonb; available_next jsonb; blockers jsonb; result jsonb;
BEGIN
  IF p_owner_id IS NULL OR p_placement_limit NOT BETWEEN 1 AND 100
     OR p_setting_limit NOT BETWEEN 1 AND 100 OR p_available_limit NOT BETWEEN 1 AND 100
     OR (p_after_available_kind IS NOT NULL AND p_after_available_kind NOT IN ('tank','specimen')) THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_PAGE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO room_row FROM public.showcase_rooms WHERE owner_id = p_owner_id;
  room_json := CASE WHEN room_row.id IS NULL THEN NULL ELSE public.showcase_owner_room_dto(room_row) END;

  WITH page AS (
    SELECT rt.*, row_number() OVER (ORDER BY rt.tank_key) AS rn
    FROM public.showcase_room_tanks rt
    WHERE rt.owner_id = p_owner_id
      AND (p_after_placement_key IS NULL OR rt.tank_key > p_after_placement_key)
    ORDER BY rt.tank_key LIMIT p_placement_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tankId', 'tank_' || tank_key::text, 'slug', slug, 'visibility', visibility,
      'label', public_label, 'caption', caption,
      'facts', jsonb_build_object('volume', show_volume, 'tankType', show_tank_type,
        'publishedInhabitantCount', show_published_inhabitant_count),
      'placement', jsonb_build_object('x', x, 'y', y, 'width', width, 'height', height,
        'focalX', focal_x, 'focalY', focal_y, 'zoneId', zone_id, 'order', display_order),
      'revision', revision
    ) ORDER BY tank_key) FILTER (WHERE rn <= p_placement_limit), '[]'::jsonb),
    (SELECT tank_key FROM page WHERE rn = p_placement_limit
       AND EXISTS (SELECT 1 FROM page WHERE rn = p_placement_limit + 1))
  INTO placements_json, placement_next FROM page;

  WITH page AS (
    SELECT ss.*, row_number() OVER (ORDER BY ss.specimen_key) AS rn
    FROM public.showcase_specimen_settings ss
    WHERE ss.owner_id = p_owner_id
      AND (p_after_setting_key IS NULL OR ss.specimen_key > p_after_setting_key)
    ORDER BY ss.specimen_key LIMIT p_setting_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'specimenId', 'spec_' || specimen_key::text, 'visibility', visibility,
      'publicName', public_name, 'story', story,
      'facts', jsonb_build_object('species', show_species, 'sex', show_sex, 'lifeStage', show_life_stage),
      'revision', revision
    ) ORDER BY specimen_key) FILTER (WHERE rn <= p_setting_limit), '[]'::jsonb),
    (SELECT specimen_key FROM page WHERE rn = p_setting_limit
       AND EXISTS (SELECT 1 FROM page WHERE rn = p_setting_limit + 1))
  INTO settings_json, setting_next FROM page;

  WITH avail AS (
    SELECT 'tank'::text AS kind, t.tank_key AS key, t.internal_name AS owner_label, NULL::text AS species_label,
      (te.identity_state = 'verified' AND t.is_active AND NOT public.showcase_entity_has_open_conflict(t.tank_key)) AS eligible,
      EXISTS (SELECT 1 FROM public.showcase_room_tanks rt WHERE rt.owner_id = p_owner_id AND rt.tank_key = t.tank_key) AS assigned
    FROM public.showcase_tanks t
    JOIN public.showcase_entities te ON te.public_key = t.tank_key AND te.owner_id = t.owner_id AND te.entity_kind = 'tank'
    WHERE t.owner_id = p_owner_id
    UNION ALL
    SELECT 'specimen'::text, s.specimen_key, s.common_name, s.scientific_name,
      (se.identity_state = 'verified' AND NOT public.showcase_entity_has_open_conflict(s.specimen_key)),
      (s.current_tank_key IS NOT NULL)
    FROM public.showcase_specimens s
    JOIN public.showcase_entities se ON se.public_key = s.specimen_key AND se.owner_id = s.owner_id AND se.entity_kind = 'specimen'
    WHERE s.owner_id = p_owner_id
  ), page AS (
    SELECT *, row_number() OVER (ORDER BY kind, key) AS rn
    FROM avail
    WHERE p_after_available_kind IS NULL
       OR (kind, key) > (p_after_available_kind, p_after_available_key)
    ORDER BY kind, key LIMIT p_available_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind', kind,
      'entityId', CASE kind WHEN 'tank' THEN 'tank_' ELSE 'spec_' END || key::text,
      'ownerLabel', owner_label, 'speciesLabel', species_label,
      'eligible', eligible, 'assigned', assigned
    ) ORDER BY kind, key) FILTER (WHERE rn <= p_available_limit), '[]'::jsonb),
    (SELECT jsonb_build_object('kind', kind, 'key', key) FROM page WHERE rn = p_available_limit
       AND EXISTS (SELECT 1 FROM page WHERE rn = p_available_limit + 1))
  INTO available_json, available_next FROM page;

  -- Closed-code publication blockers (owner-facing builder aid; never leaks identity internals).
  SELECT COALESCE(jsonb_agg(DISTINCT code), '[]'::jsonb) INTO blockers FROM (
    SELECT 'PLACEMENT_TANK_INELIGIBLE'::text AS code
    FROM public.showcase_room_tanks rt
    JOIN public.showcase_entities te ON te.public_key = rt.tank_key AND te.owner_id = rt.owner_id AND te.entity_kind = 'tank'
    JOIN public.showcase_tanks t ON t.tank_key = rt.tank_key AND t.owner_id = rt.owner_id
    WHERE rt.owner_id = p_owner_id AND rt.visibility <> 'private'
      AND (te.identity_state <> 'verified' OR NOT t.is_active OR public.showcase_entity_has_open_conflict(rt.tank_key))
    UNION ALL
    SELECT 'SPECIMEN_INELIGIBLE'
    FROM public.showcase_specimen_settings ss
    JOIN public.showcase_entities se ON se.public_key = ss.specimen_key AND se.owner_id = ss.owner_id AND se.entity_kind = 'specimen'
    WHERE ss.owner_id = p_owner_id AND ss.visibility = 'public'
      AND (se.identity_state <> 'verified' OR public.showcase_entity_has_open_conflict(ss.specimen_key))
  ) b;

  result := jsonb_build_object(
    'room', room_json,
    'placements', placements_json, 'placementNextCursor', placement_next,
    'settings', settings_json, 'settingNextCursor', setting_next,
    'available', available_json, 'availableNextCursor', available_next,
    'blockers', blockers
  );
  IF octet_length(result::text) > 262144 THEN
    RAISE EXCEPTION 'SHOWCASE_OWNER_ROOM_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;
  RETURN result;
END;
$$;

-- Immediate least privilege. Final convergent grants are in 143000.
ALTER FUNCTION public.showcase_owner_room_dto(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_render_room_projection(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_create_owner_room(uuid,text,text,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_update_owner_room(uuid,uuid,bigint,text,text,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_set_owner_room_visibility(uuid,uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_publication_preview(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_put_room_tank(uuid,uuid,uuid,bigint,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_remove_room_tank(uuid,uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.showcase_put_specimen_settings(uuid,uuid,bigint,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_reset_owner_room(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_room(uuid,uuid,integer,uuid,integer,text,uuid,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.showcase_owner_room_dto(public.showcase_rooms) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_render_room_projection(public.showcase_rooms) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_create_owner_room(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_update_owner_room(uuid,uuid,bigint,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_set_owner_room_visibility(uuid,uuid,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_owner_publication_preview(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_put_room_tank(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_remove_room_tank(uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_put_specimen_settings(uuid,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_reset_owner_room(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_owner_room(uuid,uuid,integer,uuid,integer,text,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
