\set ON_ERROR_STOP on
\echo 'Running Fish Room R1.2 PostgreSQL invariants'

BEGIN;

DO $showcase_r12_invariants$
<<r12>>
DECLARE
  owner_a uuid;
  owner_a_again uuid;
  owner_b uuid;
  wallet_link uuid;
  dto jsonb;
  replay_result jsonb;
  blocked boolean;
  tank_key constant uuid := '10000000-0000-4000-8000-000000000001';
  tombstone_tank_key constant uuid := '10000000-0000-4000-8000-000000000002';
  specimen_key constant uuid := '20000000-0000-4000-8000-000000000001';
  race_specimen_key constant uuid := '20000000-0000-4000-8000-000000000002';
  room_id constant uuid := '30000000-0000-4000-8000-000000000001';
  media_id constant uuid := '40000000-0000-4000-8000-000000000001';
  media_version_id constant uuid := '50000000-0000-4000-8000-000000000001';
  transfer_id constant uuid := '60000000-0000-4000-8000-000000000001';
  race_transfer_id constant uuid := '60000000-0000-4000-8000-000000000002';
  conflict_id constant uuid := '70000000-0000-4000-8000-000000000001';
BEGIN
  owner_a := public.showcase_resolve_owner_principal('did:privy:fish-room-r12-owner-a');
  owner_a_again := public.showcase_resolve_owner_principal('did:privy:fish-room-r12-owner-a');
  owner_b := public.showcase_resolve_owner_principal('did:privy:fish-room-r12-owner-b');
  IF owner_a <> owner_a_again OR owner_a = owner_b THEN
    RAISE EXCEPTION 'principal resolution is not unique/idempotent';
  END IF;

  wallet_link := public.showcase_link_owner_wallet(
    owner_a, 84532, '0x1111111111111111111111111111111111111111', NULL,
    'privy_token_claim', 'r12-invariant-token-claim'
  );
  IF wallet_link IS DISTINCT FROM public.showcase_link_owner_wallet(
    owner_a, 84532, '0x1111111111111111111111111111111111111111', NULL,
    'privy_token_claim', 'r12-invariant-token-claim'
  ) THEN
    RAISE EXCEPTION 'wallet link is not idempotent for the same principal';
  END IF;

  blocked := false;
  BEGIN
    PERFORM public.showcase_link_owner_wallet(
      owner_b, 84532, '0x1111111111111111111111111111111111111111', NULL,
      'privy_token_claim', 'forged-owner-claim'
    );
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'wallet reassignment was accepted'; END IF;

  UPDATE public.showcase_owner_wallets SET revoked_at = now() WHERE id = wallet_link;
  blocked := false;
  BEGIN
    PERFORM public.showcase_link_owner_wallet(
      owner_a, 84532, '0x1111111111111111111111111111111111111111', NULL,
      'privy_token_claim', 'revoked-reuse'
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'revoked wallet link was reauthorized'; END IF;

  INSERT INTO public.showcase_entities
    (public_key, entity_kind, origin_owner_id, owner_id, identity_state)
  VALUES
    (tank_key, 'tank', owner_a, owner_a, 'verified'),
    (tombstone_tank_key, 'tank', owner_a, owner_a, 'verified'),
    (specimen_key, 'specimen', owner_a, owner_a, 'verified'),
    (race_specimen_key, 'specimen', owner_a, owner_a, 'verified');

  INSERT INTO public.showcase_tanks
    (tank_key, owner_id, internal_name, volume_liters, tank_type, source_revision, source_checksum)
  VALUES
    (tank_key, owner_a, 'Private internal main tank', 75, 'freshwater', 1, decode(repeat('11', 32), 'hex')),
    (tombstone_tank_key, owner_a, 'Private internal retired tank', 20, 'freshwater', 1, decode(repeat('12', 32), 'hex'));

  INSERT INTO public.showcase_specimens
    (specimen_key, owner_id, current_tank_key, common_name, scientific_name, sex, life_stage,
     approximate_size, source_revision, source_checksum)
  VALUES
    (specimen_key, owner_a, tank_key, 'Ricefish', 'Oryzias latipes', 'female', 'adult',
     '3 cm', 1, decode(repeat('21', 32), 'hex')),
    (race_specimen_key, owner_a, tank_key, 'Ricefish', 'Oryzias latipes', 'male', 'adult',
     '3 cm', 1, decode(repeat('22', 32), 'hex'));

  INSERT INTO public.showcase_specimen_ownership
    (specimen_key, owner_id, valid_from, evidence_kind, evidence_reference, finality_state)
  VALUES
    (specimen_key, owner_a, now() - interval '1 day', 'initial_enrollment', 'r12-initial-1', 'initial'),
    (race_specimen_key, owner_a, now() - interval '1 day', 'initial_enrollment', 'r12-initial-2', 'initial');

  INSERT INTO public.showcase_entity_aliases
    (entity_key, entity_kind, owner_scope_id, alias_kind, namespace, value,
     initial_evidence_kind, initial_evidence_reference)
  VALUES
    (specimen_key, 'specimen', owner_a, 'local_specimen',
     'local-specimen:' || owner_a::text || ':11111111-1111-4111-8111-111111111111',
     '1', 'migration', 'r12-local-alias');

  blocked := false;
  BEGIN
    DELETE FROM public.showcase_entity_aliases
    WHERE entity_key = r12.specimen_key AND alias_kind = 'local_specimen';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'lifetime alias deletion was accepted'; END IF;

  INSERT INTO public.showcase_rooms
    (id, owner_id, slug, title, description, schematic_data)
  VALUES
    (room_id, owner_a, 'river-room', 'River Room', 'Public test Room',
     '{"zones":[{"id":"display","label":"Display","kind":"display"}]}'::jsonb);

  blocked := false;
  BEGIN
    INSERT INTO public.showcase_rooms (owner_id, slug, title)
    VALUES (owner_a, 'second-room', 'Second Room');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'second lifetime Room was accepted'; END IF;

  UPDATE public.showcase_rooms
  SET visibility = 'public', revision = revision + 1
  WHERE id = r12.room_id;

  INSERT INTO public.showcase_room_tanks
    (room_id, tank_key, owner_id, slug, visibility, public_label, caption,
     show_volume, show_tank_type, show_published_inhabitant_count,
     x, y, zone_id, display_order)
  VALUES
    (room_id, tank_key, owner_a, 'main-display', 'public', 'Main Display', 'Owner-authored caption',
     true, true, true, 0.4, 0.5, 'display', 0),
    (room_id, tombstone_tank_key, owner_a, 'retired-display', 'public', 'Retired Display', NULL,
     false, false, false, 0.2, 0.2, 'display', 1);

  INSERT INTO public.showcase_specimen_settings
    (owner_id, specimen_key, visibility, public_name, story, show_species, show_sex, show_life_stage)
  VALUES
    (owner_a, specimen_key, 'public', 'Ember', 'Owner-authored story', true, true, true);

  INSERT INTO public.showcase_media_assets
    (id, owner_id, purpose, state, source_object_key, decoded_mime,
     width, height, pixel_count, byte_size, checksum, metadata_stripped, alt_text)
  VALUES
    (media_id, owner_a, 'specimen', 'approved',
     'owners/' || owner_a::text || '/assets/' || media_id::text || '/source.jpg',
     'image/jpeg', 800, 600, 480000, 100000, decode(repeat('31', 32), 'hex'), true, 'A ricefish');

  INSERT INTO public.showcase_media_asset_versions
    (id, asset_id, owner_id, variant, object_key, mime, width, height, byte_size, checksum)
  VALUES
    (media_version_id, media_id, owner_a, 'card',
     'owners/' || owner_a::text || '/assets/' || media_id::text || '/versions/'
       || media_version_id::text || '/card.webp',
     'image/webp', 800, 600, 90000, decode(repeat('32', 32), 'hex'));

  INSERT INTO public.showcase_media_attachments
    (owner_id, asset_id, asset_version_id, parent_kind, parent_key, purpose, slot, state)
  VALUES
    (owner_a, media_id, media_version_id, 'specimen', specimen_key, 'specimen', 'primary', 'published');

  blocked := false;
  BEGIN
    INSERT INTO public.showcase_media_assets
      (owner_id, purpose, source_object_key)
    VALUES
      (owner_a, 'tank', 'owners/' || owner_a::text
       || '/assets/80000000-0000-4000-8000-000000000001/source.extra/escape.jpg');
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'noncanonical media path was accepted'; END IF;

  dto := public.showcase_public_room('river-room', NULL);
  IF dto IS NULL
     OR jsonb_array_length(dto #> '{room,tanks}') <> 2
     OR jsonb_array_length(dto #> '{room,tanks,0,specimens}') <> 1
     OR dto #>> '{room,tanks,0,tankKey}' <> 'tank_' || tank_key::text
     OR dto #>> '{room,tanks,0,specimens,0,specimenKey}' <> 'spec_' || specimen_key::text
     OR dto #>> '{room,tanks,0,specimens,0,publicName}' <> 'Ember' THEN
    RAISE EXCEPTION 'public projection did not emit the expected allowlisted hierarchy: %', dto;
  END IF;
  IF dto::text ~ 'internal_name|owner_id|wallet|source_object_key|approximateSize|careFact|establishedAt' THEN
    RAISE EXCEPTION 'public projection leaked a denied/deferred field: %', dto;
  END IF;

  UPDATE public.showcase_room_tanks AS rt
  SET visibility = 'unlisted', revision = rt.revision + 1
  WHERE rt.room_id = r12.room_id AND rt.tank_key = r12.tank_key;
  IF jsonb_array_length(public.showcase_public_room('river-room', NULL) #> '{room,tanks}') <> 1
     OR public.showcase_public_room('river-room', 'main-display') IS NULL THEN
    RAISE EXCEPTION 'unlisted tank visibility matrix failed';
  END IF;
  UPDATE public.showcase_room_tanks AS rt
  SET visibility = 'public', revision = rt.revision + 1
  WHERE rt.room_id = r12.room_id AND rt.tank_key = r12.tank_key;

  UPDATE public.showcase_rooms
  SET visibility = 'private', revision = revision + 1
  WHERE id = r12.room_id;
  IF public.showcase_public_room('river-room', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'private Room remained publicly projectable';
  END IF;
  UPDATE public.showcase_rooms
  SET visibility = 'public', revision = revision + 1
  WHERE id = r12.room_id;

  blocked := false;
  BEGIN
    INSERT INTO public.showcase_room_tanks
      (room_id, tank_key, owner_id, slug, x, y, display_order)
    VALUES
      (room_id, tank_key, owner_b, 'cross-owner', 0.1, 0.1, 99);
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'cross-owner Room/tank reference was accepted'; END IF;

  blocked := false;
  BEGIN
    UPDATE public.showcase_entities
    SET owner_id = owner_b, revision = revision + 1
    WHERE public_key = r12.tank_key;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'direct tank owner mutation was accepted'; END IF;

  DELETE FROM public.showcase_room_tanks AS rt
  WHERE rt.room_id = r12.room_id AND rt.tank_key = r12.tombstone_tank_key;
  blocked := false;
  BEGIN
    INSERT INTO public.showcase_room_tanks
      (room_id, tank_key, owner_id, slug, visibility, public_label, x, y, zone_id, display_order)
    VALUES
      (room_id, tombstone_tank_key, owner_a, 'retired-display', 'public', 'Reused',
       0.2, 0.2, 'display', 1);
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'tombstoned tank slug was resurrected'; END IF;

  INSERT INTO public.showcase_transfer_evidence
    (id, specimen_key, from_owner_id, to_owner_id, evidence_kind,
     evidence_reference, evidence_checksum, finality_state, accepted_at)
  VALUES
    (transfer_id, specimen_key, owner_a, owner_b, 'signed_transfer',
     'r12-final-transfer', decode(repeat('41', 32), 'hex'), 'accepted_final', now()),
    (race_transfer_id, race_specimen_key, owner_a, owner_b, 'signed_transfer',
     'r12-race-transfer', decode(repeat('42', 32), 'hex'), 'pending', NULL);

  blocked := false;
  BEGIN
    PERFORM public.showcase_transfer_specimen(race_transfer_id);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'nonfinal transfer evidence was accepted'; END IF;

  UPDATE public.showcase_transfer_evidence
  SET finality_state = 'accepted_final', accepted_at = now()
  WHERE id = race_transfer_id;

  INSERT INTO public.showcase_identity_conflicts
    (id, owner_id, conflict_kind, reason_code)
  VALUES (conflict_id, owner_a, 'alias_collision', 'R12_TEST_CONFLICT');
  INSERT INTO public.showcase_identity_conflict_entities (conflict_id, entity_key)
  VALUES (conflict_id, race_specimen_key);

  blocked := false;
  BEGIN
    PERFORM public.showcase_transfer_specimen(race_transfer_id);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'transfer with open identity conflict was accepted'; END IF;

  INSERT INTO public.showcase_identity_resolutions
    (conflict_id, actor_owner_id, chosen_entity_key, reason, candidate_checksums)
  VALUES
    (conflict_id, owner_a, race_specimen_key, 'R1.2 invariant resolution',
     jsonb_build_object(race_specimen_key::text, repeat('42', 32)));
  UPDATE public.showcase_identity_conflicts
  SET status = 'resolved', resolved_at = now()
  WHERE id = conflict_id;

  PERFORM public.showcase_transfer_specimen(transfer_id);

  IF (SELECT e.owner_id FROM public.showcase_entities e WHERE e.public_key = r12.specimen_key) <> owner_b
     OR (SELECT s.owner_id FROM public.showcase_specimens s WHERE s.specimen_key = r12.specimen_key) <> owner_b
     OR (SELECT s.current_tank_key FROM public.showcase_specimens s WHERE s.specimen_key = r12.specimen_key) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.showcase_specimen_settings ss WHERE ss.specimen_key = r12.specimen_key)
     OR NOT EXISTS (
       SELECT 1 FROM public.showcase_specimen_setting_history ssh
       WHERE ssh.specimen_key = r12.specimen_key AND ssh.transfer_evidence_id = transfer_id
     )
     OR (SELECT ma.state FROM public.showcase_media_attachments ma WHERE ma.asset_id = media_id) <> 'archived'
     OR (SELECT asset.state FROM public.showcase_media_assets asset WHERE asset.id = media_id) <> 'revoked'
     OR (SELECT count(*) FROM public.showcase_specimen_ownership so
         WHERE so.specimen_key = r12.specimen_key AND so.valid_to IS NULL AND so.owner_id = owner_b) <> 1
     OR (SELECT te.committed_ownership_id FROM public.showcase_transfer_evidence te WHERE te.id = transfer_id) IS NULL
     OR (SELECT count(*) FROM public.showcase_projection_invalidations pi
         WHERE pi.transfer_evidence_id = transfer_id) <> 2 THEN
    RAISE EXCEPTION 'atomic transfer effects are incomplete';
  END IF;

  replay_result := public.showcase_transfer_specimen(transfer_id);
  IF replay_result->>'replay' <> 'true' OR replay_result->>'committed' <> 'true' THEN
    RAISE EXCEPTION 'committed transfer replay was not idempotent: %', replay_result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.showcase_specimen_settings ss
    WHERE ss.owner_id = owner_b AND ss.specimen_key = r12.specimen_key
  ) THEN
    RAISE EXCEPTION 'transfer created buyer-authored publication state';
  END IF;

  IF public.showcase_public_room('river-room', NULL) #> '{room,tanks,0,specimens}' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'transferred specimen remained in the old public projection';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
      AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'a showcase base table lacks ENABLE/FORCE RLS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'showcase\_%' ESCAPE '\'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'a browser/service role retains showcase base-table privileges';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'showcase\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'a browser-facing showcase base-table policy exists';
  END IF;

  IF (SELECT count(*)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 4 THEN
    RAISE EXCEPTION 'service_role execute surface is not exactly four showcase RPCs';
  END IF;

  IF has_function_privilege('anon', 'public.showcase_public_room(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.showcase_public_room(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.showcase_public_room(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public projection execute ACL is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'showcase_public_room'
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'public projection owner/SECURITY DEFINER/search_path posture is incorrect';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
      AND c.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'an alternate showcase view surface exists';
  END IF;

  RAISE NOTICE 'Fish Room R1.2 invariant harness passed; owner_a=%, owner_b=%', owner_a, owner_b;
END;
$showcase_r12_invariants$;

COMMIT;

-- Verify the projection works through the only granted server role.
SET ROLE service_role;
SELECT public.showcase_public_room('river-room', NULL) IS NOT NULL AS service_projection_allowed;
RESET ROLE;

\echo 'Fish Room R1.2 PostgreSQL invariants complete'
