\set ON_ERROR_STOP on
\echo 'Running showcase-media deterministic two-session concurrency proofs'

CREATE SCHEMA validation;
CREATE TABLE validation.config (
  key text PRIMARY KEY,
  uuid_value uuid,
  json_value jsonb
);
CREATE TABLE validation.outcomes (
  test_name text NOT NULL,
  actor text NOT NULL,
  status text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION validation.valid_versions(p_claim jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object(
      'versionId', p_claim #>> '{versions,0,versionId}',
      'variant', 'hero',
      'objectKey', p_claim #>> '{versions,0,objectKey}',
      'mime', 'image/webp', 'width', 1200, 'height', 800, 'byteSize', 200000,
      'checksumHex', repeat('a7', 32)
    ),
    jsonb_build_object(
      'versionId', p_claim #>> '{versions,1,versionId}',
      'variant', 'thumb',
      'objectKey', p_claim #>> '{versions,1,objectKey}',
      'mime', 'image/webp', 'width', 400, 'height', 267, 'byteSize', 40000,
      'checksumHex', repeat('b8', 32)
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. Two workers contend for one queued row. Worker 1 holds the job-row lock
--    behind a deterministic advisory latch; worker 2 must SKIP LOCKED and get NULL.
-- ---------------------------------------------------------------------------
DO $setup_claim$
DECLARE
  owner_id uuid;
  room_id constant uuid := 'a1000000-0000-4000-8000-000000000001';
  stage jsonb;
BEGIN
  owner_id := public.showcase_resolve_owner_principal('did:privy:media-concurrency-claim');
  INSERT INTO public.showcase_rooms (id, owner_id, slug, title)
  VALUES (room_id, owner_id, 'media-concurrency-claim', 'Media Concurrency Claim');
  stage := public.showcase_stage_room_hero(owner_id, room_id, 'jpg');
  PERFORM public.showcase_finalize_room_hero_upload(
    owner_id, (stage->>'assetId')::uuid, (stage->>'uploadIntentId')::uuid, 100000
  );
  INSERT INTO validation.config(key, uuid_value) VALUES
    ('claim_owner', owner_id), ('claim_asset', (stage->>'assetId')::uuid);
END;
$setup_claim$;

SELECT pg_advisory_lock(810001);
SELECT dblink_connect('claim_worker_1', 'dbname=showcase_media_validation user=postgres');
SELECT dblink_send_query('claim_worker_1', $remote$
  DO $worker$
  DECLARE claimed jsonb;
  BEGIN
    PERFORM pg_advisory_xact_lock(810002);
    claimed := public.showcase_claim_media_job(
      'a2000000-0000-4000-8000-000000000001'::uuid, 300
    );
    INSERT INTO validation.outcomes(test_name, actor, status, detail)
    VALUES ('claim_exclusivity', 'worker_1',
      CASE WHEN claimed IS NULL THEN 'null' ELSE 'claimed' END, claimed::text);
    PERFORM pg_advisory_lock(810001);
  END;
  $worker$;
$remote$);

DO $wait_claim_marker$
DECLARE held boolean := false;
BEGIN
  FOR attempt IN 1..200 LOOP
    IF pg_try_advisory_lock(810002) THEN
      PERFORM pg_advisory_unlock(810002);
      PERFORM pg_sleep(0.01);
    ELSE
      held := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT held THEN RAISE EXCEPTION 'Worker 1 never reached the claim latch'; END IF;
END;
$wait_claim_marker$;

SELECT dblink_connect('claim_worker_2', 'dbname=showcase_media_validation user=postgres');
DO $worker_2_claim$
DECLARE claimed_text text;
BEGIN
  SELECT result INTO claimed_text
  FROM dblink('claim_worker_2',
    $$SELECT public.showcase_claim_media_job(
      'a2000000-0000-4000-8000-000000000002'::uuid, 300
    )::text$$
  ) AS claimed(result text);
  IF claimed_text IS NOT NULL THEN
    RAISE EXCEPTION 'Worker 2 claimed a row locked by worker 1: %', claimed_text;
  END IF;
  INSERT INTO validation.outcomes(test_name, actor, status)
  VALUES ('claim_exclusivity', 'worker_2', 'null');
END;
$worker_2_claim$;
SELECT dblink_disconnect('claim_worker_2');
SELECT pg_advisory_unlock(810001);
SELECT * FROM dblink_get_result('claim_worker_1') AS completed(status text);
SELECT dblink_disconnect('claim_worker_1');

DO $assert_claim$
DECLARE target_asset_id uuid;
BEGIN
  SELECT uuid_value INTO target_asset_id FROM validation.config WHERE key = 'claim_asset';
  IF (SELECT count(*) FROM validation.outcomes
      WHERE test_name = 'claim_exclusivity' AND status = 'claimed') <> 1
     OR (SELECT count(*) FROM validation.outcomes
         WHERE test_name = 'claim_exclusivity' AND status = 'null') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.showcase_media_jobs
       WHERE showcase_media_jobs.asset_id = target_asset_id
         AND state = 'leased' AND attempts = 1
         AND worker_id = 'a2000000-0000-4000-8000-000000000001'::uuid
     ) THEN
    RAISE EXCEPTION 'SKIP LOCKED claim exclusivity proof failed';
  END IF;
  -- Close fixture work so no queue row interferes with later proofs.
  PERFORM public.showcase_fail_media_job(
    (SELECT id FROM public.showcase_media_jobs
     WHERE showcase_media_jobs.asset_id = target_asset_id AND job_kind = 'process_source'),
    'a2000000-0000-4000-8000-000000000001'::uuid,
    'VALIDATION_COMPLETE', true
  );
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', completed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE showcase_media_jobs.asset_id = target_asset_id AND state = 'queued';
END;
$assert_claim$;

-- ---------------------------------------------------------------------------
-- 2. Quota contention at 1008 MiB. The first stage pauses after taking the
--    owner lock; the concurrent attempt must fail fast with SQLSTATE 40001.
--    Retrying after the winner commits must observe the 1 GiB total and fail
--    with SQLSTATE 54000. Exactly one target may be issued.
-- ---------------------------------------------------------------------------
DO $setup_quota$
DECLARE
  owner_id uuid;
  room_id constant uuid := 'a3000000-0000-4000-8000-000000000001';
  generated_asset uuid;
BEGIN
  owner_id := public.showcase_resolve_owner_principal('did:privy:media-concurrency-quota');
  INSERT INTO public.showcase_rooms (id, owner_id, slug, title)
  VALUES (room_id, owner_id, 'media-concurrency-quota', 'Media Concurrency Quota');
  INSERT INTO validation.config(key, uuid_value) VALUES
    ('quota_owner', owner_id), ('quota_room', room_id);
  FOR reservation_no IN 1..63 LOOP
    generated_asset := gen_random_uuid();
    INSERT INTO public.showcase_media_assets(id, owner_id, purpose, state, source_object_key)
    VALUES (generated_asset, owner_id, 'room_hero', 'rejected',
      'owners/' || owner_id::text || '/assets/' || generated_asset::text || '/source.jpg');
    INSERT INTO public.showcase_media_quota_reservations(asset_id, owner_id)
    VALUES (generated_asset, owner_id);
  END LOOP;
END;
$setup_quota$;

CREATE FUNCTION validation.pause_first_quota_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_id = (SELECT uuid_value FROM validation.config WHERE key = 'quota_owner')
     AND NEW.purpose = 'room_hero' THEN
    PERFORM pg_advisory_xact_lock(820002);
    PERFORM pg_advisory_lock(820001);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validation_pause_first_quota_stage
BEFORE INSERT ON public.showcase_media_assets
FOR EACH ROW EXECUTE FUNCTION validation.pause_first_quota_stage();

SELECT pg_advisory_lock(820001);
SELECT dblink_connect('quota_stage_1', 'dbname=showcase_media_validation user=postgres');
SELECT dblink_connect('quota_stage_2', 'dbname=showcase_media_validation user=postgres');
SELECT dblink_send_query('quota_stage_1', $remote$
  DO $stage$
  DECLARE owner_id uuid; room_id uuid; staged jsonb;
  BEGIN
    SELECT uuid_value INTO owner_id FROM validation.config WHERE key = 'quota_owner';
    SELECT uuid_value INTO room_id FROM validation.config WHERE key = 'quota_room';
    BEGIN
      staged := public.showcase_stage_room_hero(owner_id, room_id, 'jpg');
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('quota_serialization', 'stage_1', 'success', staged::text);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('quota_serialization', 'stage_1', SQLSTATE, SQLERRM);
    END;
  END;
  $stage$;
$remote$);

DO $wait_quota_marker$
DECLARE held boolean := false;
BEGIN
  FOR attempt IN 1..200 LOOP
    IF pg_try_advisory_lock(820002) THEN
      PERFORM pg_advisory_unlock(820002);
      PERFORM pg_sleep(0.01);
    ELSE
      held := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT held THEN RAISE EXCEPTION 'First quota stage never reached the latch'; END IF;
END;
$wait_quota_marker$;

SELECT dblink_send_query('quota_stage_2', $remote$
  DO $stage$
  DECLARE owner_id uuid; room_id uuid; staged jsonb;
  BEGIN
    SELECT uuid_value INTO owner_id FROM validation.config WHERE key = 'quota_owner';
    SELECT uuid_value INTO room_id FROM validation.config WHERE key = 'quota_room';
    BEGIN
      staged := public.showcase_stage_room_hero(owner_id, room_id, 'jpg');
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('quota_serialization', 'stage_2', 'success', staged::text);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('quota_serialization', 'stage_2', SQLSTATE, SQLERRM);
    END;
  END;
  $stage$;
$remote$);
SELECT pg_advisory_unlock(820001);
SELECT * FROM dblink_get_result('quota_stage_1') AS completed(status text);
SELECT dblink_disconnect('quota_stage_1');
SELECT * FROM dblink_get_result('quota_stage_2') AS completed(status text);
SELECT dblink_disconnect('quota_stage_2');
DROP TRIGGER validation_pause_first_quota_stage ON public.showcase_media_assets;
DROP FUNCTION validation.pause_first_quota_stage();

DO $quota_retry$
DECLARE owner_id uuid; room_id uuid; staged jsonb;
BEGIN
  SELECT uuid_value INTO owner_id FROM validation.config WHERE key = 'quota_owner';
  SELECT uuid_value INTO room_id FROM validation.config WHERE key = 'quota_room';
  BEGIN
    staged := public.showcase_stage_room_hero(owner_id, room_id, 'jpg');
    INSERT INTO validation.outcomes(test_name, actor, status, detail)
    VALUES ('quota_serialization', 'stage_2_retry', 'success', staged::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO validation.outcomes(test_name, actor, status, detail)
    VALUES ('quota_serialization', 'stage_2_retry', SQLSTATE, SQLERRM);
  END;
END;
$quota_retry$;

DO $assert_quota$
DECLARE target_owner_id uuid;
BEGIN
  SELECT uuid_value INTO target_owner_id FROM validation.config WHERE key = 'quota_owner';
  IF (SELECT count(*) FROM validation.outcomes
      WHERE test_name = 'quota_serialization' AND status = 'success') <> 1
     OR (SELECT count(*) FROM validation.outcomes
         WHERE test_name = 'quota_serialization' AND status = '40001') <> 1
     OR (SELECT count(*) FROM validation.outcomes
         WHERE test_name = 'quota_serialization' AND status = '54000') <> 1
     OR (SELECT count(*) FROM public.showcase_media_quota_reservations
         WHERE showcase_media_quota_reservations.owner_id = target_owner_id
           AND released_at IS NULL) <> 64
     OR (SELECT sum(accounted_bytes) FROM public.showcase_media_quota_reservations
         WHERE showcase_media_quota_reservations.owner_id = target_owner_id
           AND released_at IS NULL) <> 1073741824 THEN
    RAISE EXCEPTION 'Concurrent quota serialization proof failed: %',
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY actor)
       FROM validation.outcomes o WHERE test_name = 'quota_serialization');
  END IF;
END;
$assert_quota$;

-- ---------------------------------------------------------------------------
-- 3. Revoke vs leased processor. Revoke pauses after taking the owner lock;
--    processing holds the process-job row, fails fast on the contended owner lock,
--    then retries after the latch is released. The retry must converge without
--    deadlock: denied asset, successful process ledger, reopened accounting, and
--    fresh derivative deletion work.
-- ---------------------------------------------------------------------------
DO $setup_reconcile$
DECLARE
  owner_id uuid;
  room_id constant uuid := 'a4000000-0000-4000-8000-000000000001';
  stage jsonb;
  claim jsonb;
BEGIN
  owner_id := public.showcase_resolve_owner_principal('did:privy:media-concurrency-reconcile');
  INSERT INTO public.showcase_rooms (id, owner_id, slug, title)
  VALUES (room_id, owner_id, 'media-concurrency-reconcile', 'Media Concurrency Reconcile');
  stage := public.showcase_stage_room_hero(owner_id, room_id, 'jpg');
  PERFORM public.showcase_finalize_room_hero_upload(
    owner_id, (stage->>'assetId')::uuid, (stage->>'uploadIntentId')::uuid, 100000
  );
  claim := public.showcase_claim_media_job(
    'a5000000-0000-4000-8000-000000000001'::uuid, 300
  );
  INSERT INTO validation.config(key, uuid_value, json_value) VALUES
    ('reconcile_owner', owner_id, NULL),
    ('reconcile_asset', (stage->>'assetId')::uuid, NULL),
    ('reconcile_job', (claim->>'jobId')::uuid, claim);
END;
$setup_reconcile$;

CREATE FUNCTION validation.pause_target_revoke()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = (SELECT uuid_value FROM validation.config WHERE key = 'reconcile_asset')
     AND OLD.state = 'processing' AND NEW.state = 'revoked' THEN
    PERFORM pg_advisory_xact_lock(830002);
    PERFORM pg_advisory_lock(830001);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validation_pause_target_revoke
BEFORE UPDATE ON public.showcase_media_assets
FOR EACH ROW EXECUTE FUNCTION validation.pause_target_revoke();

SELECT pg_advisory_lock(830001);
SELECT dblink_connect('revoke_session', 'dbname=showcase_media_validation user=postgres');
SELECT dblink_connect('processor_session', 'dbname=showcase_media_validation user=postgres');
SELECT dblink_send_query('revoke_session', $remote$
  DO $revoke$
  DECLARE owner_id uuid; asset_id uuid; asset_revision bigint; response jsonb;
  BEGIN
    SELECT uuid_value INTO owner_id FROM validation.config WHERE key = 'reconcile_owner';
    SELECT uuid_value INTO asset_id FROM validation.config WHERE key = 'reconcile_asset';
    SELECT revision INTO asset_revision FROM public.showcase_media_assets WHERE id = asset_id;
    response := public.showcase_revoke_media_asset(owner_id, asset_id, asset_revision);
    INSERT INTO validation.outcomes(test_name, actor, status, detail)
    VALUES ('revoke_processor', 'revoke', 'success', response::text);
  END;
  $revoke$;
$remote$);

DO $wait_revoke_marker$
DECLARE held boolean := false;
BEGIN
  FOR attempt IN 1..200 LOOP
    IF pg_try_advisory_lock(830002) THEN
      PERFORM pg_advisory_unlock(830002);
      PERFORM pg_sleep(0.01);
    ELSE
      held := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT held THEN RAISE EXCEPTION 'Revoke session never reached the latch'; END IF;
END;
$wait_revoke_marker$;

SELECT dblink_send_query('processor_session', $remote$
  DO $processor$
  DECLARE job_id uuid; claim jsonb; response jsonb;
  BEGIN
    SELECT uuid_value, json_value INTO job_id, claim
    FROM validation.config WHERE key = 'reconcile_job';
    BEGIN
      response := public.showcase_complete_media_processing(
        job_id, 'a5000000-0000-4000-8000-000000000001'::uuid,
        'image/jpeg', 1200, 800, 100000, repeat('c9', 32), true,
        validation.valid_versions(claim)
      );
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('revoke_processor', 'processor_initial', 'unexpected_success', response::text);
    EXCEPTION WHEN serialization_failure THEN
      IF SQLERRM <> 'SHOWCASE_PUBLICATION_RETRY_REQUIRED' THEN RAISE; END IF;
      INSERT INTO validation.outcomes(test_name, actor, status, detail)
      VALUES ('revoke_processor', 'processor_initial', 'retry', SQLERRM);
    END;
  END;
  $processor$;
$remote$);
SELECT pg_advisory_unlock(830001);
SELECT * FROM dblink_get_result('revoke_session') AS completed(status text);
SELECT dblink_disconnect('revoke_session');
SELECT * FROM dblink_get_result('processor_session') AS completed(status text);
SELECT dblink_disconnect('processor_session');

DO $retry_processor$
DECLARE job_id uuid; claim jsonb; response jsonb;
BEGIN
  SELECT uuid_value, json_value INTO job_id, claim
  FROM validation.config WHERE key = 'reconcile_job';
  response := public.showcase_complete_media_processing(
    job_id, 'a5000000-0000-4000-8000-000000000001'::uuid,
    'image/jpeg', 1200, 800, 100000, repeat('c9', 32), true,
    validation.valid_versions(claim)
  );
  INSERT INTO validation.outcomes(test_name, actor, status, detail)
  VALUES ('revoke_processor', 'processor_retry', 'success', response::text);
END;
$retry_processor$;
DROP TRIGGER validation_pause_target_revoke ON public.showcase_media_assets;
DROP FUNCTION validation.pause_target_revoke();

DO $assert_reconcile$
DECLARE target_asset_id uuid;
BEGIN
  SELECT uuid_value INTO target_asset_id FROM validation.config WHERE key = 'reconcile_asset';
  IF (SELECT count(*) FROM validation.outcomes
      WHERE test_name = 'revoke_processor' AND status = 'success') <> 2
     OR (SELECT count(*) FROM validation.outcomes
         WHERE test_name = 'revoke_processor' AND actor = 'processor_initial'
           AND status = 'retry' AND detail = 'SHOWCASE_PUBLICATION_RETRY_REQUIRED') <> 1
     OR EXISTS (
       SELECT 1 FROM validation.outcomes
       WHERE test_name = 'revoke_processor' AND status = 'unexpected_success'
     )
     OR (SELECT state FROM public.showcase_media_assets WHERE id = target_asset_id) <> 'revoked'
     OR (SELECT count(*) FROM public.showcase_media_asset_versions
         WHERE showcase_media_asset_versions.asset_id = target_asset_id) <> 2
     OR (SELECT accounted_bytes FROM public.showcase_media_quota_reservations
         WHERE showcase_media_quota_reservations.asset_id = target_asset_id) <> 340000
     OR (SELECT derivatives_deleted_at FROM public.showcase_media_quota_reservations
         WHERE showcase_media_quota_reservations.asset_id = target_asset_id) IS NOT NULL
     OR (SELECT state FROM public.showcase_media_jobs
         WHERE showcase_media_jobs.asset_id = target_asset_id
           AND job_kind = 'process_source') <> 'succeeded'
     OR (SELECT state FROM public.showcase_media_jobs
         WHERE showcase_media_jobs.asset_id = target_asset_id
           AND job_kind = 'delete_derivatives') <> 'queued' THEN
    RAISE EXCEPTION 'Concurrent revoke/processor reconciliation proof failed: %',
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY actor)
       FROM validation.outcomes o WHERE test_name = 'revoke_processor');
  END IF;
END;
$assert_reconcile$;

TABLE validation.outcomes;

DROP SCHEMA validation CASCADE;

\echo 'Showcase-media deterministic two-session concurrency proofs complete'
