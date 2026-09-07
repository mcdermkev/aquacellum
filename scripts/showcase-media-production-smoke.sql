BEGIN;

DO $production_smoke$
<<production_smoke>>
DECLARE
  owner_a uuid;
  owner_b uuid;
  room_id uuid := gen_random_uuid();
  stage jsonb;
  claim jsonb;
  asset_id uuid;
  intent_id uuid;
  worker_id uuid := gen_random_uuid();
  blocked boolean := false;
BEGIN
  owner_a := public.showcase_resolve_owner_principal(
    'did:privy:production-smoke-' || gen_random_uuid()::text
  );
  owner_b := public.showcase_resolve_owner_principal(
    'did:privy:production-smoke-' || gen_random_uuid()::text
  );
  INSERT INTO public.showcase_rooms(id, owner_id, slug, title)
  VALUES (room_id, owner_a, 'production-smoke-' || replace(room_id::text, '-', ''),
    'Production rollback smoke');

  stage := public.showcase_stage_room_hero(owner_a, room_id, 'jpg');
  asset_id := (stage->>'assetId')::uuid;
  intent_id := (stage->>'uploadIntentId')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_media_upload_intents i
    WHERE i.id = intent_id AND i.owner_id = owner_a AND i.asset_id = production_smoke.asset_id
      AND i.state = 'staging' AND i.expires_at - i.created_at = interval '5 minutes'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.showcase_media_quota_reservations q
    WHERE q.asset_id = production_smoke.asset_id AND q.owner_id = owner_a
      AND q.accounted_bytes = 16777216 AND q.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PRODUCTION_SMOKE_STAGE_FAILED';
  END IF;

  IF public.showcase_owner_media_upload_binding(owner_b, asset_id, intent_id) IS NOT NULL THEN
    RAISE EXCEPTION 'PRODUCTION_SMOKE_OWNER_ISOLATION_FAILED';
  END IF;

  BEGIN
    PERFORM public.showcase_finalize_room_hero_upload(owner_b, asset_id, intent_id, 100000);
  EXCEPTION WHEN no_data_found THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'PRODUCTION_SMOKE_CROSS_OWNER_FINALIZE_FAILED';
  END IF;

  PERFORM public.showcase_finalize_room_hero_upload(owner_a, asset_id, intent_id, 100000);
  claim := public.showcase_claim_media_job(worker_id, 300);
  IF claim IS NULL OR claim->>'assetId' <> asset_id::text
     OR claim->>'kind' <> 'process_source' OR claim->>'attempt' <> '1'
     OR jsonb_array_length(claim->'versions') <> 2 THEN
    RAISE EXCEPTION 'PRODUCTION_SMOKE_DURABLE_LEASE_FAILED';
  END IF;

  PERFORM public.showcase_fail_media_job(
    (claim->>'jobId')::uuid, worker_id, 'PRODUCTION_SMOKE_REJECT', true
  );
  IF (SELECT a.state FROM public.showcase_media_assets a WHERE a.id = asset_id) <> 'rejected'
     OR (SELECT count(*) FROM public.showcase_media_jobs j
         WHERE j.asset_id = production_smoke.asset_id
           AND j.job_kind IN ('delete_source', 'delete_derivatives')) <> 2 THEN
    RAISE EXCEPTION 'PRODUCTION_SMOKE_TERMINAL_CLEANUP_FAILED';
  END IF;
END;
$production_smoke$;

ROLLBACK;
