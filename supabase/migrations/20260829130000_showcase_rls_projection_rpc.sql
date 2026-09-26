-- Fish Room R1.2 Tier A final RLS/ACL boundary and sole public-data projection.

BEGIN;

CREATE FUNCTION public.showcase_entity_has_open_conflict(p_entity_key uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.showcase_identity_conflicts ic
    WHERE ic.status = 'open'
      AND (
        EXISTS (
          SELECT 1 FROM public.showcase_identity_conflict_entities ice
          WHERE ice.conflict_id = ic.id AND ice.entity_key = p_entity_key
        )
        OR EXISTS (
          SELECT 1
          FROM public.showcase_identity_conflict_claims icc
          JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
          WHERE icc.conflict_id = ic.id AND ac.candidate_entity_key = p_entity_key
        )
      )
  );
$$;

CREATE FUNCTION public.showcase_public_room(
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

ALTER FUNCTION public.showcase_public_room(text, text) OWNER TO postgres;
COMMENT ON FUNCTION public.showcase_public_room(text, text) IS
  'Sole bounded Fish Room public-data projection; called only by the public server endpoint.';

-- Convergent final-state RLS/ACL lockdown across every R1.2 base relation.
DO $showcase_final_rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'showcase_owner_principals', 'showcase_owner_wallets', 'showcase_wallet_link_nonces',
    'showcase_datasets', 'showcase_dataset_imports', 'showcase_entities', 'showcase_tanks',
    'showcase_specimens', 'showcase_transfer_evidence', 'showcase_specimen_ownership',
    'showcase_entity_aliases', 'showcase_alias_events', 'showcase_alias_claims',
    'showcase_identity_conflicts', 'showcase_identity_conflict_claims',
    'showcase_identity_conflict_entities', 'showcase_identity_resolutions',
    'showcase_projection_invalidations', 'showcase_rooms', 'showcase_room_tanks',
    'showcase_specimen_settings', 'showcase_specimen_setting_history',
    'showcase_media_assets', 'showcase_media_asset_versions',
    'showcase_media_attachments', 'showcase_room_slug_history',
    'showcase_tank_slug_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
  END LOOP;
END;
$showcase_final_rls$;

-- Remove every default function execute grant, then restore only reviewed server RPCs.
DO $showcase_final_function_acl$
DECLARE
  function_signature text;
BEGIN
  FOR function_signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      function_signature
    );
  END LOOP;
END;
$showcase_final_function_acl$;

GRANT EXECUTE ON FUNCTION public.showcase_resolve_owner_principal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_link_owner_wallet(uuid, bigint, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_transfer_specimen(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_public_room(text, text) TO service_role;

COMMIT;
