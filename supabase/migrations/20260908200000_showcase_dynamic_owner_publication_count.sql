-- Dynamic owner-confirmed publication count.
--
-- The original Phase-A publication RPC hardcoded "exactly seven" placements, an
-- assumption about one specific owner. Owners publish the exact set of tanks they
-- confirmed, which may be any 1..100 (the room tank ceiling). This migration
-- replaces the three fixed "= 7" checks with the owner-confirmed count while
-- PRESERVING the security invariant unchanged: publication still atomically binds
-- expected == matched == actual placements, requires distinct expected tankIds,
-- re-renders and compares the complete approved projection under lock, and keeps
-- the same CAS/revision and eligibility gates. Only the magic number is removed.
--
-- CREATE OR REPLACE keeps the existing owner and grants; they are re-affirmed at
-- the end for clarity. Reversible by re-applying the prior definition in
-- 20260908173000_showcase_atomic_owner_publication.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.showcase_set_owner_room_visibility_v2(
  p_owner_id uuid,
  p_room_id uuid,
  p_expected_revision bigint,
  p_visibility text,
  p_expected_placements jsonb,
  p_approved_preview jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  room_row public.showcase_rooms%ROWTYPE;
  proposed_room public.showcase_rooms%ROWTYPE;
  updated public.showcase_rooms%ROWTYPE;
  current_preview jsonb;
  published_preview jsonb;
  evidence jsonb;
  revision_text text;
  expected_count integer;
  actual_count integer;
  matched_count integer;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_visibility IS NULL OR p_visibility NOT IN ('unlisted', 'public') THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_expected_placements) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_approved_preview) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
  END IF;
  -- The owner-confirmed set may be any 1..100 tanks (the room tank ceiling).
  IF jsonb_array_length(p_expected_placements) < 1
     OR jsonb_array_length(p_expected_placements) > 100 THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Stage structural/type checks before regexes and casts so malformed direct-RPC JSON always
  -- receives the closed validation error rather than an implementation-dependent SQL exception.
  FOR evidence IN SELECT value FROM jsonb_array_elements(p_expected_placements)
  LOOP
    IF jsonb_typeof(evidence) <> 'object' THEN
      RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
    END IF;
    IF evidence - ARRAY['tankId','revision']::text[] <> '{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(evidence)) <> 2
       OR jsonb_typeof(evidence->'tankId') <> 'string'
       OR jsonb_typeof(evidence->'revision') <> 'number' THEN
      RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
    END IF;
    revision_text := evidence->>'revision';
    IF (evidence->>'tankId') !~ '^tank_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR revision_text !~ '^(0|[1-9][0-9]*)$'
       OR char_length(revision_text) > 19 THEN
      RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
    END IF;
    IF revision_text::numeric > 9223372036854775807 THEN
      RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Distinctness is still required: every expected tankId must be unique. The
  -- count is now the owner-confirmed count rather than a fixed 7.
  SELECT count(*), count(DISTINCT item->>'tankId')
  INTO expected_count, matched_count
  FROM jsonb_array_elements(p_expected_placements) AS e(item);
  IF expected_count < 1 OR matched_count <> expected_count THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Every projection-affecting owner RPC uses this transaction-scoped advisory lock. Holding it
  -- through validation, visibility update, and preview rendering closes the API preflight race.
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  -- Identity staging/adjudication uses its own namespace. Publication acquires it second; identity
  -- writers never acquire the publication lock, so this serializes eligibility without a cycle.
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  SELECT * INTO room_row
  FROM public.showcase_rooms
  WHERE id = p_room_id AND owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND OR room_row.revision <> p_expected_revision OR room_row.visibility <> 'private' THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  -- Identity staging/adjudication uses a separate advisory namespace, so lock every existing
  -- projection source row directly. Identity writers that could change eligibility or rendered
  -- facts must then finish before this transaction reads, and cannot commit another change until
  -- publication completes. New unrelated entities cannot enter the room without the owner lock.
  PERFORM public_key FROM public.showcase_entities
    WHERE owner_id = p_owner_id ORDER BY public_key FOR UPDATE;
  PERFORM tank_key FROM public.showcase_tanks
    WHERE owner_id = p_owner_id ORDER BY tank_key FOR UPDATE;
  PERFORM specimen_key FROM public.showcase_specimens
    WHERE owner_id = p_owner_id ORDER BY specimen_key FOR UPDATE;

  WITH expected AS (
    SELECT substring(item->>'tankId' FROM 6)::uuid AS tank_key,
           (item->>'revision')::bigint AS revision
    FROM jsonb_array_elements(p_expected_placements) AS e(item)
  ), actual AS (
    SELECT rt.tank_key, rt.revision, rt.visibility,
           rt.commerce_listing_key, rt.commerce_visibility,
           te.identity_state, t.is_active,
           public.showcase_entity_has_open_conflict(rt.tank_key) AS has_conflict,
           e.tank_key IS NOT NULL AS expected_match
    FROM public.showcase_room_tanks rt
    JOIN public.showcase_entities te
      ON te.public_key = rt.tank_key AND te.owner_id = rt.owner_id AND te.entity_kind = 'tank'
    JOIN public.showcase_tanks t
      ON t.tank_key = rt.tank_key AND t.owner_id = rt.owner_id
    LEFT JOIN expected e ON e.tank_key = rt.tank_key AND e.revision = rt.revision
    WHERE rt.room_id = p_room_id AND rt.owner_id = p_owner_id
  )
  SELECT count(*), count(*) FILTER (
    WHERE expected_match
      AND visibility = 'public'
      AND commerce_listing_key IS NULL
      AND commerce_visibility IS NULL
      AND identity_state = 'verified'
      AND is_active
      AND NOT has_conflict
  )
  INTO actual_count, matched_count
  FROM actual;

  -- The room must contain exactly the owner-confirmed set, all eligible/public.
  IF actual_count <> expected_count OR matched_count <> expected_count THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  -- Bind approval to the complete intended target projection, including target visibility, room
  -- metadata, placement labels/facts/geometry, specimens, and currently rendered media.
  proposed_room := room_row;
  proposed_room.visibility := p_visibility;
  current_preview := public.showcase_render_room_projection(proposed_room);
  IF current_preview IS DISTINCT FROM p_approved_preview THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  UPDATE public.showcase_rooms
  SET visibility = p_visibility, revision = revision + 1
  WHERE id = p_room_id AND owner_id = p_owner_id
    AND revision = p_expected_revision AND visibility = 'private'
  RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_CAS_CONFLICT' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.showcase_projection_invalidations (owner_id, reason)
  VALUES (p_owner_id, 'publication_change');

  published_preview := public.showcase_public_room(updated.slug, NULL);
  IF published_preview IS NULL OR published_preview IS DISTINCT FROM p_approved_preview THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_PREVIEW_INVALID' USING ERRCODE = '55000';
  END IF;

  RETURN public.showcase_owner_room_dto(updated)
    || jsonb_build_object('preview', published_preview);
END;
$$;

ALTER FUNCTION public.showcase_set_owner_room_visibility_v2(uuid,uuid,bigint,text,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.showcase_set_owner_room_visibility_v2(uuid,uuid,bigint,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.showcase_set_owner_room_visibility_v2(uuid,uuid,bigint,text,jsonb,jsonb)
  TO service_role;

COMMIT;
