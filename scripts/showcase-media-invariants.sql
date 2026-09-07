\set ON_ERROR_STOP on
\echo 'Running showcase-media transactional invariants'

BEGIN;

CREATE FUNCTION pg_temp.showcase_valid_versions(p_claim jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object(
      'versionId', p_claim #>> '{versions,0,versionId}',
      'variant', 'hero',
      'objectKey', p_claim #>> '{versions,0,objectKey}',
      'mime', 'image/webp',
      'width', 1200,
      'height', 800,
      'byteSize', 200000,
      'checksumHex', repeat('a1', 32)
    ),
    jsonb_build_object(
      'versionId', p_claim #>> '{versions,1,versionId}',
      'variant', 'thumb',
      'objectKey', p_claim #>> '{versions,1,objectKey}',
      'mime', 'image/webp',
      'width', 400,
      'height', 267,
      'byteSize', 40000,
      'checksumHex', repeat('b2', 32)
    )
  );
$$;

DO $media_invariants$
#variable_conflict use_column
<<media_test>>
DECLARE
  owner_a uuid;
  owner_b uuid;
  room_id constant uuid := '91000000-0000-4000-8000-000000000001';
  worker_a constant uuid := '92000000-0000-4000-8000-000000000001';
  worker_b constant uuid := '92000000-0000-4000-8000-000000000002';
  stage jsonb;
  claim jsonb;
  result jsonb;
  media_auth jsonb;
  dto jsonb;
  asset_id uuid;
  intent_id uuid;
  job_id uuid;
  current_revision bigint;
  before_time timestamptz;
  available_time timestamptz;
  backdated_created timestamptz;
  expected_delays interval[] := ARRAY[
    interval '5 minutes', interval '1 hour', interval '6 hours', interval '24 hours'
  ];
  attempt_no integer;
  cleanup_claim jsonb;
  reset_asset constant uuid := '93000000-0000-4000-8000-000000000001';
  reset_version constant uuid := '94000000-0000-4000-8000-000000000001';
  blocked boolean;
BEGIN
  owner_a := public.showcase_resolve_owner_principal('did:privy:showcase-media-validation-owner-a');
  owner_b := public.showcase_resolve_owner_principal('did:privy:showcase-media-validation-owner-b');

  INSERT INTO public.showcase_rooms (id, owner_id, slug, title, description, schematic_data)
  VALUES (room_id, owner_a, 'media-validation-room', 'Media Validation Room',
    'Disposable PostgreSQL validation only', '{"zones":[]}'::jsonb);

  -- Stage reserves the full 16 MiB before returning an exact five-minute object binding.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  IF stage->>'sourceObjectKey' <> 'owners/' || owner_a::text || '/assets/' || asset_id::text || '/source.jpg'
     OR stage->>'contentType' <> 'image/jpeg' THEN
    RAISE EXCEPTION 'Stage returned a noncanonical source binding: %', stage;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_media_upload_intents
    WHERE id = intent_id AND owner_id = owner_a AND asset_id = media_test.asset_id
      AND state = 'staging'
      AND expires_at - created_at = interval '5 minutes'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.showcase_media_quota_reservations
    WHERE asset_id = media_test.asset_id AND owner_id = owner_a
      AND accounted_bytes = 16777216 AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Atomic stage intent/quota reservation is incomplete';
  END IF;
  IF public.showcase_owner_media_upload_binding(owner_b, asset_id, intent_id) IS NOT NULL
     OR public.showcase_owner_media_status(owner_b, asset_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-owner media lookup was authorized';
  END IF;

  blocked := false;
  BEGIN
    PERFORM public.showcase_finalize_room_hero_upload(owner_b, asset_id, intent_id, 100000);
  EXCEPTION WHEN no_data_found THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Cross-owner finalize was accepted'; END IF;

  result := public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  IF result->>'state' <> 'processing'
     OR (SELECT state FROM public.showcase_media_upload_intents WHERE id = intent_id) <> 'finalized'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'processing'
     OR (SELECT count(*) FROM public.showcase_media_jobs
         WHERE asset_id = media_test.asset_id AND job_kind = 'process_source' AND state = 'queued') <> 1 THEN
    RAISE EXCEPTION 'Finalize did not atomically transition and enqueue';
  END IF;

  claim := public.showcase_claim_media_job(worker_a, 300);
  job_id := (claim->>'jobId')::uuid;
  IF claim->>'assetId' <> asset_id::text OR claim->>'kind' <> 'process_source'
     OR claim->>'attempt' <> '1' OR jsonb_array_length(claim->'versions') <> 2 THEN
    RAISE EXCEPTION 'Process lease did not return the closed plan: %', claim;
  END IF;

  result := public.showcase_complete_media_processing(
    job_id, worker_a, 'image/jpeg', 1200, 800, 100000, repeat('c3', 32), true,
    pg_temp.showcase_valid_versions(claim)
  );
  IF result->>'state' <> 'approved'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'approved'
     OR (SELECT count(*) FROM public.showcase_media_asset_versions WHERE asset_id = media_test.asset_id) <> 2
     OR (SELECT accounted_bytes FROM public.showcase_media_quota_reservations
         WHERE asset_id = media_test.asset_id) <> 340000
     OR (SELECT count(*) FROM public.showcase_media_jobs
         WHERE asset_id = media_test.asset_id AND job_kind = 'delete_source' AND state = 'queued') <> 1 THEN
    RAISE EXCEPTION 'Processing completion/accounting/source cleanup is incomplete';
  END IF;

  cleanup_claim := public.showcase_claim_media_job(worker_b, 300);
  IF cleanup_claim->>'kind' <> 'delete_source' THEN
    RAISE EXCEPTION 'Expected source deletion lease, got %', cleanup_claim;
  END IF;
  PERFORM public.showcase_complete_media_deletion(
    (cleanup_claim->>'jobId')::uuid, worker_b
  );
  IF (SELECT accounted_bytes FROM public.showcase_media_quota_reservations
      WHERE asset_id = media_test.asset_id) <> 240000
     OR (SELECT source_deleted_at FROM public.showcase_media_quota_reservations
         WHERE asset_id = media_test.asset_id) IS NULL THEN
    RAISE EXCEPTION 'Verified source deletion did not reduce retained accounting';
  END IF;

  result := public.showcase_publish_room_hero(
    owner_a, room_id, asset_id, 'A planted validation aquarium', 0.5, 0.4
  );
  IF result->>'state' <> 'published'
     OR public.showcase_authorize_media_read(asset_id, 'hero') IS NOT NULL THEN
    RAISE EXCEPTION 'Private Room publication unexpectedly authorized bytes';
  END IF;

  UPDATE public.showcase_rooms SET visibility = 'public', revision = revision + 1
  WHERE id = room_id;
  media_auth := public.showcase_authorize_media_read(asset_id, 'hero');
  dto := public.showcase_public_room('media-validation-room', NULL);
  IF media_auth IS NULL
     OR media_auth->>'bucket' <> 'showcase-media-derivatives-v1'
     OR media_auth->>'mime' <> 'image/webp'
     OR (media_auth->>'byteSize')::bigint <> 200000
     OR public.showcase_authorize_media_read(asset_id, 'thumb') IS NOT NULL
     OR dto #>> '{room,hero,assetId}' <> asset_id::text
     OR dto #>> '{room,hero,variant}' <> 'hero'
     OR dto::text ~ 'objectKey|sourceObjectKey|ownerId' THEN
    RAISE EXCEPTION 'Public DTO/byte media_auth boundary is incorrect: auth=%, dto=%', media_auth, dto;
  END IF;

  SELECT revision INTO current_revision FROM public.showcase_media_assets WHERE id = asset_id;
  PERFORM public.showcase_revoke_media_asset(owner_a, asset_id, current_revision);
  IF public.showcase_authorize_media_read(asset_id, 'hero') IS NOT NULL
     OR COALESCE(public.showcase_public_room('media-validation-room', NULL) #> '{room,hero}',
       'null'::jsonb) <> 'null'::jsonb
     OR (SELECT state FROM public.showcase_media_attachments WHERE asset_id = media_test.asset_id) <> 'revoked'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'revoked' THEN
    RAISE EXCEPTION 'Revocation closure failed: auth=%, hero=%, attachment=%, asset=%',
      public.showcase_authorize_media_read(asset_id, 'hero'),
      public.showcase_public_room('media-validation-room', NULL) #> '{room,hero}',
      (SELECT state FROM public.showcase_media_attachments WHERE asset_id = media_test.asset_id),
      (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id);
  END IF;

  SELECT revision INTO current_revision FROM public.showcase_media_assets WHERE id = asset_id;
  PERFORM public.showcase_revoke_media_asset(owner_a, asset_id, current_revision);
  IF (SELECT count(*) FROM public.showcase_media_jobs
      WHERE asset_id = media_test.asset_id AND job_kind = 'delete_derivatives') <> 1 THEN
    RAISE EXCEPTION 'Idempotent revoke duplicated derivative cleanup';
  END IF;

  cleanup_claim := public.showcase_claim_media_job(worker_a, 300);
  IF cleanup_claim->>'kind' <> 'delete_derivatives' THEN
    RAISE EXCEPTION 'Expected derivative deletion lease after revoke, got %', cleanup_claim;
  END IF;
  PERFORM public.showcase_complete_media_deletion((cleanup_claim->>'jobId')::uuid, worker_a);
  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_media_quota_reservations
    WHERE asset_id = media_test.asset_id AND accounted_bytes = 0
      AND source_deleted_at IS NOT NULL AND derivatives_deleted_at IS NOT NULL
      AND released_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Terminal verified deletion did not release quota';
  END IF;

  -- Presign failure cancellation releases the full reservation without creating a job.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'png');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  PERFORM public.showcase_cancel_room_hero_stage(owner_a, asset_id, intent_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_media_quota_reservations
    WHERE asset_id = media_test.asset_id AND accounted_bytes = 0 AND released_at IS NOT NULL
  ) OR EXISTS (SELECT 1 FROM public.showcase_media_jobs WHERE asset_id = media_test.asset_id) THEN
    RAISE EXCEPTION 'Cancelled stage retained quota or created work';
  END IF;

  -- Expired abandoned upload becomes denied and enters verified source cleanup.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'webp');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  backdated_created := clock_timestamp() - interval '6 minutes';
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.showcase_media_upload_intents
    SET created_at = backdated_created,
        expires_at = backdated_created + interval '5 minutes'
    WHERE id = intent_id;
  PERFORM set_config('session_replication_role', 'origin', true);
  result := public.showcase_sweep_media_maintenance(50);
  IF (result->>'expiredUploads')::integer <> 1
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'rejected'
     OR (SELECT state FROM public.showcase_media_upload_intents WHERE id = intent_id) <> 'expired' THEN
    RAISE EXCEPTION 'Expired staging sweep failed: %', result;
  END IF;
  cleanup_claim := public.showcase_claim_media_job(worker_a, 300);
  IF cleanup_claim->>'kind' <> 'delete_source' THEN
    RAISE EXCEPTION 'Expired upload did not queue source deletion';
  END IF;
  PERFORM public.showcase_complete_media_deletion((cleanup_claim->>'jobId')::uuid, worker_a);
  IF (SELECT released_at FROM public.showcase_media_quota_reservations
      WHERE asset_id = media_test.asset_id) IS NULL THEN
    RAISE EXCEPTION 'Expired upload cleanup did not release quota';
  END IF;

  -- Transient processing failures follow exactly 5m, 1h, 6h, 24h, then terminal attempt 5.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  PERFORM public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  FOR attempt_no IN 1..4 LOOP
    claim := public.showcase_claim_media_job(worker_a, 300);
    IF claim->>'assetId' <> asset_id::text OR (claim->>'attempt')::integer <> attempt_no THEN
      RAISE EXCEPTION 'Retry attempt % leased the wrong work: %', attempt_no, claim;
    END IF;
    before_time := clock_timestamp();
    result := public.showcase_fail_media_job(
      (claim->>'jobId')::uuid, worker_a, 'TRANSIENT_VALIDATION', false
    );
    SELECT available_at INTO available_time FROM public.showcase_media_jobs
    WHERE id = (claim->>'jobId')::uuid;
    IF result->>'state' <> 'queued'
       OR available_time - before_time < expected_delays[attempt_no] - interval '2 seconds'
       OR available_time - before_time > expected_delays[attempt_no] + interval '2 seconds' THEN
      RAISE EXCEPTION 'Retry delay % is incorrect: result=%, available=% before=%',
        attempt_no, result, available_time, before_time;
    END IF;
    UPDATE public.showcase_media_jobs SET available_at = clock_timestamp() - interval '1 second'
    WHERE id = (claim->>'jobId')::uuid;
  END LOOP;
  claim := public.showcase_claim_media_job(worker_a, 300);
  result := public.showcase_fail_media_job(
    (claim->>'jobId')::uuid, worker_a, 'TRANSIENT_VALIDATION', false
  );
  IF claim->>'attempt' <> '5' OR result->>'state' <> 'dead'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'rejected' THEN
    RAISE EXCEPTION 'Fifth processing failure was not terminal';
  END IF;
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE asset_id = media_test.asset_id AND state = 'queued' AND job_kind <> 'process_source';

  -- Deterministic decoder/security failures terminate immediately but are intentionally recorded
  -- as a handled process job, while the asset is rejected and cleanup is durable.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  PERFORM public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  claim := public.showcase_claim_media_job(worker_a, 300);
  result := public.showcase_fail_media_job(
    (claim->>'jobId')::uuid, worker_a, 'MALFORMED_IMAGE', true
  );
  IF result->>'state' <> 'succeeded'
     OR (SELECT last_error_code FROM public.showcase_media_jobs WHERE id = (claim->>'jobId')::uuid)
       <> 'MALFORMED_IMAGE'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'rejected'
     OR (SELECT count(*) FROM public.showcase_media_jobs
         WHERE asset_id = media_test.asset_id AND job_kind IN ('delete_source','delete_derivatives')) <> 2 THEN
    RAISE EXCEPTION 'Permanent processing failure was not closed and cleaned';
  END IF;
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE asset_id = media_test.asset_id AND state = 'queued' AND job_kind <> 'process_source';

  -- An expired fifth lease becomes dead and rejects the asset; it is never requeued forever.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  PERFORM public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  UPDATE public.showcase_media_jobs SET attempts = 4 WHERE asset_id = media_test.asset_id;
  claim := public.showcase_claim_media_job(worker_a, 30);
  UPDATE public.showcase_media_jobs
    SET leased_at = clock_timestamp() - interval '2 minutes',
        leased_until = clock_timestamp() - interval '1 minute'
    WHERE id = (claim->>'jobId')::uuid;
  result := public.showcase_sweep_media_maintenance(50);
  IF (result->>'recoveredLeases')::integer <> 1
     OR (SELECT state FROM public.showcase_media_jobs WHERE id = (claim->>'jobId')::uuid) <> 'dead'
     OR (SELECT last_error_code FROM public.showcase_media_jobs WHERE id = (claim->>'jobId')::uuid)
       <> 'LEASE_EXHAUSTED'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'rejected' THEN
    RAISE EXCEPTION 'Exhausted fifth lease was not terminal: %', result;
  END IF;
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE asset_id = media_test.asset_id AND state = 'queued' AND job_kind <> 'process_source';

  -- A processor leased before revocation may complete after revocation. Its immutable outputs are
  -- accounted again and derivative deletion is reset to a fresh queued generation.
  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;
  PERFORM public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  claim := public.showcase_claim_media_job(worker_a, 300);
  SELECT revision INTO current_revision FROM public.showcase_media_assets WHERE id = asset_id;
  PERFORM public.showcase_revoke_media_asset(owner_a, asset_id, current_revision);
  result := public.showcase_complete_media_processing(
    (claim->>'jobId')::uuid, worker_a, 'image/jpeg', 1200, 800, 100000,
    repeat('d4', 32), true, pg_temp.showcase_valid_versions(claim)
  );
  IF result->>'state' <> 'revoked'
     OR (SELECT state FROM public.showcase_media_assets WHERE id = media_test.asset_id) <> 'revoked'
     OR (SELECT accounted_bytes FROM public.showcase_media_quota_reservations
         WHERE asset_id = media_test.asset_id) <> 340000
     OR (SELECT derivatives_deleted_at FROM public.showcase_media_quota_reservations
         WHERE asset_id = media_test.asset_id) IS NOT NULL
     OR (SELECT state FROM public.showcase_media_jobs
         WHERE asset_id = media_test.asset_id AND job_kind = 'delete_derivatives') <> 'queued' THEN
    RAISE EXCEPTION 'Late processor/revocation reconciliation failed';
  END IF;
  FOR attempt_no IN 1..2 LOOP
    cleanup_claim := public.showcase_claim_media_job(worker_b, 300);
    IF cleanup_claim->>'kind' NOT IN ('delete_source', 'delete_derivatives') THEN
      RAISE EXCEPTION 'Expected reconciled cleanup job, got %', cleanup_claim;
    END IF;
    PERFORM public.showcase_complete_media_deletion((cleanup_claim->>'jobId')::uuid, worker_b);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_media_quota_reservations
    WHERE asset_id = media_test.asset_id AND accounted_bytes = 0 AND released_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Late processor cleanup did not eventually release quota';
  END IF;

  -- The real Room-reset RPC archives active attachments. The media trigger must immediately deny
  -- the asset and enqueue both source and derivative cleanup rather than retaining orphaned bytes.
  UPDATE public.showcase_rooms SET visibility = 'public', revision = revision + 1 WHERE id = room_id;
  INSERT INTO public.showcase_media_assets (
    id, owner_id, purpose, state, source_object_key, decoded_mime, width, height,
    pixel_count, byte_size, checksum, metadata_stripped, alt_text, focal_x, focal_y
  ) VALUES (
    reset_asset, owner_a, 'room_hero', 'published',
    'owners/' || owner_a::text || '/assets/' || reset_asset::text || '/source.jpg',
    'image/jpeg', 1000, 700, 700000, 100000, decode(repeat('e5', 32), 'hex'),
    true, 'Reset retention validation', 0.5, 0.5
  );
  INSERT INTO public.showcase_media_asset_versions (
    id, asset_id, owner_id, variant, object_key, mime, width, height, byte_size, checksum
  ) VALUES (
    reset_version, reset_asset, owner_a, 'hero',
    'owners/' || owner_a::text || '/assets/' || reset_asset::text || '/versions/'
      || reset_version::text || '/hero.webp',
    'image/webp', 1000, 700, 110000, decode(repeat('f6', 32), 'hex')
  );
  INSERT INTO public.showcase_media_quota_reservations (asset_id, owner_id, accounted_bytes)
  VALUES (reset_asset, owner_a, 210000);
  INSERT INTO public.showcase_media_attachments (
    owner_id, asset_id, asset_version_id, parent_kind, parent_key, purpose, slot, state
  ) VALUES (owner_a, reset_asset, reset_version, 'room', room_id, 'room_hero', 'hero', 'published');
  IF public.showcase_authorize_media_read(reset_asset, 'hero') IS NULL THEN
    RAISE EXCEPTION 'Reset fixture was not publicly authorized before reset';
  END IF;
  SELECT revision INTO current_revision FROM public.showcase_rooms WHERE id = room_id;
  result := public.showcase_reset_owner_room(owner_a, room_id, current_revision);
  IF result->>'reset' <> 'true'
     OR public.showcase_authorize_media_read(reset_asset, 'hero') IS NOT NULL
     OR (SELECT state FROM public.showcase_media_assets WHERE id = reset_asset) <> 'revoked'
     OR (SELECT state FROM public.showcase_media_attachments WHERE asset_id = reset_asset) <> 'archived'
     OR (SELECT count(*) FROM public.showcase_media_jobs
         WHERE asset_id = reset_asset AND job_kind IN ('delete_source','delete_derivatives')
           AND state = 'queued') <> 2 THEN
    RAISE EXCEPTION 'Room reset did not deny and enqueue media cleanup';
  END IF;

  RAISE NOTICE 'Showcase-media transactional invariants passed';
END;
$media_invariants$;

ROLLBACK;

\echo 'Showcase-media transactional invariants complete'
