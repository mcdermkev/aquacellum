\set ON_ERROR_STOP on
\echo 'Running showcase-media post-migration catalog probe'

BEGIN TRANSACTION READ ONLY;

DO $catalog_probe$
DECLARE
  expected_service_rpcs text[] := ARRAY[
    'showcase_authorize_media_read(uuid,text)',
    'showcase_bind_owner_legacy_qr(uuid,uuid,text)',
    'showcase_cancel_room_hero_stage(uuid,uuid,uuid)',
    'showcase_claim_media_job(uuid,integer)',
    'showcase_complete_media_deletion(uuid,uuid)',
    'showcase_complete_media_processing(uuid,uuid,text,integer,integer,bigint,text,boolean,jsonb)',
    'showcase_consume_wallet_link_nonce(uuid,uuid,bytea,bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
    'showcase_create_owner_room(uuid,text,text,text,jsonb)',
    'showcase_enroll_dataset(uuid,uuid,integer,bytea)',
    'showcase_fail_media_job(uuid,uuid,text,boolean)',
    'showcase_finalize_dataset_import(uuid,uuid,bigint,jsonb,bytea)',
    'showcase_finalize_room_hero_upload(uuid,uuid,uuid,bigint)',
    'showcase_issue_wallet_link_nonce(uuid,bigint,text,text,text,text,bytea)',
    'showcase_link_owner_wallet(uuid,bigint,text,text,text,text)',
    'showcase_owner_identity_conflict_candidates(uuid,uuid,uuid,integer)',
    'showcase_owner_identity_state(uuid,uuid,integer,uuid,integer)',
    'showcase_owner_media_status(uuid,uuid)',
    'showcase_owner_media_upload_binding(uuid,uuid,uuid)',
    'showcase_owner_publication_preview(uuid,uuid)',
    'showcase_owner_room(uuid,uuid,integer,uuid,integer,text,uuid,integer)',
    'showcase_public_room(text,text)',
    'showcase_publish_room_hero(uuid,uuid,uuid,text,double precision,double precision)',
    'showcase_put_room_tank(uuid,uuid,uuid,bigint,jsonb)',
    'showcase_put_specimen_settings(uuid,uuid,bigint,jsonb)',
    'showcase_remove_room_tank(uuid,uuid,uuid,bigint)',
    'showcase_reset_owner_room(uuid,uuid,bigint)',
    'showcase_resolve_identity_conflict(uuid,uuid,uuid,text)',
    'showcase_resolve_owner_legacy_qr(uuid,text)',
    'showcase_resolve_owner_principal(text)',
    'showcase_revoke_media_asset(uuid,uuid,bigint)',
    'showcase_set_owner_room_visibility(uuid,uuid,bigint,text)',
    'showcase_stage_dataset_import_chunk(uuid,uuid,text,integer,integer,bytea,jsonb)',
    'showcase_stage_identity_candidates(uuid,uuid,bytea,uuid,jsonb)',
    'showcase_stage_room_hero(uuid,uuid,text)',
    'showcase_start_dataset_import(uuid,uuid,bytea,uuid,text,integer,bytea,bytea)',
    'showcase_sweep_media_maintenance(integer)',
    'showcase_transfer_specimen(uuid)',
    'showcase_update_owner_room(uuid,uuid,bigint,text,text,text,jsonb)'
  ];
  actual_service_rpcs text[];
  relation_count integer;
BEGIN
  SELECT count(*) INTO relation_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
    AND c.relkind = 'r';
  IF relation_count <> 32 THEN
    RAISE EXCEPTION 'Expected 32 showcase base tables, found %', relation_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
      AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'A showcase base table lacks ENABLE/FORCE RLS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'showcase\_%' ESCAPE '\'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'A browser/service role retains a showcase base-table grant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'showcase\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'A browser-facing showcase base-table policy exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
      AND c.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'An alternate showcase view surface exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
      AND (pg_get_userbyid(p.proowner) <> 'postgres'
        OR NOT p.proconfig @> ARRAY['search_path=public, pg_temp']::text[])
  ) THEN
    RAISE EXCEPTION 'A showcase function lacks postgres ownership or pinned search_path';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'A browser role can execute a showcase function';
  END IF;

  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
    INTO actual_service_rpcs
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
    AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  SELECT array_agg(value ORDER BY value) INTO expected_service_rpcs
  FROM unnest(expected_service_rpcs) AS value;
  IF actual_service_rpcs IS DISTINCT FROM expected_service_rpcs THEN
    RAISE EXCEPTION 'Service RPC allowlist mismatch. expected=%, actual=%',
      expected_service_rpcs, actual_service_rpcs;
  END IF;

  IF (SELECT count(*) FROM storage.buckets
      WHERE id IN ('showcase-media-source-v1', 'showcase-media-derivatives-v1')) <> 2
     OR EXISTS (
       SELECT 1 FROM storage.buckets
       WHERE id = 'showcase-media-source-v1'
         AND (public OR file_size_limit <> 8388608
           OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/png','image/webp']::text[])
     )
     OR EXISTS (
       SELECT 1 FROM storage.buckets
       WHERE id = 'showcase-media-derivatives-v1'
         AND (public OR file_size_limit <> 4194304
           OR allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[])
     ) THEN
    RAISE EXCEPTION 'Private showcase-media bucket configuration mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (COALESCE(qual, '') ILIKE '%showcase-media-%'
        OR COALESCE(with_check, '') ILIKE '%showcase-media-%')
  ) THEN
    RAISE EXCEPTION 'A storage.objects policy references a showcase-media bucket';
  END IF;

  RAISE NOTICE 'Catalog probe passed: % forced-RLS tables, % exact service RPCs, 2 private buckets',
    relation_count, cardinality(actual_service_rpcs);
END;
$catalog_probe$;

SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('showcase-media-source-v1', 'showcase-media-derivatives-v1')
ORDER BY id;

ROLLBACK;

SET ROLE service_role;
SELECT public.showcase_public_room('catalog-probe-missing-room', NULL) IS NULL
  AS service_projection_execute_allowed;
SELECT public.showcase_authorize_media_read(
  '00000000-0000-4000-8000-000000000001'::uuid, 'hero'
) IS NULL AS service_media_authorization_execute_allowed;
RESET ROLE;

\echo 'Showcase-media post-migration catalog probe complete'
