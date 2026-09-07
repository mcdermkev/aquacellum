-- Fish Room R1 media pipeline: private Room-hero upload, durable processing queue,
-- publication-aware byte authorization, retention ledger, and closed Storage boundary.
-- Tier A: owner identity, media privacy, publication, and revocation critical.

BEGIN;

-- These buckets are intentionally private. No storage.objects policy is created for either bucket;
-- browser/anon/authenticated roles therefore have no direct read/list/write/delete path. Uploads use
-- a five-minute exact-object S3 presign produced by the trusted owner API, and all other operations
-- use the service role after an RPC authorization decision.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('showcase-media-source-v1', 'showcase-media-source-v1', false, 8388608,
    ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('showcase-media-derivatives-v1', 'showcase-media-derivatives-v1', false, 4194304,
    ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.showcase_media_quota_reservations (
  asset_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  accounted_bytes bigint NOT NULL DEFAULT 16777216,
  source_deleted_at timestamptz,
  derivatives_deleted_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_media_quota_asset_owner_fkey
    FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_media_assets(id, owner_id),
  CONSTRAINT showcase_media_quota_bytes_bounded
    CHECK (accounted_bytes BETWEEN 0 AND 16777216),
  CONSTRAINT showcase_media_quota_release_coherent
    CHECK ((released_at IS NULL) OR (accounted_bytes = 0 AND source_deleted_at IS NOT NULL))
);
CREATE INDEX showcase_media_quota_owner_active_idx
  ON public.showcase_media_quota_reservations(owner_id, asset_id)
  WHERE released_at IS NULL;

CREATE TABLE public.showcase_media_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  room_id uuid NOT NULL,
  source_object_key text NOT NULL UNIQUE,
  intended_mime text NOT NULL,
  state text NOT NULL DEFAULT 'staging',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT showcase_media_upload_intent_asset_owner_fkey
    FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_media_assets(id, owner_id),
  CONSTRAINT showcase_media_upload_intent_room_owner_fkey
    FOREIGN KEY (room_id, owner_id)
    REFERENCES public.showcase_rooms(id, owner_id),
  CONSTRAINT showcase_media_upload_intent_mime_closed
    CHECK (intended_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT showcase_media_upload_intent_state_closed
    CHECK (state IN ('staging', 'finalized', 'expired', 'cancelled')),
  CONSTRAINT showcase_media_upload_intent_ttl_bounded
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT showcase_media_upload_intent_state_coherent CHECK (
    (state = 'staging' AND finalized_at IS NULL AND cancelled_at IS NULL)
    OR (state = 'finalized' AND finalized_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state IN ('expired', 'cancelled') AND finalized_at IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX showcase_media_upload_intents_expiry_idx
  ON public.showcase_media_upload_intents(state, expires_at);

CREATE TABLE public.showcase_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  job_kind text NOT NULL,
  hero_version_id uuid,
  thumb_version_id uuid,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  leased_until timestamptz,
  worker_id uuid,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_media_jobs_asset_owner_fkey
    FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_media_assets(id, owner_id),
  CONSTRAINT showcase_media_jobs_asset_kind_key UNIQUE (asset_id, job_kind),
  CONSTRAINT showcase_media_jobs_kind_closed
    CHECK (job_kind IN ('process_source', 'delete_source', 'delete_derivatives')),
  CONSTRAINT showcase_media_jobs_planned_versions_coherent CHECK (
    (job_kind = 'process_source' AND hero_version_id IS NOT NULL AND thumb_version_id IS NOT NULL
      AND hero_version_id <> thumb_version_id)
    OR (job_kind <> 'process_source' AND hero_version_id IS NULL AND thumb_version_id IS NULL)
  ),
  CONSTRAINT showcase_media_jobs_state_closed
    CHECK (state IN ('queued', 'leased', 'succeeded', 'dead')),
  CONSTRAINT showcase_media_jobs_attempts_bounded CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT showcase_media_jobs_error_code_closed
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT showcase_media_jobs_lease_coherent CHECK (
    (state = 'queued' AND leased_at IS NULL AND leased_until IS NULL AND worker_id IS NULL AND completed_at IS NULL)
    OR (state = 'leased' AND leased_at IS NOT NULL AND leased_until > leased_at
      AND worker_id IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('succeeded', 'dead') AND leased_at IS NULL AND leased_until IS NULL
      AND worker_id IS NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX showcase_media_jobs_claim_idx
  ON public.showcase_media_jobs(state, available_at, created_at)
  WHERE state = 'queued';
CREATE INDEX showcase_media_jobs_alert_idx
  ON public.showcase_media_jobs(state, created_at)
  WHERE state IN ('queued', 'leased', 'dead');

CREATE FUNCTION public.showcase_validate_media_upload_intent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE asset_row public.showcase_media_assets%ROWTYPE;
BEGIN
  SELECT * INTO STRICT asset_row
  FROM public.showcase_media_assets
  WHERE id = NEW.asset_id AND owner_id = NEW.owner_id
  FOR KEY SHARE;
  IF asset_row.purpose <> 'room_hero'
     OR asset_row.source_object_key <> NEW.source_object_key THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_UPLOAD_BINDING_INVALID' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.asset_id <> OLD.asset_id
    OR NEW.room_id <> OLD.room_id OR NEW.source_object_key <> OLD.source_object_key
    OR NEW.intended_mime <> OLD.intended_mime OR NEW.created_at <> OLD.created_at
    OR NEW.expires_at <> OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_UPLOAD_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_media_upload_intents_validate
  BEFORE INSERT OR UPDATE ON public.showcase_media_upload_intents
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_media_upload_intent();

CREATE FUNCTION public.showcase_enqueue_media_job(
  p_owner_id uuid, p_asset_id uuid, p_job_kind text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_job_kind NOT IN ('process_source', 'delete_source', 'delete_derivatives') THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_JOB_KIND_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.showcase_media_jobs (
    owner_id, asset_id, job_kind, hero_version_id, thumb_version_id
  ) VALUES (
    p_owner_id, p_asset_id, p_job_kind,
    CASE WHEN p_job_kind = 'process_source' THEN gen_random_uuid() ELSE NULL END,
    CASE WHEN p_job_kind = 'process_source' THEN gen_random_uuid() ELSE NULL END
  )
  ON CONFLICT (asset_id, job_kind) DO NOTHING;
END;
$$;

-- Any transition that archives/revokes an active attachment (Room reset, transfer, replacement,
-- explicit revoke) must also deny the asset and durably enter object cleanup. This closes retention
-- paths in older owner RPCs without duplicating their full transaction bodies.
CREATE FUNCTION public.showcase_cleanup_terminal_media_attachment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.state IN ('private','published') AND NEW.state IN ('revoked','archived') THEN
    UPDATE public.showcase_media_assets
      SET state = 'revoked', revision = revision + 1
      WHERE id = NEW.asset_id AND owner_id = NEW.owner_id AND state IN ('approved','published');
    PERFORM public.showcase_enqueue_media_job(NEW.owner_id, NEW.asset_id, 'delete_source');
    IF EXISTS (SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = NEW.asset_id)
       OR EXISTS (SELECT 1 FROM public.showcase_media_jobs
         WHERE asset_id = NEW.asset_id AND job_kind = 'process_source') THEN
      PERFORM public.showcase_enqueue_media_job(NEW.owner_id, NEW.asset_id, 'delete_derivatives');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_media_attachments_cleanup_terminal
  AFTER UPDATE OF state ON public.showcase_media_attachments
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION public.showcase_cleanup_terminal_media_attachment();

-- Atomically reserve the full worst-case retained footprint before any upload target is issued.
CREATE FUNCTION public.showcase_stage_room_hero(
  p_owner_id uuid, p_room_id uuid, p_extension text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  asset_uuid uuid := gen_random_uuid();
  intent_uuid uuid := gen_random_uuid();
  source_key text;
  source_mime text;
  staged_at timestamptz := clock_timestamp();
  expires timestamptz := staged_at + interval '5 minutes';
  active_count integer;
  retained_total bigint;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL
     OR p_extension NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_STAGE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  PERFORM 1 FROM public.showcase_rooms
    WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*), COALESCE(sum(accounted_bytes), 0)
    INTO active_count, retained_total
  FROM public.showcase_media_quota_reservations
  WHERE owner_id = p_owner_id AND released_at IS NULL;
  IF active_count >= 250 OR retained_total + 16777216 > 1073741824 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_QUOTA_EXCEEDED' USING ERRCODE = '54000';
  END IF;

  source_key := 'owners/' || p_owner_id::text || '/assets/' || asset_uuid::text || '/source.' || p_extension;
  source_mime := CASE p_extension WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp' ELSE 'image/jpeg' END;

  INSERT INTO public.showcase_media_assets (id, owner_id, purpose, source_object_key)
  VALUES (asset_uuid, p_owner_id, 'room_hero', source_key);
  INSERT INTO public.showcase_media_quota_reservations (asset_id, owner_id)
  VALUES (asset_uuid, p_owner_id);
  INSERT INTO public.showcase_media_upload_intents (
    id, owner_id, asset_id, room_id, source_object_key, intended_mime, created_at, expires_at
  ) VALUES (
    intent_uuid, p_owner_id, asset_uuid, p_room_id, source_key, source_mime, staged_at, expires
  );

  RETURN jsonb_build_object(
    'assetId', asset_uuid, 'uploadIntentId', intent_uuid,
    'sourceObjectKey', source_key, 'contentType', source_mime,
    'expiresAt', to_char(expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

-- Used only when presigning fails before a target can be returned; no client can have uploaded.
CREATE FUNCTION public.showcase_cancel_room_hero_stage(
  p_owner_id uuid, p_asset_id uuid, p_upload_intent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE changed integer;
BEGIN
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  UPDATE public.showcase_media_upload_intents
    SET state = 'cancelled', cancelled_at = clock_timestamp()
    WHERE id = p_upload_intent_id AND owner_id = p_owner_id AND asset_id = p_asset_id
      AND state = 'staging';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.showcase_media_assets
    SET state = 'rejected', revision = revision + 1
    WHERE id = p_asset_id AND owner_id = p_owner_id AND state = 'staging';
  UPDATE public.showcase_media_quota_reservations
    SET accounted_bytes = 0, source_deleted_at = clock_timestamp(),
        derivatives_deleted_at = clock_timestamp(), released_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE asset_id = p_asset_id AND owner_id = p_owner_id AND released_at IS NULL;
  RETURN jsonb_build_object('assetId', p_asset_id, 'cancelled', true);
END;
$$;

-- Internal owner-bound lookup used immediately before HeadObject. The route never returns the key.
CREATE FUNCTION public.showcase_owner_media_upload_binding(
  p_owner_id uuid, p_asset_id uuid, p_upload_intent_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'sourceObjectKey', source_object_key,
    'contentType', intended_mime,
    'expiresAt', expires_at
  )
  FROM public.showcase_media_upload_intents
  WHERE id = p_upload_intent_id AND owner_id = p_owner_id AND asset_id = p_asset_id
    AND state = 'staging' AND expires_at > clock_timestamp();
$$;

-- HeadObject is performed by the owner API first. This transaction changes state and commits the
-- durable process job together; returning success can never mean "background promise started".
CREATE FUNCTION public.showcase_finalize_room_hero_upload(
  p_owner_id uuid, p_asset_id uuid, p_upload_intent_id uuid, p_source_byte_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE intent_row public.showcase_media_upload_intents%ROWTYPE;
BEGIN
  IF p_source_byte_size NOT BETWEEN 1 AND 8388608 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_SOURCE_SIZE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO intent_row
  FROM public.showcase_media_upload_intents
  WHERE id = p_upload_intent_id AND owner_id = p_owner_id AND asset_id = p_asset_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF intent_row.state <> 'staging' OR intent_row.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_UPLOAD_EXPIRED' USING ERRCODE = '55000';
  END IF;

  UPDATE public.showcase_media_upload_intents
    SET state = 'finalized', finalized_at = clock_timestamp()
    WHERE id = intent_row.id;
  UPDATE public.showcase_media_assets
    SET state = 'processing', byte_size = p_source_byte_size, revision = revision + 1
    WHERE id = p_asset_id AND owner_id = p_owner_id AND state = 'staging';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_STATE_CONFLICT' USING ERRCODE = '55000';
  END IF;
  PERFORM public.showcase_enqueue_media_job(p_owner_id, p_asset_id, 'process_source');
  RETURN jsonb_build_object('assetId', p_asset_id, 'state', 'processing', 'queued', true);
END;
$$;

CREATE FUNCTION public.showcase_owner_media_status(p_owner_id uuid, p_asset_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'assetId', a.id,
    'purpose', a.purpose,
    'state', a.state,
    'revision', a.revision,
    'metadataStripped', a.metadata_stripped,
    'alt', a.alt_text,
    'focalPoint', CASE WHEN a.focal_x IS NULL OR a.focal_y IS NULL THEN NULL
      ELSE jsonb_build_object('x', a.focal_x, 'y', a.focal_y) END,
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'variant', v.variant, 'mime', v.mime, 'width', v.width,
        'height', v.height, 'byteSize', v.byte_size
      ) ORDER BY v.variant)
      FROM public.showcase_media_asset_versions v
      WHERE v.asset_id = a.id AND v.owner_id = a.owner_id
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', j.job_kind, 'state', j.state, 'attempts', j.attempts,
        'availableAt', j.available_at, 'lastErrorCode', j.last_error_code
      ) ORDER BY j.created_at)
      FROM public.showcase_media_jobs j
      WHERE j.asset_id = a.id AND j.owner_id = a.owner_id
    ), '[]'::jsonb)
  )
  FROM public.showcase_media_assets a
  WHERE a.id = p_asset_id AND a.owner_id = p_owner_id;
$$;

-- Worker lease: the job row is the durable queue. Object keys are returned only to the service-role
-- worker, never to an owner/public response.
CREATE FUNCTION public.showcase_claim_media_job(p_worker_id uuid, p_lease_seconds integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE job_row public.showcase_media_jobs%ROWTYPE; asset_row public.showcase_media_assets%ROWTYPE;
  versions_json jsonb;
BEGIN
  IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_WORKER_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job_row
  FROM public.showcase_media_jobs
  WHERE state = 'queued' AND available_at <= clock_timestamp() AND attempts < 5
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.showcase_media_jobs
    SET state = 'leased', attempts = attempts + 1, leased_at = clock_timestamp(),
        leased_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        worker_id = p_worker_id, updated_at = clock_timestamp()
    WHERE id = job_row.id RETURNING * INTO job_row;
  SELECT * INTO STRICT asset_row FROM public.showcase_media_assets
    WHERE id = job_row.asset_id AND owner_id = job_row.owner_id;
  IF job_row.job_kind = 'process_source' THEN
    versions_json := jsonb_build_array(
      jsonb_build_object(
        'versionId', job_row.hero_version_id, 'variant', 'hero',
        'objectKey', 'owners/' || asset_row.owner_id::text || '/assets/' || asset_row.id::text
          || '/versions/' || job_row.hero_version_id::text || '/hero.webp'
      ),
      jsonb_build_object(
        'versionId', job_row.thumb_version_id, 'variant', 'thumb',
        'objectKey', 'owners/' || asset_row.owner_id::text || '/assets/' || asset_row.id::text
          || '/versions/' || job_row.thumb_version_id::text || '/thumb.webp'
      )
    );
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'versionId', id, 'variant', variant, 'objectKey', object_key,
      'mime', mime, 'byteSize', byte_size
    ) ORDER BY variant), '[]'::jsonb)
    INTO versions_json
    FROM public.showcase_media_asset_versions
    WHERE asset_id = asset_row.id AND owner_id = asset_row.owner_id;
    IF job_row.job_kind = 'delete_derivatives' AND jsonb_array_length(versions_json) = 0 THEN
      SELECT jsonb_build_array(
        jsonb_build_object(
          'versionId', p.hero_version_id, 'variant', 'hero',
          'objectKey', 'owners/' || asset_row.owner_id::text || '/assets/' || asset_row.id::text
            || '/versions/' || p.hero_version_id::text || '/hero.webp'
        ),
        jsonb_build_object(
          'versionId', p.thumb_version_id, 'variant', 'thumb',
          'objectKey', 'owners/' || asset_row.owner_id::text || '/assets/' || asset_row.id::text
            || '/versions/' || p.thumb_version_id::text || '/thumb.webp'
        )
      ) INTO versions_json
      FROM public.showcase_media_jobs p
      WHERE p.asset_id = asset_row.id AND p.job_kind = 'process_source';
      versions_json := COALESCE(versions_json, '[]'::jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'jobId', job_row.id, 'kind', job_row.job_kind, 'attempt', job_row.attempts,
    'assetId', asset_row.id, 'ownerId', asset_row.owner_id,
    'assetState', asset_row.state, 'sourceObjectKey', asset_row.source_object_key,
    'sourceByteSize', asset_row.byte_size, 'versions', versions_json,
    'leaseUntil', job_row.leased_until
  );
END;
$$;

CREATE FUNCTION public.showcase_complete_media_processing(
  p_job_id uuid, p_worker_id uuid,
  p_decoded_mime text, p_width integer, p_height integer,
  p_source_byte_size bigint, p_source_checksum_hex text,
  p_metadata_verified boolean, p_versions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  job_row public.showcase_media_jobs%ROWTYPE;
  asset_row public.showcase_media_assets%ROWTYPE;
  quota_row public.showcase_media_quota_reservations%ROWTYPE;
  item jsonb; variant_name text; version_uuid uuid; object_key text; checksum_hex text;
  version_width integer; version_height integer; version_size bigint;
  variant_count integer := 0; total_derivative_bytes bigint := 0;
  source_component bigint;
BEGIN
  IF p_decoded_mime NOT IN ('image/jpeg','image/png','image/webp')
     OR p_width NOT BETWEEN 1 AND 8192 OR p_height NOT BETWEEN 1 AND 8192
     OR p_width::bigint * p_height::bigint > 20000000
     OR p_source_byte_size NOT BETWEEN 1 AND 8388608
     OR p_source_checksum_hex !~ '^[0-9a-f]{64}$'
     OR p_metadata_verified IS DISTINCT FROM true
     OR jsonb_typeof(p_versions) <> 'array' OR jsonb_array_length(p_versions) <> 2 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_PROCESS_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job_row FROM public.showcase_media_jobs
    WHERE id = p_job_id AND state = 'leased' AND worker_id = p_worker_id
      AND leased_until > clock_timestamp() AND job_kind = 'process_source'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_MEDIA_LEASE_INVALID' USING ERRCODE = '55000'; END IF;
  -- Owner mutations create cleanup jobs while holding this same advisory lock. Taking it before
  -- cleanup rows makes their set stable; locking every existing cleanup row before the asset then
  -- matches deletion completion's job -> asset -> quota order and prevents processor-victim
  -- deadlocks after immutable Storage outputs have already been written.
  PERFORM public.showcase_acquire_publication_owner_lock(job_row.owner_id);
  PERFORM id FROM public.showcase_media_jobs
    WHERE asset_id = job_row.asset_id
      AND job_kind IN ('delete_derivatives','delete_source')
    ORDER BY job_kind
    FOR UPDATE;
  SELECT * INTO STRICT asset_row FROM public.showcase_media_assets
    WHERE id = job_row.asset_id AND owner_id = job_row.owner_id FOR UPDATE;
  SELECT * INTO STRICT quota_row FROM public.showcase_media_quota_reservations
    WHERE asset_id = asset_row.id AND owner_id = asset_row.owner_id FOR UPDATE;
  IF asset_row.state NOT IN ('processing','revoked','rejected') THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_STATE_CONFLICT' USING ERRCODE = '55000';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_versions)
  LOOP
    IF item - ARRAY['versionId','variant','objectKey','mime','width','height','byteSize','checksumHex']::text[] <> '{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 8
       OR item->>'variant' NOT IN ('hero','thumb') OR item->>'mime' <> 'image/webp'
       OR item->>'checksumHex' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PROCESS_RESULT_INVALID' USING ERRCODE = '22023';
    END IF;
    BEGIN
      version_uuid := (item->>'versionId')::uuid;
      version_width := (item->>'width')::integer;
      version_height := (item->>'height')::integer;
      version_size := (item->>'byteSize')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PROCESS_RESULT_INVALID' USING ERRCODE = '22023';
    END;
    variant_name := item->>'variant'; object_key := item->>'objectKey'; checksum_hex := item->>'checksumHex';
    IF (variant_name = 'hero' AND version_uuid <> job_row.hero_version_id)
       OR (variant_name = 'thumb' AND version_uuid <> job_row.thumb_version_id) THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PROCESS_PLAN_MISMATCH' USING ERRCODE = '22023';
    END IF;
    IF version_width < 1 OR version_height < 1 OR version_size NOT BETWEEN 1 AND 4194304
       OR (variant_name = 'hero' AND (version_width > 2400 OR version_height > 1600))
       OR (variant_name = 'thumb' AND (version_width > 640 OR version_height > 640)) THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_DERIVATIVE_BOUND_INVALID' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.showcase_media_asset_versions (
      id, asset_id, owner_id, variant, object_key, mime, width, height, byte_size, checksum
    ) VALUES (
      version_uuid, asset_row.id, asset_row.owner_id, variant_name, object_key, 'image/webp',
      version_width, version_height, version_size, decode(checksum_hex, 'hex')
    );
    variant_count := variant_count + 1;
    total_derivative_bytes := total_derivative_bytes + version_size;
  END LOOP;
  IF variant_count <> 2 OR NOT EXISTS (
      SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = asset_row.id AND variant = 'hero'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = asset_row.id AND variant = 'thumb'
    ) THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_VARIANTS_INCOMPLETE' USING ERRCODE = '22023';
  END IF;

  source_component := CASE WHEN quota_row.source_deleted_at IS NULL THEN p_source_byte_size ELSE 0 END;
  IF asset_row.state IN ('revoked','rejected') THEN
    -- A processor may have been leased before revocation. Its immutable outputs were uploaded before
    -- this RPC, so reopen accounting and force a fresh deletion generation even if an earlier
    -- planned-key deletion already succeeded (or is currently leased). The job-row lock serializes
    -- this reset against deletion completion and invalidates any stale deletion lease.
    UPDATE public.showcase_media_quota_reservations
      SET accounted_bytes = source_component + total_derivative_bytes,
          derivatives_deleted_at = NULL, released_at = NULL,
          updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id;
    UPDATE public.showcase_media_jobs
      SET state = 'queued', attempts = 0, available_at = clock_timestamp(),
          leased_at = NULL, leased_until = NULL, worker_id = NULL,
          last_error_code = NULL, completed_at = NULL, updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id AND job_kind = 'delete_derivatives';
    IF NOT FOUND THEN
      PERFORM public.showcase_enqueue_media_job(asset_row.owner_id, asset_row.id, 'delete_derivatives');
    END IF;
  ELSE
    UPDATE public.showcase_media_quota_reservations
      SET accounted_bytes = source_component + total_derivative_bytes,
          updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id;
  END IF;
  UPDATE public.showcase_media_assets
    SET decoded_mime = p_decoded_mime, width = p_width, height = p_height,
        pixel_count = p_width::bigint * p_height::bigint,
        byte_size = p_source_byte_size, checksum = decode(p_source_checksum_hex, 'hex'),
        metadata_stripped = true,
        state = CASE WHEN state = 'processing' THEN 'approved' ELSE state END,
        revision = revision + 1
    WHERE id = asset_row.id;
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', leased_at = NULL, leased_until = NULL, worker_id = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = job_row.id;
  PERFORM public.showcase_enqueue_media_job(asset_row.owner_id, asset_row.id, 'delete_source');
  IF asset_row.state IN ('revoked','rejected') THEN
    PERFORM public.showcase_enqueue_media_job(asset_row.owner_id, asset_row.id, 'delete_derivatives');
  END IF;
  RETURN jsonb_build_object('assetId', asset_row.id,
    'state', CASE WHEN asset_row.state = 'processing' THEN 'approved' ELSE asset_row.state END);
END;
$$;

CREATE FUNCTION public.showcase_fail_media_job(
  p_job_id uuid, p_worker_id uuid, p_error_code text, p_permanent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE job_row public.showcase_media_jobs%ROWTYPE; delay interval; terminal boolean;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_WORKER_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job_row FROM public.showcase_media_jobs
  WHERE id = p_job_id AND state = 'leased' AND worker_id = p_worker_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_MEDIA_LEASE_INVALID' USING ERRCODE = '55000'; END IF;

  terminal := p_permanent OR job_row.attempts >= 5;
  IF p_permanent AND job_row.job_kind = 'process_source' THEN
    UPDATE public.showcase_media_jobs
      SET state = 'succeeded', leased_at = NULL, leased_until = NULL, worker_id = NULL,
          last_error_code = p_error_code, completed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = job_row.id;
  ELSIF terminal THEN
    UPDATE public.showcase_media_jobs
      SET state = 'dead', leased_at = NULL, leased_until = NULL, worker_id = NULL,
          last_error_code = p_error_code, completed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = job_row.id;
  ELSE
    delay := CASE job_row.attempts WHEN 1 THEN interval '5 minutes'
      WHEN 2 THEN interval '1 hour' WHEN 3 THEN interval '6 hours' ELSE interval '24 hours' END;
    UPDATE public.showcase_media_jobs
      SET state = 'queued', available_at = clock_timestamp() + delay,
          leased_at = NULL, leased_until = NULL, worker_id = NULL,
          last_error_code = p_error_code, updated_at = clock_timestamp()
      WHERE id = job_row.id;
  END IF;

  IF job_row.job_kind = 'process_source' AND terminal THEN
    UPDATE public.showcase_media_assets
      SET state = CASE WHEN state = 'processing' THEN 'rejected' ELSE state END,
          revision = revision + 1
      WHERE id = job_row.asset_id AND owner_id = job_row.owner_id
        AND state IN ('processing','revoked');
    PERFORM public.showcase_enqueue_media_job(job_row.owner_id, job_row.asset_id, 'delete_source');
    PERFORM public.showcase_enqueue_media_job(job_row.owner_id, job_row.asset_id, 'delete_derivatives');
  END IF;
  RETURN jsonb_build_object('jobId', job_row.id,
    'state', CASE WHEN p_permanent AND job_row.job_kind = 'process_source' THEN 'succeeded'
      WHEN terminal THEN 'dead' ELSE 'queued' END);
END;
$$;

CREATE FUNCTION public.showcase_complete_media_deletion(
  p_job_id uuid, p_worker_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE job_row public.showcase_media_jobs%ROWTYPE; asset_row public.showcase_media_assets%ROWTYPE;
  quota_row public.showcase_media_quota_reservations%ROWTYPE; derivative_bytes bigint := 0;
  terminal_asset boolean;
BEGIN
  SELECT * INTO job_row FROM public.showcase_media_jobs
  WHERE id = p_job_id AND state = 'leased' AND worker_id = p_worker_id
    AND leased_until > clock_timestamp()
    AND job_kind IN ('delete_source','delete_derivatives')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_MEDIA_LEASE_INVALID' USING ERRCODE = '55000'; END IF;
  SELECT * INTO STRICT asset_row FROM public.showcase_media_assets
    WHERE id = job_row.asset_id AND owner_id = job_row.owner_id FOR UPDATE;
  SELECT * INTO STRICT quota_row FROM public.showcase_media_quota_reservations
    WHERE asset_id = asset_row.id AND owner_id = asset_row.owner_id FOR UPDATE;

  IF job_row.job_kind = 'delete_source' AND quota_row.source_deleted_at IS NULL THEN
    UPDATE public.showcase_media_quota_reservations
      SET accounted_bytes = GREATEST(0, accounted_bytes - COALESCE(asset_row.byte_size, 0)),
          source_deleted_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id;
  ELSIF job_row.job_kind = 'delete_derivatives' AND quota_row.derivatives_deleted_at IS NULL THEN
    SELECT COALESCE(sum(byte_size), 0) INTO derivative_bytes
      FROM public.showcase_media_asset_versions
      WHERE asset_id = asset_row.id AND owner_id = asset_row.owner_id;
    UPDATE public.showcase_media_quota_reservations
      SET accounted_bytes = GREATEST(0, accounted_bytes - derivative_bytes),
          derivatives_deleted_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id;
  END IF;

  SELECT * INTO quota_row FROM public.showcase_media_quota_reservations
    WHERE asset_id = asset_row.id FOR UPDATE;
  terminal_asset := asset_row.state IN ('revoked','deleted','rejected');
  IF terminal_asset AND quota_row.source_deleted_at IS NOT NULL
     AND (quota_row.derivatives_deleted_at IS NOT NULL OR NOT EXISTS (
       SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = asset_row.id
     )) THEN
    UPDATE public.showcase_media_quota_reservations
      SET accounted_bytes = 0, released_at = COALESCE(released_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE asset_id = asset_row.id;
  END IF;
  UPDATE public.showcase_media_jobs
    SET state = 'succeeded', leased_at = NULL, leased_until = NULL, worker_id = NULL,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = job_row.id;
  RETURN jsonb_build_object('jobId', job_row.id, 'deleted', true);
END;
$$;

-- Worker heartbeat maintenance: recover expired leases and deny/clean abandoned staging uploads.
CREATE FUNCTION public.showcase_sweep_media_maintenance(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE intent_row public.showcase_media_upload_intents%ROWTYPE;
  job_row public.showcase_media_jobs%ROWTYPE;
  expired_count integer := 0; recovered_count integer := 0; overdue_count integer;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_WORKER_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  FOR job_row IN
    SELECT * FROM public.showcase_media_jobs
    WHERE state = 'leased' AND leased_until <= clock_timestamp()
    ORDER BY leased_until FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    IF job_row.attempts >= 5 THEN
      UPDATE public.showcase_media_jobs
        SET state = 'dead', leased_at = NULL, leased_until = NULL, worker_id = NULL,
            last_error_code = 'LEASE_EXHAUSTED', completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = job_row.id;
      IF job_row.job_kind = 'process_source' THEN
        UPDATE public.showcase_media_assets
          SET state = CASE WHEN state = 'processing' THEN 'rejected' ELSE state END,
              revision = revision + 1
          WHERE id = job_row.asset_id AND owner_id = job_row.owner_id
            AND state IN ('processing','revoked');
        PERFORM public.showcase_enqueue_media_job(job_row.owner_id, job_row.asset_id, 'delete_source');
        PERFORM public.showcase_enqueue_media_job(job_row.owner_id, job_row.asset_id, 'delete_derivatives');
      END IF;
    ELSE
      UPDATE public.showcase_media_jobs
        SET state = 'queued', available_at = clock_timestamp(), leased_at = NULL,
            leased_until = NULL, worker_id = NULL, last_error_code = 'LEASE_EXPIRED',
            updated_at = clock_timestamp()
        WHERE id = job_row.id;
    END IF;
    recovered_count := recovered_count + 1;
  END LOOP;

  FOR intent_row IN
    SELECT * FROM public.showcase_media_upload_intents
    WHERE state = 'staging' AND expires_at <= clock_timestamp()
    ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    UPDATE public.showcase_media_upload_intents
      SET state = 'expired', cancelled_at = clock_timestamp() WHERE id = intent_row.id;
    UPDATE public.showcase_media_assets
      SET state = 'rejected', revision = revision + 1
      WHERE id = intent_row.asset_id AND owner_id = intent_row.owner_id AND state = 'staging';
    PERFORM public.showcase_enqueue_media_job(intent_row.owner_id, intent_row.asset_id, 'delete_source');
    expired_count := expired_count + 1;
  END LOOP;
  SELECT count(*) INTO overdue_count FROM public.showcase_media_jobs
    WHERE state IN ('queued','leased','dead') AND created_at <= clock_timestamp() - interval '24 hours';
  RETURN jsonb_build_object('expiredUploads', expired_count,
    'recoveredLeases', recovered_count, 'overdueJobs', overdue_count);
END;
$$;

CREATE FUNCTION public.showcase_publish_room_hero(
  p_owner_id uuid, p_room_id uuid, p_asset_id uuid,
  p_alt_text text, p_focal_x double precision, p_focal_y double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE room_row public.showcase_rooms%ROWTYPE; asset_row public.showcase_media_assets%ROWTYPE;
  old_attachment public.showcase_media_attachments%ROWTYPE; hero_version_id uuid; preview jsonb;
BEGIN
  IF p_alt_text IS NULL OR p_alt_text <> btrim(p_alt_text)
     OR char_length(p_alt_text) NOT BETWEEN 1 AND 500
     OR p_focal_x IS NULL OR p_focal_y IS NULL
     OR p_focal_x NOT BETWEEN 0 AND 1 OR p_focal_y NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_PUBLICATION_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO room_row FROM public.showcase_rooms
    WHERE id = p_room_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO asset_row FROM public.showcase_media_assets
    WHERE id = p_asset_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF asset_row.purpose <> 'room_hero' OR asset_row.state <> 'approved'
     OR asset_row.metadata_stripped IS DISTINCT FROM true
     OR NOT EXISTS (SELECT 1 FROM public.showcase_media_upload_intents
       WHERE asset_id = p_asset_id AND owner_id = p_owner_id AND room_id = p_room_id AND state = 'finalized')
     OR (SELECT count(*) FROM public.showcase_media_asset_versions
       WHERE asset_id = p_asset_id AND owner_id = p_owner_id AND variant IN ('hero','thumb')) <> 2 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_PUBLICATION_INVALID' USING ERRCODE = '55000';
  END IF;
  SELECT id INTO STRICT hero_version_id FROM public.showcase_media_asset_versions
    WHERE asset_id = p_asset_id AND owner_id = p_owner_id AND variant = 'hero';

  SELECT * INTO old_attachment FROM public.showcase_media_attachments
    WHERE parent_kind = 'room' AND parent_key = p_room_id AND slot = 'hero'
      AND state IN ('private','published') FOR UPDATE;
  IF FOUND THEN
    UPDATE public.showcase_media_attachments
      SET state = 'archived', revoked_at = clock_timestamp(), revision = revision + 1
      WHERE id = old_attachment.id;
    UPDATE public.showcase_media_assets
      SET state = 'revoked', revision = revision + 1
      WHERE id = old_attachment.asset_id AND owner_id = p_owner_id AND state IN ('approved','published');
    PERFORM public.showcase_enqueue_media_job(p_owner_id, old_attachment.asset_id, 'delete_source');
    IF EXISTS (SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = old_attachment.asset_id)
       OR EXISTS (SELECT 1 FROM public.showcase_media_jobs
         WHERE asset_id = old_attachment.asset_id AND job_kind = 'process_source') THEN
      PERFORM public.showcase_enqueue_media_job(p_owner_id, old_attachment.asset_id, 'delete_derivatives');
    END IF;
  END IF;

  UPDATE public.showcase_media_assets
    SET alt_text = p_alt_text, focal_x = p_focal_x, focal_y = p_focal_y,
        state = 'published', revision = revision + 1
    WHERE id = p_asset_id;
  INSERT INTO public.showcase_media_attachments (
    owner_id, asset_id, asset_version_id, parent_kind, parent_key, purpose, slot, state
  ) VALUES (
    p_owner_id, p_asset_id, hero_version_id, 'room', p_room_id, 'room_hero', 'hero', 'published'
  );
  INSERT INTO public.showcase_projection_invalidations(owner_id, reason)
    VALUES (p_owner_id, 'media_change');
  preview := public.showcase_render_room_projection(room_row);
  RETURN jsonb_build_object('assetId', p_asset_id, 'state', 'published', 'preview', preview);
END;
$$;

CREATE FUNCTION public.showcase_revoke_media_asset(
  p_owner_id uuid, p_asset_id uuid, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE asset_row public.showcase_media_assets%ROWTYPE;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_REVOKE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO asset_row FROM public.showcase_media_assets
    WHERE id = p_asset_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF asset_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_CONFLICT' USING ERRCODE = '55000';
  END IF;
  IF asset_row.state NOT IN ('revoked','deleted','rejected') THEN
    UPDATE public.showcase_media_attachments
      SET state = 'revoked', revoked_at = clock_timestamp(), revision = revision + 1
      WHERE asset_id = p_asset_id AND owner_id = p_owner_id AND state IN ('private','published');
    UPDATE public.showcase_media_assets
      SET state = 'revoked', revision = revision + 1
      WHERE id = p_asset_id;
    UPDATE public.showcase_media_upload_intents
      SET state = 'cancelled', cancelled_at = clock_timestamp()
      WHERE asset_id = p_asset_id AND state = 'staging';
    UPDATE public.showcase_media_jobs
      SET state = 'dead', completed_at = clock_timestamp(), last_error_code = 'OWNER_REVOKED',
          updated_at = clock_timestamp()
      WHERE asset_id = p_asset_id AND job_kind = 'process_source' AND state = 'queued';
    PERFORM public.showcase_enqueue_media_job(p_owner_id, p_asset_id, 'delete_source');
    IF EXISTS (SELECT 1 FROM public.showcase_media_asset_versions WHERE asset_id = p_asset_id)
       OR EXISTS (SELECT 1 FROM public.showcase_media_jobs
         WHERE asset_id = p_asset_id AND job_kind = 'process_source') THEN
      PERFORM public.showcase_enqueue_media_job(p_owner_id, p_asset_id, 'delete_derivatives');
    END IF;
    INSERT INTO public.showcase_projection_invalidations(owner_id, reason)
      VALUES (p_owner_id, 'media_change');
  END IF;
  RETURN jsonb_build_object('assetId', p_asset_id, 'state', 'revoked');
END;
$$;

-- Add the hero to both exact-preview and public DTOs without exposing keys. The previous reviewed
-- projection bodies remain as private helpers; wrappers inject one closed media object and recheck
-- the 1 MiB serialized response ceiling.
ALTER FUNCTION public.showcase_render_room_projection(public.showcase_rooms)
  RENAME TO showcase_render_room_projection_without_media_r1;
ALTER FUNCTION public.showcase_public_room(text, text)
  RENAME TO showcase_public_room_without_media_r1;

CREATE FUNCTION public.showcase_room_hero_json(p_room_id uuid, p_owner_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'assetId', a.id,
    'variant', v.variant,
    'alt', a.alt_text,
    'focalPoint', jsonb_build_object('x', a.focal_x, 'y', a.focal_y)
  )
  FROM public.showcase_media_attachments ma
  JOIN public.showcase_media_assets a
    ON a.id = ma.asset_id AND a.owner_id = ma.owner_id
  JOIN public.showcase_media_asset_versions v
    ON v.id = ma.asset_version_id AND v.asset_id = ma.asset_id AND v.owner_id = ma.owner_id
  WHERE ma.owner_id = p_owner_id AND ma.parent_kind = 'room' AND ma.parent_key = p_room_id
    AND ma.purpose = 'room_hero' AND ma.slot = 'hero' AND ma.state = 'published'
    AND a.purpose = 'room_hero' AND a.state = 'published' AND a.metadata_stripped = true
    AND a.alt_text IS NOT NULL AND a.focal_x IS NOT NULL AND a.focal_y IS NOT NULL
    AND v.variant = 'hero'
  LIMIT 1;
$$;

CREATE FUNCTION public.showcase_render_room_projection(p_room public.showcase_rooms)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE result jsonb; hero jsonb;
BEGIN
  result := public.showcase_render_room_projection_without_media_r1(p_room);
  hero := public.showcase_room_hero_json(p_room.id, p_room.owner_id);
  IF hero IS NOT NULL THEN result := jsonb_set(result, '{room,hero}', hero, true); END IF;
  IF octet_length(result::text) > 1048576 THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.showcase_public_room(
  normalized_room_slug text, normalized_tank_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE result jsonb; room_id uuid; owner_id uuid; hero jsonb;
BEGIN
  result := public.showcase_public_room_without_media_r1(normalized_room_slug, normalized_tank_slug);
  IF result IS NULL THEN RETURN NULL; END IF;
  SELECT id, showcase_rooms.owner_id INTO room_id, owner_id
    FROM public.showcase_rooms
    WHERE slug = normalized_room_slug AND visibility IN ('unlisted','public');
  IF NOT FOUND THEN RETURN NULL; END IF;
  hero := public.showcase_room_hero_json(room_id, owner_id);
  IF hero IS NOT NULL THEN result := jsonb_set(result, '{room,hero}', hero, true); END IF;
  IF octet_length(result::text) > 1048576 THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;
  RETURN result;
END;
$$;

-- Fresh authorization for every byte request. Only the attachment's exact immutable hero version
-- is readable in R1; `thumb` exists for owner preview/future slots but is not inferred as public.
CREATE FUNCTION public.showcase_authorize_media_read(p_asset_id uuid, p_variant text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'bucket', 'showcase-media-derivatives-v1',
    'objectKey', v.object_key,
    'mime', v.mime,
    'byteSize', v.byte_size,
    'checksumHex', encode(v.checksum, 'hex')
  )
  FROM public.showcase_media_assets a
  JOIN public.showcase_media_attachments ma
    ON ma.asset_id = a.id AND ma.owner_id = a.owner_id
  JOIN public.showcase_media_asset_versions v
    ON v.id = ma.asset_version_id AND v.asset_id = ma.asset_id AND v.owner_id = ma.owner_id
  JOIN public.showcase_rooms r
    ON r.id = ma.parent_key AND r.owner_id = ma.owner_id
  WHERE p_variant IN ('hero','thumb')
    AND a.id = p_asset_id AND a.purpose = 'room_hero' AND a.state = 'published'
    AND a.metadata_stripped = true
    AND ma.parent_kind = 'room' AND ma.purpose = 'room_hero' AND ma.slot = 'hero'
    AND ma.state = 'published' AND v.variant = p_variant
    AND r.visibility IN ('unlisted','public')
  LIMIT 1;
$$;

-- New relations are server-private, with no browser policies.
DO $showcase_media_rls$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'showcase_media_quota_reservations', 'showcase_media_upload_intents', 'showcase_media_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
  END LOOP;
END;
$showcase_media_rls$;

-- Renamed projection helpers must not inherit the old service grant. Every helper/trigger remains
-- uncallable to browser roles; only the reviewed control/worker/read RPCs are service-role callable.
REVOKE ALL ON FUNCTION public.showcase_public_room_without_media_r1(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_render_room_projection_without_media_r1(public.showcase_rooms)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_room_hero_json(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_render_room_projection(public.showcase_rooms)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_enqueue_media_job(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_cleanup_terminal_media_attachment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_media_upload_intent()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.showcase_public_room_without_media_r1(text,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_render_room_projection_without_media_r1(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_room_hero_json(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_render_room_projection(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_cleanup_terminal_media_attachment() OWNER TO postgres;
ALTER FUNCTION public.showcase_public_room(text,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_stage_room_hero(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_cancel_room_hero_stage(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_media_upload_binding(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_finalize_room_hero_upload(uuid,uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_media_status(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_claim_media_job(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_complete_media_processing(uuid,uuid,text,integer,integer,bigint,text,boolean,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_fail_media_job(uuid,uuid,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.showcase_complete_media_deletion(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.showcase_sweep_media_maintenance(integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_publish_room_hero(uuid,uuid,uuid,text,double precision,double precision) OWNER TO postgres;
ALTER FUNCTION public.showcase_revoke_media_asset(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.showcase_authorize_media_read(uuid,text) OWNER TO postgres;

DO $showcase_media_function_acl$
DECLARE function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.showcase_public_room(text,text)',
    'public.showcase_stage_room_hero(uuid,uuid,text)',
    'public.showcase_cancel_room_hero_stage(uuid,uuid,uuid)',
    'public.showcase_owner_media_upload_binding(uuid,uuid,uuid)',
    'public.showcase_finalize_room_hero_upload(uuid,uuid,uuid,bigint)',
    'public.showcase_owner_media_status(uuid,uuid)',
    'public.showcase_claim_media_job(uuid,integer)',
    'public.showcase_complete_media_processing(uuid,uuid,text,integer,integer,bigint,text,boolean,jsonb)',
    'public.showcase_fail_media_job(uuid,uuid,text,boolean)',
    'public.showcase_complete_media_deletion(uuid,uuid)',
    'public.showcase_sweep_media_maintenance(integer)',
    'public.showcase_publish_room_hero(uuid,uuid,uuid,text,double precision,double precision)',
    'public.showcase_revoke_media_asset(uuid,uuid,bigint)',
    'public.showcase_authorize_media_read(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', function_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_signature);
  END LOOP;
END;
$showcase_media_function_acl$;

COMMIT;
