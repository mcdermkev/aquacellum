-- Separate owner-bound room video gallery with private source ingest and signed Mux playback.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('showcase-video-source-v1', 'showcase-video-source-v1', false, 262144000, ARRAY['video/mp4'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = false,
  file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.showcase_video_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  room_id uuid NOT NULL,
  source_object_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'staging',
  declared_source_byte_size bigint,
  source_byte_size bigint,
  source_checksum bytea,
  correlation_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  mux_upload_id text UNIQUE,
  mux_asset_id text UNIQUE,
  mux_playback_id text UNIQUE,
  duration_seconds double precision,
  width integer,
  height integer,
  video_codec text,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT showcase_video_assets_id_owner_key UNIQUE (id, owner_id),
  CONSTRAINT showcase_video_assets_id_owner_room_key UNIQUE (id, owner_id, room_id),
  CONSTRAINT showcase_video_assets_room_owner_fkey FOREIGN KEY (room_id, owner_id)
    REFERENCES public.showcase_rooms(id, owner_id),
  CONSTRAINT showcase_video_assets_state_closed CHECK (state IN (
    'staging','queued','processing','ready','errored','revoked','deleting','deleted','rejected'
  )),
  CONSTRAINT showcase_video_assets_declared_size CHECK (
    declared_source_byte_size IS NULL OR declared_source_byte_size BETWEEN 1 AND 262144000
  ),
  CONSTRAINT showcase_video_assets_source_size CHECK (source_byte_size IS NULL OR source_byte_size BETWEEN 1 AND 262144000),
  CONSTRAINT showcase_video_assets_source_checksum CHECK (source_checksum IS NULL OR octet_length(source_checksum) = 32),
  CONSTRAINT showcase_video_assets_correlation CHECK (correlation_token ~ '^[0-9a-f]{64}$'),
  CONSTRAINT showcase_video_assets_revision CHECK (revision >= 0),
  CONSTRAINT showcase_video_assets_ready_coherent CHECK (
    state <> 'ready' OR (
      mux_upload_id IS NOT NULL AND mux_asset_id IS NOT NULL AND mux_playback_id IS NOT NULL
      AND source_byte_size IS NOT NULL AND source_checksum IS NOT NULL
      AND duration_seconds IS NOT NULL AND duration_seconds > 0 AND duration_seconds <= 60
      AND width IS NOT NULL AND width BETWEEN 16 AND 3840
      AND height IS NOT NULL AND height BETWEEN 16 AND 2160
      AND video_codec IS NOT NULL AND video_codec IN ('h264','hevc')
    )
  )
);
CREATE INDEX showcase_video_assets_owner_room_idx ON public.showcase_video_assets(owner_id, room_id, created_at);

CREATE TABLE public.showcase_video_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  room_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'staging',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT showcase_video_upload_operation_key UNIQUE (owner_id, operation_id),
  CONSTRAINT showcase_video_upload_asset_fkey FOREIGN KEY (asset_id, owner_id, room_id)
    REFERENCES public.showcase_video_assets(id, owner_id, room_id),
  CONSTRAINT showcase_video_upload_state_closed CHECK (state IN ('staging','finalized','expired','cancelled')),
  CONSTRAINT showcase_video_upload_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT showcase_video_upload_state_coherent CHECK (
    (state = 'staging' AND finalized_at IS NULL AND cancelled_at IS NULL)
    OR (state = 'finalized' AND finalized_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state IN ('expired','cancelled') AND finalized_at IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX showcase_video_upload_expiry_idx ON public.showcase_video_upload_intents(state, expires_at);

CREATE TABLE public.showcase_video_quota_reservations (
  asset_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  reserved_bytes bigint NOT NULL DEFAULT 262144000,
  source_deleted_at timestamptz,
  provider_deleted_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_video_quota_asset_fkey FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_video_assets(id, owner_id),
  CONSTRAINT showcase_video_quota_bytes CHECK (reserved_bytes BETWEEN 0 AND 262144000),
  CONSTRAINT showcase_video_quota_release CHECK (released_at IS NULL OR
    (reserved_bytes = 0 AND source_deleted_at IS NOT NULL AND provider_deleted_at IS NOT NULL))
);

CREATE TABLE public.showcase_room_videos (
  asset_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  room_id uuid NOT NULL,
  title text NOT NULL,
  caption text,
  alt_text text NOT NULL,
  display_order integer NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  state text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT showcase_room_videos_asset_fkey FOREIGN KEY (asset_id, owner_id, room_id)
    REFERENCES public.showcase_video_assets(id, owner_id, room_id),
  CONSTRAINT showcase_room_videos_title CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT showcase_room_videos_caption CHECK (caption IS NULL OR (caption = btrim(caption) AND char_length(caption) BETWEEN 1 AND 1000)),
  CONSTRAINT showcase_room_videos_alt CHECK (alt_text = btrim(alt_text) AND char_length(alt_text) BETWEEN 1 AND 500),
  CONSTRAINT showcase_room_videos_order CHECK (display_order BETWEEN 0 AND 19),
  CONSTRAINT showcase_room_videos_visibility CHECK (visibility IN ('private','unlisted','public')),
  CONSTRAINT showcase_room_videos_state CHECK (state IN ('active','revoked')),
  CONSTRAINT showcase_room_videos_revision CHECK (revision >= 0)
);
CREATE UNIQUE INDEX showcase_room_videos_active_order_key
  ON public.showcase_room_videos(room_id, display_order) WHERE state = 'active';

CREATE TABLE public.showcase_video_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  room_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  job_kind text NOT NULL,
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
  CONSTRAINT showcase_video_jobs_asset_fkey FOREIGN KEY (asset_id, owner_id, room_id)
    REFERENCES public.showcase_video_assets(id, owner_id, room_id),
  CONSTRAINT showcase_video_jobs_asset_kind_key UNIQUE (asset_id, job_kind),
  CONSTRAINT showcase_video_jobs_kind CHECK (job_kind IN ('ingest_mux','delete_source','delete_mux_asset')),
  CONSTRAINT showcase_video_jobs_state CHECK (state IN ('queued','leased','succeeded','dead')),
  CONSTRAINT showcase_video_jobs_attempts CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT showcase_video_jobs_error CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT showcase_video_jobs_lease CHECK (
    (state = 'queued' AND leased_at IS NULL AND leased_until IS NULL AND worker_id IS NULL AND completed_at IS NULL)
    OR (state = 'leased' AND leased_at IS NOT NULL AND leased_until > leased_at AND worker_id IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('succeeded','dead') AND leased_at IS NULL AND leased_until IS NULL AND worker_id IS NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX showcase_video_jobs_claim_idx ON public.showcase_video_jobs(state, available_at, created_at) WHERE state = 'queued';

CREATE TABLE public.showcase_mux_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  raw_sha256 bytea NOT NULL,
  result text NOT NULL DEFAULT 'received',
  asset_id uuid,
  duplicate_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT showcase_mux_event_asset_fkey FOREIGN KEY (asset_id)
    REFERENCES public.showcase_video_assets(id),
  CONSTRAINT showcase_mux_event_id CHECK (char_length(event_id) BETWEEN 1 AND 200),
  CONSTRAINT showcase_mux_event_type CHECK (event_type ~ '^[a-z0-9._-]{1,120}$'),
  CONSTRAINT showcase_mux_event_hash CHECK (octet_length(raw_sha256) = 32),
  CONSTRAINT showcase_mux_event_duplicates CHECK (duplicate_count >= 0),
  CONSTRAINT showcase_mux_event_result CHECK (result IN ('received','processed','ignored','terminal','conflict'))
);

-- Identity columns are permanent. Provider identifiers may be assigned exactly once, but never
-- cleared or changed; this keeps webhook correlation and destructive cleanup fail-closed.
CREATE FUNCTION public.showcase_guard_video_asset_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.room_id IS DISTINCT FROM OLD.room_id
    OR NEW.source_object_key IS DISTINCT FROM OLD.source_object_key
    OR NEW.correlation_token IS DISTINCT FROM OLD.correlation_token
    OR (OLD.mux_upload_id IS NOT NULL AND NEW.mux_upload_id IS DISTINCT FROM OLD.mux_upload_id)
    OR (OLD.mux_asset_id IS NOT NULL AND NEW.mux_asset_id IS DISTINCT FROM OLD.mux_asset_id)
    OR (OLD.mux_playback_id IS NOT NULL AND NEW.mux_playback_id IS DISTINCT FROM OLD.mux_playback_id) THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_video_asset_identity_guard BEFORE UPDATE ON public.showcase_video_assets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_video_asset_identity();

CREATE FUNCTION public.showcase_guard_video_child_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF to_jsonb(NEW)->>'owner_id' IS DISTINCT FROM to_jsonb(OLD)->>'owner_id'
    OR to_jsonb(NEW)->>'asset_id' IS DISTINCT FROM to_jsonb(OLD)->>'asset_id'
    OR (to_jsonb(OLD) ? 'room_id' AND to_jsonb(NEW)->>'room_id' IS DISTINCT FROM to_jsonb(OLD)->>'room_id')
    OR (TG_TABLE_NAME='showcase_video_upload_intents' AND (
      to_jsonb(NEW)->>'id' IS DISTINCT FROM to_jsonb(OLD)->>'id'
      OR to_jsonb(NEW)->>'operation_id' IS DISTINCT FROM to_jsonb(OLD)->>'operation_id'))
    OR (TG_TABLE_NAME='showcase_video_jobs' AND (
      to_jsonb(NEW)->>'id' IS DISTINCT FROM to_jsonb(OLD)->>'id'
      OR to_jsonb(NEW)->>'job_kind' IS DISTINCT FROM to_jsonb(OLD)->>'job_kind')) THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_video_intent_identity_guard BEFORE UPDATE ON public.showcase_video_upload_intents
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_video_child_identity();
CREATE TRIGGER showcase_video_quota_identity_guard BEFORE UPDATE ON public.showcase_video_quota_reservations
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_video_child_identity();
CREATE TRIGGER showcase_room_video_identity_guard BEFORE UPDATE ON public.showcase_room_videos
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_video_child_identity();
CREATE TRIGGER showcase_video_job_identity_guard BEFORE UPDATE ON public.showcase_video_jobs
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_video_child_identity();

CREATE FUNCTION public.showcase_guard_mux_event_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.raw_sha256 IS DISTINCT FROM OLD.raw_sha256
    OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
    RAISE EXCEPTION 'SHOWCASE_MUX_EVENT_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_mux_event_identity_guard BEFORE UPDATE ON public.showcase_mux_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_mux_event_identity();

CREATE FUNCTION public.showcase_enqueue_video_job(
  p_owner_id uuid, p_room_id uuid, p_asset_id uuid, p_kind text, p_rearm_terminal boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_asset_id IS NULL
    OR p_kind NOT IN ('ingest_mux','delete_source','delete_mux_asset') THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_JOB_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  INSERT INTO public.showcase_video_jobs(owner_id, room_id, asset_id, job_kind)
  VALUES (p_owner_id, p_room_id, p_asset_id, p_kind)
  ON CONFLICT (asset_id, job_kind) DO UPDATE SET
    state='queued', attempts=0, available_at=clock_timestamp(), leased_at=NULL, leased_until=NULL,
    worker_id=NULL, last_error_code=NULL, completed_at=NULL, updated_at=clock_timestamp()
  WHERE p_rearm_terminal AND EXCLUDED.job_kind='delete_mux_asset'
    AND showcase_video_jobs.state IN ('succeeded','dead');
END;
$$;

CREATE FUNCTION public.showcase_stage_room_video(p_owner_id uuid, p_room_id uuid, p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE existing public.showcase_video_upload_intents%ROWTYPE; asset_uuid uuid := gen_random_uuid();
  intent_uuid uuid := gen_random_uuid(); staged_at timestamptz := clock_timestamp(); source_key text;
  active_count integer; retained bigint;
BEGIN
  IF p_owner_id IS NULL OR p_room_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_STAGE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO existing FROM public.showcase_video_upload_intents
    WHERE owner_id = p_owner_id AND operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF existing.room_id <> p_room_id THEN
      RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
    END IF;
    IF existing.state='staging' AND existing.expires_at<=clock_timestamp() THEN
      UPDATE public.showcase_video_upload_intents
        SET state='expired',cancelled_at=clock_timestamp() WHERE id=existing.id RETURNING * INTO existing;
      UPDATE public.showcase_video_assets SET state='rejected',revision=revision+1,updated_at=clock_timestamp()
        WHERE id=existing.asset_id AND state='staging';
      UPDATE public.showcase_video_quota_reservations
        SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),updated_at=clock_timestamp()
        WHERE asset_id=existing.asset_id;
      PERFORM public.showcase_enqueue_video_job(p_owner_id,p_room_id,existing.asset_id,'delete_source');
    END IF;
    SELECT source_object_key INTO source_key FROM public.showcase_video_assets WHERE id = existing.asset_id;
    RETURN jsonb_build_object('videoId', existing.asset_id, 'uploadIntentId', existing.id,
      'sourceObjectKey', source_key, 'contentType', 'video/mp4', 'expiresAt', existing.expires_at,
      'intentState', existing.state);
  END IF;
  PERFORM 1 FROM public.showcase_rooms WHERE id = p_room_id AND owner_id = p_owner_id
    AND visibility = 'private' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT count(*) INTO active_count FROM public.showcase_video_assets
    WHERE owner_id = p_owner_id AND room_id = p_room_id AND state NOT IN ('revoked','deleted','rejected');
  SELECT COALESCE(sum(reserved_bytes),0) INTO retained FROM public.showcase_video_quota_reservations
    WHERE owner_id = p_owner_id AND released_at IS NULL;
  IF active_count >= 20 OR retained + 262144000 > 5242880000 THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_QUOTA_EXCEEDED' USING ERRCODE = '54000';
  END IF;
  source_key := 'owners/' || p_owner_id::text || '/rooms/' || p_room_id::text
    || '/videos/' || asset_uuid::text || '/source.mp4';
  INSERT INTO public.showcase_video_assets(id, owner_id, room_id, source_object_key)
    VALUES (asset_uuid, p_owner_id, p_room_id, source_key);
  INSERT INTO public.showcase_video_upload_intents(id, operation_id, owner_id, room_id, asset_id, created_at, expires_at)
    VALUES (intent_uuid, p_operation_id, p_owner_id, p_room_id, asset_uuid, staged_at, staged_at + interval '10 minutes');
  INSERT INTO public.showcase_video_quota_reservations(asset_id, owner_id) VALUES (asset_uuid, p_owner_id);
  RETURN jsonb_build_object('videoId', asset_uuid, 'uploadIntentId', intent_uuid,
    'sourceObjectKey', source_key, 'contentType', 'video/mp4',
    'expiresAt', staged_at + interval '10 minutes', 'intentState', 'staging');
END;
$$;

CREATE FUNCTION public.showcase_cancel_room_video_stage(p_owner_id uuid, p_room_id uuid, p_asset_id uuid, p_intent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  UPDATE public.showcase_video_upload_intents SET state='cancelled', cancelled_at=clock_timestamp()
    WHERE id=p_intent_id AND owner_id=p_owner_id AND room_id=p_room_id AND asset_id=p_asset_id AND state='staging';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.showcase_video_assets SET state='rejected', revision=revision+1, updated_at=clock_timestamp()
    WHERE id=p_asset_id AND owner_id=p_owner_id AND room_id=p_room_id AND state='staging';
  UPDATE public.showcase_video_quota_reservations SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),
    updated_at=clock_timestamp() WHERE asset_id=p_asset_id AND owner_id=p_owner_id;
  PERFORM public.showcase_enqueue_video_job(p_owner_id,p_room_id,p_asset_id,'delete_source');
END;
$$;

CREATE FUNCTION public.showcase_owner_video_upload_binding(p_owner_id uuid, p_room_id uuid, p_asset_id uuid, p_intent_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('sourceObjectKey', a.source_object_key, 'expiresAt', i.expires_at)
  FROM public.showcase_video_upload_intents i JOIN public.showcase_video_assets a
    ON a.id=i.asset_id AND a.owner_id=i.owner_id AND a.room_id=i.room_id
  WHERE i.id=p_intent_id AND i.owner_id=p_owner_id AND i.room_id=p_room_id AND i.asset_id=p_asset_id
    AND i.state='staging' AND i.expires_at>clock_timestamp() AND a.state='staging';
$$;

CREATE FUNCTION public.showcase_finalize_room_video_upload(
  p_owner_id uuid, p_room_id uuid, p_asset_id uuid, p_intent_id uuid, p_source_byte_size bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE intent_row public.showcase_video_upload_intents%ROWTYPE; asset_row public.showcase_video_assets%ROWTYPE;
BEGIN
  IF p_source_byte_size IS NULL OR p_source_byte_size NOT BETWEEN 1 AND 262144000 THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_SOURCE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO intent_row FROM public.showcase_video_upload_intents
    WHERE id=p_intent_id AND owner_id=p_owner_id AND room_id=p_room_id AND asset_id=p_asset_id FOR UPDATE;
  SELECT * INTO asset_row FROM public.showcase_video_assets
    WHERE id=p_asset_id AND owner_id=p_owner_id AND room_id=p_room_id FOR UPDATE;
  IF intent_row.id IS NULL OR asset_row.id IS NULL THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF intent_row.state='finalized' AND asset_row.declared_source_byte_size=p_source_byte_size
     AND asset_row.state IN ('queued','processing','ready') THEN
    RETURN jsonb_build_object('videoId', asset_row.id, 'state', asset_row.state, 'revision', asset_row.revision);
  END IF;
  IF intent_row.state<>'staging' OR intent_row.expires_at<=clock_timestamp() OR asset_row.state<>'staging' THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_STATE_CONFLICT' USING ERRCODE='55000';
  END IF;
  UPDATE public.showcase_video_upload_intents SET state='finalized', finalized_at=clock_timestamp() WHERE id=intent_row.id;
  UPDATE public.showcase_video_assets SET state='queued', declared_source_byte_size=p_source_byte_size,
    revision=revision+1, updated_at=clock_timestamp() WHERE id=asset_row.id RETURNING * INTO asset_row;
  PERFORM public.showcase_enqueue_video_job(p_owner_id,p_room_id,p_asset_id,'ingest_mux');
  RETURN jsonb_build_object('videoId',asset_row.id,'state',asset_row.state,'revision',asset_row.revision);
END;
$$;

CREATE FUNCTION public.showcase_owner_room_videos(p_owner_id uuid, p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.showcase_rooms r WHERE r.id=p_room_id AND r.owner_id=p_owner_id
  ) THEN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'videoId','video_'||a.id::text,'state',a.state,'revision',a.revision,
      'declaredSourceByteSize',a.declared_source_byte_size,'sourceByteSize',a.source_byte_size,
      'durationSeconds',a.duration_seconds,'width',a.width,'height',a.height,
      'codec',a.video_codec,'gallery',CASE WHEN g.asset_id IS NULL THEN NULL ELSE jsonb_build_object(
        'title',g.title,'caption',g.caption,'alt',g.alt_text,'order',g.display_order,
        'visibility',g.visibility,'state',g.state,'revision',g.revision) END,
      'jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',j.job_kind,'state',j.state,
        'attempts',j.attempts,'lastErrorCode',j.last_error_code) ORDER BY j.created_at)
        FROM public.showcase_video_jobs j WHERE j.asset_id=a.id),'[]'::jsonb)
    ) ORDER BY a.created_at),'[]'::jsonb)
    FROM public.showcase_video_assets a LEFT JOIN public.showcase_room_videos g ON g.asset_id=a.id
    WHERE a.owner_id=p_owner_id AND a.room_id=p_room_id
  ) ELSE NULL END;
$$;

CREATE FUNCTION public.showcase_put_room_video(
  p_owner_id uuid,p_room_id uuid,p_asset_id uuid,p_expected_revision bigint,
  p_title text,p_caption text,p_alt_text text,p_display_order integer,p_visibility text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.showcase_room_videos%ROWTYPE; active_count integer;
BEGIN
  IF p_title IS NULL OR p_title<>btrim(p_title) OR char_length(p_title) NOT BETWEEN 1 AND 120
    OR (p_caption IS NOT NULL AND (p_caption<>btrim(p_caption) OR char_length(p_caption) NOT BETWEEN 1 AND 1000))
    OR p_alt_text IS NULL OR p_alt_text<>btrim(p_alt_text) OR char_length(p_alt_text) NOT BETWEEN 1 AND 500
    OR p_display_order IS NULL OR p_display_order NOT BETWEEN 0 AND 19
    OR p_visibility IS NULL OR p_visibility NOT IN ('private','unlisted','public') THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  PERFORM 1 FROM public.showcase_rooms WHERE id=p_room_id AND owner_id=p_owner_id AND visibility='private' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.showcase_video_assets WHERE id=p_asset_id AND owner_id=p_owner_id AND room_id=p_room_id
    AND state='ready' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_NOT_READY' USING ERRCODE='55000'; END IF;
  SELECT * INTO existing FROM public.showcase_room_videos WHERE asset_id=p_asset_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_revision IS NULL OR existing.revision<>p_expected_revision OR existing.state<>'active' THEN
      RAISE EXCEPTION 'SHOWCASE_REVISION_CONFLICT' USING ERRCODE='55000';
    END IF;
    UPDATE public.showcase_room_videos SET title=p_title,caption=p_caption,alt_text=p_alt_text,
      display_order=p_display_order,visibility=p_visibility,revision=revision+1,updated_at=clock_timestamp()
      WHERE asset_id=p_asset_id RETURNING * INTO existing;
  ELSE
    IF p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'SHOWCASE_REVISION_CONFLICT' USING ERRCODE='55000'; END IF;
    SELECT count(*) INTO active_count FROM public.showcase_room_videos WHERE room_id=p_room_id AND state='active';
    IF active_count>=20 THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_QUOTA_EXCEEDED' USING ERRCODE='54000'; END IF;
    INSERT INTO public.showcase_room_videos(asset_id,owner_id,room_id,title,caption,alt_text,display_order,visibility)
      VALUES(p_asset_id,p_owner_id,p_room_id,p_title,p_caption,p_alt_text,p_display_order,p_visibility)
      RETURNING * INTO existing;
  END IF;
  INSERT INTO public.showcase_projection_invalidations(owner_id,reason) VALUES(p_owner_id,'video_change');
  RETURN jsonb_build_object('videoId','video_'||existing.asset_id::text,'revision',existing.revision,
    'visibility',existing.visibility,'state',existing.state);
END;
$$;

CREATE FUNCTION public.showcase_revoke_room_video(
  p_owner_id uuid,p_room_id uuid,p_asset_id uuid,p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE asset_row public.showcase_video_assets%ROWTYPE;
BEGIN
  PERFORM public.showcase_acquire_publication_owner_lock(p_owner_id);
  SELECT * INTO asset_row FROM public.showcase_video_assets
    WHERE id=p_asset_id AND owner_id=p_owner_id AND room_id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR asset_row.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_CONFLICT' USING ERRCODE='55000';
  END IF;
  IF asset_row.state NOT IN ('revoked','deleted','rejected') THEN
    UPDATE public.showcase_video_assets SET state='revoked',revision=revision+1,
      revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_asset_id;
    UPDATE public.showcase_room_videos SET state='revoked',revision=revision+1,
      revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE asset_id=p_asset_id AND state='active';
    UPDATE public.showcase_video_upload_intents SET state='cancelled',cancelled_at=clock_timestamp()
      WHERE asset_id=p_asset_id AND state='staging';
    UPDATE public.showcase_video_jobs SET state='dead',leased_at=NULL,leased_until=NULL,worker_id=NULL,
      completed_at=clock_timestamp(),last_error_code='OWNER_REVOKED',updated_at=clock_timestamp()
      WHERE asset_id=p_asset_id AND job_kind='ingest_mux' AND state='queued';
    IF asset_row.mux_upload_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.showcase_video_jobs
      WHERE asset_id=p_asset_id AND job_kind='ingest_mux' AND state='leased'
    ) THEN
      -- No worker can have created an unbound provider upload: queued ingest was killed above and
      -- no ingest lease remains. Only this proven-absent case may satisfy provider cleanup early.
      UPDATE public.showcase_video_quota_reservations
        SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),updated_at=clock_timestamp()
        WHERE asset_id=p_asset_id;
    ELSIF asset_row.mux_upload_id IS NOT NULL THEN
      PERFORM public.showcase_enqueue_video_job(p_owner_id,p_room_id,p_asset_id,'delete_mux_asset');
    END IF;
    PERFORM public.showcase_enqueue_video_job(p_owner_id,p_room_id,p_asset_id,'delete_source');
    INSERT INTO public.showcase_projection_invalidations(owner_id,reason) VALUES(p_owner_id,'video_change');
  END IF;
  SELECT * INTO asset_row FROM public.showcase_video_assets WHERE id=p_asset_id;
  RETURN jsonb_build_object('videoId','video_'||p_asset_id::text,'state',asset_row.state,'revision',asset_row.revision);
END;
$$;

CREATE FUNCTION public.showcase_authorize_owner_video_playback(p_owner_id uuid,p_room_id uuid,p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('muxPlaybackId',mux_playback_id)
  FROM public.showcase_video_assets WHERE id=p_asset_id AND owner_id=p_owner_id AND room_id=p_room_id
    AND state='ready' AND mux_playback_id IS NOT NULL;
$$;

CREATE FUNCTION public.showcase_authorize_public_video_playback(p_room_slug text,p_asset_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('muxPlaybackId',a.mux_playback_id)
  FROM public.showcase_rooms r JOIN public.showcase_room_videos g
    ON g.room_id=r.id AND g.owner_id=r.owner_id
  JOIN public.showcase_video_assets a ON a.id=g.asset_id AND a.owner_id=g.owner_id AND a.room_id=g.room_id
  WHERE r.slug=p_room_slug AND r.visibility IN ('unlisted','public') AND g.asset_id=p_asset_id
    AND g.state='active' AND a.state='ready' AND a.mux_playback_id IS NOT NULL
    AND (g.visibility='public' OR (r.visibility='unlisted' AND g.visibility='unlisted'));
$$;

CREATE FUNCTION public.showcase_claim_video_job(p_worker_id uuid,p_lease_seconds integer DEFAULT 7200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.showcase_video_jobs%ROWTYPE; asset_row public.showcase_video_assets%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 7200 THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_WORKER_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT j.* INTO job_row
  FROM public.showcase_video_jobs j
  JOIN public.showcase_video_assets a ON a.id=j.asset_id AND a.owner_id=j.owner_id AND a.room_id=j.room_id
  WHERE j.state='queued' AND j.available_at<=clock_timestamp() AND j.attempts<5
    AND (j.job_kind<>'ingest_mux' OR a.state IN ('queued','processing'))
  ORDER BY j.available_at,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.showcase_video_jobs SET state='leased',attempts=attempts+1,leased_at=clock_timestamp(),
    leased_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),worker_id=p_worker_id,updated_at=clock_timestamp()
    WHERE id=job_row.id RETURNING * INTO job_row;
  SELECT * INTO STRICT asset_row FROM public.showcase_video_assets WHERE id=job_row.asset_id;
  RETURN jsonb_build_object('jobId',job_row.id,'kind',job_row.job_kind,'attempt',job_row.attempts,
    'videoId',asset_row.id,'ownerId',asset_row.owner_id,'roomId',asset_row.room_id,'assetState',asset_row.state,
    'sourceObjectKey',asset_row.source_object_key,'declaredSourceByteSize',asset_row.declared_source_byte_size,
    'sourceByteSize',asset_row.source_byte_size,
    'sourceChecksumHex',CASE WHEN asset_row.source_checksum IS NULL THEN NULL ELSE encode(asset_row.source_checksum,'hex') END,
    'correlationToken',asset_row.correlation_token,'muxUploadId',asset_row.mux_upload_id,'muxAssetId',asset_row.mux_asset_id);
END;
$$;

CREATE FUNCTION public.showcase_bind_video_mux_upload(
  p_job_id uuid,p_worker_id uuid,p_source_byte_size bigint,p_source_checksum_hex text,p_mux_upload_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.showcase_video_jobs%ROWTYPE; job_owner uuid; asset_row public.showcase_video_assets%ROWTYPE;
BEGIN
  IF p_job_id IS NULL OR p_worker_id IS NULL OR p_source_byte_size IS NULL
    OR p_source_byte_size NOT BETWEEN 1 AND 262144000
    OR p_source_checksum_hex IS NULL OR p_source_checksum_hex !~ '^[0-9a-f]{64}$'
    OR p_mux_upload_id IS NULL OR p_mux_upload_id !~ '^[-_A-Za-z0-9]{1,200}$' THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_WORKER_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT owner_id INTO job_owner FROM public.showcase_video_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(job_owner);
  SELECT * INTO job_row FROM public.showcase_video_jobs WHERE id=p_job_id AND state='leased'
    AND worker_id=p_worker_id AND leased_until>clock_timestamp() AND job_kind='ingest_mux' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  SELECT * INTO asset_row FROM public.showcase_video_assets WHERE id=job_row.asset_id FOR UPDATE;
  IF asset_row.declared_source_byte_size IS NULL OR asset_row.declared_source_byte_size<>p_source_byte_size
    OR (asset_row.source_byte_size IS NOT NULL AND asset_row.source_byte_size<>p_source_byte_size)
    OR (asset_row.source_checksum IS NOT NULL AND asset_row.source_checksum<>decode(p_source_checksum_hex,'hex'))
    OR (asset_row.mux_upload_id IS NOT NULL AND asset_row.mux_upload_id<>p_mux_upload_id) THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_STATE_CONFLICT' USING ERRCODE='55000';
  END IF;
  IF asset_row.state IN ('errored','revoked','deleting','deleted','rejected') THEN
    -- A late successful bind disproves any earlier provider-absence assumption. Reacquire the
    -- reservation before recording the ID so quota cannot be released ahead of provider deletion.
    UPDATE public.showcase_video_quota_reservations
      SET reserved_bytes=262144000,provider_deleted_at=NULL,released_at=NULL,updated_at=clock_timestamp()
      WHERE asset_id=asset_row.id;
    UPDATE public.showcase_video_assets SET source_byte_size=COALESCE(source_byte_size,p_source_byte_size),
      source_checksum=COALESCE(source_checksum,decode(p_source_checksum_hex,'hex')),
      mux_upload_id=COALESCE(mux_upload_id,p_mux_upload_id),updated_at=clock_timestamp()
      WHERE id=asset_row.id;
    PERFORM public.showcase_enqueue_video_job(
      asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_mux_asset',true
    );
    RETURN jsonb_build_object('accepted',false,'state',asset_row.state);
  END IF;
  UPDATE public.showcase_video_assets SET source_byte_size=p_source_byte_size,
    source_checksum=decode(p_source_checksum_hex,'hex'), mux_upload_id=COALESCE(mux_upload_id,p_mux_upload_id),
    state=CASE WHEN state='queued' THEN 'processing' ELSE state END,
    revision=revision+CASE WHEN state='queued' OR source_checksum IS NULL OR mux_upload_id IS NULL THEN 1 ELSE 0 END,
    updated_at=clock_timestamp()
    WHERE id=job_row.asset_id AND state IN ('queued','processing');
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_STATE_CONFLICT' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('accepted',true,'state','processing');
END;
$$;

CREATE FUNCTION public.showcase_complete_video_ingest_submit(p_job_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE public.showcase_video_jobs SET state='succeeded',leased_at=NULL,leased_until=NULL,worker_id=NULL,
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=p_job_id AND state='leased' AND worker_id=p_worker_id AND leased_until>clock_timestamp()
      AND job_kind='ingest_mux';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
END;
$$;

CREATE FUNCTION public.showcase_complete_video_deletion(p_job_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.showcase_video_jobs%ROWTYPE; quota_row public.showcase_video_quota_reservations%ROWTYPE;
  job_owner uuid;
BEGIN
  SELECT owner_id INTO job_owner FROM public.showcase_video_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(job_owner);
  SELECT * INTO job_row FROM public.showcase_video_jobs WHERE id=p_job_id AND state='leased'
    AND worker_id=p_worker_id AND leased_until>clock_timestamp()
    AND job_kind IN ('delete_source','delete_mux_asset') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  SELECT * INTO quota_row FROM public.showcase_video_quota_reservations WHERE asset_id=job_row.asset_id FOR UPDATE;
  IF job_row.job_kind='delete_source' THEN
    UPDATE public.showcase_video_quota_reservations SET source_deleted_at=COALESCE(source_deleted_at,clock_timestamp()),
      updated_at=clock_timestamp() WHERE asset_id=job_row.asset_id;
  ELSE
    UPDATE public.showcase_video_quota_reservations SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),
      updated_at=clock_timestamp() WHERE asset_id=job_row.asset_id;
  END IF;
  SELECT * INTO quota_row FROM public.showcase_video_quota_reservations WHERE asset_id=job_row.asset_id FOR UPDATE;
  IF quota_row.source_deleted_at IS NOT NULL AND quota_row.provider_deleted_at IS NOT NULL THEN
    UPDATE public.showcase_video_quota_reservations SET reserved_bytes=0,released_at=COALESCE(released_at,clock_timestamp()),
      updated_at=clock_timestamp() WHERE asset_id=job_row.asset_id;
    UPDATE public.showcase_video_assets SET state=CASE WHEN state IN ('revoked','rejected','errored','deleting') THEN 'deleted' ELSE state END,
      deleted_at=CASE WHEN state IN ('revoked','rejected','errored','deleting') THEN clock_timestamp() ELSE deleted_at END,
      revision=revision+1,updated_at=clock_timestamp() WHERE id=job_row.asset_id;
  END IF;
  UPDATE public.showcase_video_jobs SET state='succeeded',leased_at=NULL,leased_until=NULL,worker_id=NULL,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job_row.id;
END;
$$;

CREATE FUNCTION public.showcase_fail_video_job(
  p_job_id uuid,p_worker_id uuid,p_error_code text,p_permanent boolean DEFAULT false,
  p_provider_absent boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job_row public.showcase_video_jobs%ROWTYPE; terminal boolean; delay interval; job_owner uuid;
BEGIN
  IF p_job_id IS NULL OR p_worker_id IS NULL OR p_error_code IS NULL
    OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' OR p_provider_absent IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_WORKER_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT owner_id INTO job_owner FROM public.showcase_video_jobs WHERE id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  PERFORM public.showcase_acquire_publication_owner_lock(job_owner);
  SELECT * INTO job_row FROM public.showcase_video_jobs WHERE id=p_job_id AND state='leased'
    AND worker_id=p_worker_id AND leased_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_VIDEO_LEASE_INVALID' USING ERRCODE='55000'; END IF;
  terminal:=p_permanent OR job_row.attempts>=5 OR (
    job_row.job_kind='ingest_mux' AND EXISTS (
      SELECT 1 FROM public.showcase_video_assets WHERE id=job_row.asset_id
        AND state IN ('errored','revoked','deleting','deleted','rejected')
    )
  );
  IF terminal THEN
    UPDATE public.showcase_video_jobs SET state='dead',leased_at=NULL,leased_until=NULL,worker_id=NULL,
      last_error_code=p_error_code,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=job_row.id;
    IF job_row.job_kind='ingest_mux' THEN
      UPDATE public.showcase_video_assets SET state=CASE WHEN state IN ('queued','processing') THEN 'rejected' ELSE state END,
        revision=revision+CASE WHEN state IN ('queued','processing') THEN 1 ELSE 0 END,
        updated_at=clock_timestamp() WHERE id=job_row.asset_id;
      PERFORM public.showcase_enqueue_video_job(job_row.owner_id,job_row.room_id,job_row.asset_id,'delete_source');
      IF EXISTS (SELECT 1 FROM public.showcase_video_assets WHERE id=job_row.asset_id AND mux_upload_id IS NOT NULL) THEN
        PERFORM public.showcase_enqueue_video_job(job_row.owner_id,job_row.room_id,job_row.asset_id,'delete_mux_asset');
      ELSIF p_provider_absent THEN
        -- The worker may assert absence only when no provider request was attempted.
        UPDATE public.showcase_video_quota_reservations
          SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),updated_at=clock_timestamp()
          WHERE asset_id=job_row.asset_id;
      END IF;
    END IF;
  ELSE
    delay:=CASE job_row.attempts WHEN 1 THEN interval '5 minutes' WHEN 2 THEN interval '1 hour'
      WHEN 3 THEN interval '6 hours' ELSE interval '24 hours' END;
    UPDATE public.showcase_video_jobs SET state='queued',available_at=clock_timestamp()+delay,leased_at=NULL,
      leased_until=NULL,worker_id=NULL,last_error_code=p_error_code,updated_at=clock_timestamp() WHERE id=job_row.id;
  END IF;
END;
$$;

CREATE FUNCTION public.showcase_apply_mux_event(
  p_event_id text,p_event_type text,p_raw_sha256_hex text,p_video_id uuid,p_correlation text,
  p_mux_upload_id text,p_mux_asset_id text,p_mux_playback_id text,p_duration double precision,
  p_width integer,p_height integer,p_video_codec text,p_playback_policy text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.showcase_mux_webhook_events%ROWTYPE; asset_row public.showcase_video_assets%ROWTYPE;
  inserted_count integer; candidate_owner uuid;
BEGIN
  IF p_event_id IS NULL OR char_length(p_event_id) NOT BETWEEN 1 AND 200
    OR p_event_type IS NULL OR p_event_type !~ '^[a-z0-9._-]{1,120}$'
    OR p_raw_sha256_hex IS NULL OR p_raw_sha256_hex !~ '^[0-9a-f]{64}$'
    OR (p_correlation IS NOT NULL AND p_correlation !~ '^[0-9a-f]{64}$')
    OR (p_mux_upload_id IS NOT NULL AND p_mux_upload_id !~ '^[-_A-Za-z0-9]{1,200}$')
    OR (p_mux_asset_id IS NOT NULL AND p_mux_asset_id !~ '^[-_A-Za-z0-9]{1,200}$')
    OR (p_mux_playback_id IS NOT NULL AND p_mux_playback_id !~ '^[-_A-Za-z0-9]{1,200}$') THEN
    RAISE EXCEPTION 'SHOWCASE_MUX_EVENT_INVALID' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.showcase_mux_webhook_events(event_id,event_type,raw_sha256)
    VALUES(p_event_id,p_event_type,decode(p_raw_sha256_hex,'hex'))
    ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT * INTO existing FROM public.showcase_mux_webhook_events WHERE event_id=p_event_id FOR UPDATE;
  IF inserted_count=0 THEN
    IF existing.raw_sha256<>decode(p_raw_sha256_hex,'hex') OR existing.event_type<>p_event_type THEN
      UPDATE public.showcase_mux_webhook_events SET result='conflict',last_seen_at=clock_timestamp(),
        processed_at=clock_timestamp() WHERE event_id=p_event_id;
      RETURN jsonb_build_object('result','conflict','code','SHOWCASE_MUX_REPLAY_CONFLICT');
    END IF;
    UPDATE public.showcase_mux_webhook_events SET duplicate_count=duplicate_count+1,
      last_seen_at=clock_timestamp() WHERE event_id=p_event_id;
    IF existing.result<>'conflict' THEN
      RETURN jsonb_build_object('result','duplicate');
    END IF;
    -- A same-byte retry after a transient ordering conflict must be evaluated again; otherwise an
    -- asset-created/ready event that beat the worker bind would be permanently poisoned.
    UPDATE public.showcase_mux_webhook_events SET result='received',processed_at=NULL
      WHERE event_id=p_event_id;
  END IF;

  IF p_video_id IS NULL OR p_correlation IS NULL THEN
    UPDATE public.showcase_mux_webhook_events SET result='ignored',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','ignored');
  END IF;
  SELECT owner_id INTO candidate_owner FROM public.showcase_video_assets
    WHERE id=p_video_id AND correlation_token=p_correlation;
  IF NOT FOUND THEN
    UPDATE public.showcase_mux_webhook_events SET result='ignored',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','ignored');
  END IF;

  PERFORM public.showcase_acquire_publication_owner_lock(candidate_owner);
  SELECT * INTO asset_row FROM public.showcase_video_assets
    WHERE id=p_video_id AND owner_id=candidate_owner AND correlation_token=p_correlation FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.showcase_mux_webhook_events SET result='ignored',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','ignored');
  END IF;
  UPDATE public.showcase_mux_webhook_events SET asset_id=asset_row.id WHERE event_id=p_event_id;

  IF p_event_type NOT IN ('video.upload.asset_created','video.asset.ready','video.asset.errored') THEN
    UPDATE public.showcase_mux_webhook_events SET result='ignored',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','ignored');
  END IF;
  IF p_mux_upload_id IS NULL OR p_mux_asset_id IS NULL
    OR (asset_row.mux_upload_id IS NOT NULL AND p_mux_upload_id<>asset_row.mux_upload_id)
    OR (asset_row.mux_asset_id IS NOT NULL AND p_mux_asset_id<>asset_row.mux_asset_id) THEN
    UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','conflict','code','SHOWCASE_MUX_CORRELATION_INVALID');
  END IF;

  -- Terminal states are deny-first. Late provider identifiers may be recorded once solely so
  -- cleanup can delete them; no terminal event can restore playback eligibility.
  IF asset_row.state IN ('errored','revoked','deleting','deleted','rejected') THEN
    UPDATE public.showcase_video_quota_reservations
      SET reserved_bytes=262144000,provider_deleted_at=NULL,released_at=NULL,updated_at=clock_timestamp()
      WHERE asset_id=asset_row.id;
    UPDATE public.showcase_video_assets
      SET mux_upload_id=COALESCE(mux_upload_id,p_mux_upload_id),
          mux_asset_id=COALESCE(mux_asset_id,p_mux_asset_id),updated_at=clock_timestamp()
      WHERE id=asset_row.id;
    PERFORM public.showcase_enqueue_video_job(
      asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_mux_asset',true
    );
    UPDATE public.showcase_mux_webhook_events SET result='terminal',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','terminal');
  END IF;
  IF asset_row.mux_upload_id IS NULL OR p_mux_upload_id<>asset_row.mux_upload_id THEN
    UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
      WHERE event_id=p_event_id;
    RETURN jsonb_build_object('result','conflict','code','SHOWCASE_MUX_CORRELATION_INVALID');
  END IF;

  IF p_event_type='video.upload.asset_created' THEN
    UPDATE public.showcase_video_assets SET mux_asset_id=COALESCE(mux_asset_id,p_mux_asset_id),
      updated_at=clock_timestamp() WHERE id=asset_row.id;
  ELSIF p_event_type='video.asset.ready' THEN
    IF p_mux_playback_id IS NULL OR p_playback_policy<>'signed'
      OR p_duration IS NULL OR p_duration<=0 OR p_duration>60
      OR p_width IS NULL OR p_width NOT BETWEEN 16 AND 3840
      OR p_height IS NULL OR p_height NOT BETWEEN 16 AND 2160
      OR p_video_codec IS NULL OR p_video_codec NOT IN ('h264','hevc') THEN
      -- A canonical provider asset that violates signed-playback or media bounds is terminal, not a
      -- retryable inert conflict. Deny playback first and schedule both cleanup sides.
      UPDATE public.showcase_video_assets SET state='errored',mux_asset_id=COALESCE(mux_asset_id,p_mux_asset_id),
        revision=revision+1,updated_at=clock_timestamp()
        WHERE id=asset_row.id AND state IN ('processing','ready');
      IF FOUND THEN
        PERFORM public.showcase_enqueue_video_job(asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_source');
        PERFORM public.showcase_enqueue_video_job(asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_mux_asset',true);
        INSERT INTO public.showcase_projection_invalidations(owner_id,reason) VALUES(asset_row.owner_id,'video_change');
        UPDATE public.showcase_mux_webhook_events SET result='terminal',processed_at=clock_timestamp()
          WHERE event_id=p_event_id;
        RETURN jsonb_build_object('result','terminal');
      END IF;
      UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
        WHERE event_id=p_event_id;
      RETURN jsonb_build_object('result','conflict','code','SHOWCASE_MUX_ASSET_INVALID');
    END IF;
    IF asset_row.state='ready' THEN
      IF asset_row.mux_asset_id=p_mux_asset_id AND asset_row.mux_playback_id=p_mux_playback_id
        AND asset_row.duration_seconds=p_duration AND asset_row.width=p_width AND asset_row.height=p_height
        AND asset_row.video_codec=p_video_codec THEN
        UPDATE public.showcase_mux_webhook_events SET result='processed',processed_at=clock_timestamp()
          WHERE event_id=p_event_id;
        RETURN jsonb_build_object('result','processed','videoId','video_'||asset_row.id::text);
      END IF;
      UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
        WHERE event_id=p_event_id;
      RETURN jsonb_build_object('result','conflict','code','SHOWCASE_VIDEO_STATE_CONFLICT');
    END IF;
    UPDATE public.showcase_video_assets SET state='ready',mux_asset_id=COALESCE(mux_asset_id,p_mux_asset_id),
      mux_playback_id=p_mux_playback_id,duration_seconds=p_duration,width=p_width,height=p_height,
      video_codec=p_video_codec,revision=revision+1,updated_at=clock_timestamp()
      WHERE id=asset_row.id AND state='processing';
    IF NOT FOUND THEN
      UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
        WHERE event_id=p_event_id;
      RETURN jsonb_build_object('result','conflict','code','SHOWCASE_VIDEO_STATE_CONFLICT');
    END IF;
    PERFORM public.showcase_enqueue_video_job(asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_source');
    INSERT INTO public.showcase_projection_invalidations(owner_id,reason) VALUES(asset_row.owner_id,'video_change');
  ELSE
    UPDATE public.showcase_video_assets SET state='errored',mux_asset_id=COALESCE(mux_asset_id,p_mux_asset_id),
      revision=revision+1,updated_at=clock_timestamp()
      WHERE id=asset_row.id AND state='processing';
    IF NOT FOUND THEN
      UPDATE public.showcase_mux_webhook_events SET result='conflict',processed_at=clock_timestamp()
        WHERE event_id=p_event_id;
      RETURN jsonb_build_object('result','conflict','code','SHOWCASE_VIDEO_STATE_CONFLICT');
    END IF;
    PERFORM public.showcase_enqueue_video_job(asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_source');
    PERFORM public.showcase_enqueue_video_job(asset_row.owner_id,asset_row.room_id,asset_row.id,'delete_mux_asset');
  END IF;
  UPDATE public.showcase_mux_webhook_events SET result='processed',processed_at=clock_timestamp()
    WHERE event_id=p_event_id;
  RETURN jsonb_build_object('result','processed','videoId','video_'||asset_row.id::text);
END;
$$;

CREATE FUNCTION public.showcase_sweep_video_maintenance(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_item record; locked_job public.showcase_video_jobs%ROWTYPE;
  locked_intent public.showcase_video_upload_intents%ROWTYPE; recovered integer:=0; expired integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'SHOWCASE_VIDEO_SWEEP_INVALID' USING ERRCODE='22023';
  END IF;
  FOR row_item IN SELECT id,owner_id FROM public.showcase_video_jobs
    WHERE state='leased' AND leased_until<=clock_timestamp() ORDER BY leased_until LIMIT p_limit LOOP
    PERFORM public.showcase_acquire_publication_owner_lock(row_item.owner_id);
    SELECT * INTO locked_job FROM public.showcase_video_jobs WHERE id=row_item.id
      AND state='leased' AND leased_until<=clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF locked_job.attempts>=5 OR (
      locked_job.job_kind='ingest_mux' AND EXISTS (
        SELECT 1 FROM public.showcase_video_assets WHERE id=locked_job.asset_id
          AND state IN ('errored','revoked','deleting','deleted','rejected')
      )
    ) THEN
      UPDATE public.showcase_video_jobs SET state='dead',leased_at=NULL,leased_until=NULL,worker_id=NULL,
        last_error_code='LEASE_EXHAUSTED',completed_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=locked_job.id;
      IF locked_job.job_kind='ingest_mux' THEN
        UPDATE public.showcase_video_assets SET state=CASE WHEN state IN ('queued','processing') THEN 'rejected' ELSE state END,
          revision=revision+CASE WHEN state IN ('queued','processing') THEN 1 ELSE 0 END,updated_at=clock_timestamp()
          WHERE id=locked_job.asset_id;
        PERFORM public.showcase_enqueue_video_job(locked_job.owner_id,locked_job.room_id,locked_job.asset_id,'delete_source');
        IF EXISTS (SELECT 1 FROM public.showcase_video_assets
          WHERE id=locked_job.asset_id AND mux_upload_id IS NOT NULL) THEN
          PERFORM public.showcase_enqueue_video_job(locked_job.owner_id,locked_job.room_id,locked_job.asset_id,'delete_mux_asset');
        END IF;
      END IF;
    ELSE
      UPDATE public.showcase_video_jobs SET state='queued',available_at=clock_timestamp(),leased_at=NULL,
        leased_until=NULL,worker_id=NULL,last_error_code='LEASE_EXPIRED',updated_at=clock_timestamp()
        WHERE id=locked_job.id;
    END IF;
    recovered:=recovered+1;
  END LOOP;
  FOR row_item IN SELECT id,owner_id FROM public.showcase_video_upload_intents
    WHERE state='staging' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT p_limit LOOP
    PERFORM public.showcase_acquire_publication_owner_lock(row_item.owner_id);
    SELECT * INTO locked_intent FROM public.showcase_video_upload_intents WHERE id=row_item.id
      AND state='staging' AND expires_at<=clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.showcase_video_upload_intents SET state='expired',cancelled_at=clock_timestamp()
      WHERE id=locked_intent.id;
    UPDATE public.showcase_video_assets SET state='rejected',revision=revision+1,updated_at=clock_timestamp()
      WHERE id=locked_intent.asset_id AND state='staging';
    UPDATE public.showcase_video_quota_reservations
      SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),updated_at=clock_timestamp()
      WHERE asset_id=locked_intent.asset_id;
    PERFORM public.showcase_enqueue_video_job(
      locked_intent.owner_id,locked_intent.room_id,locked_intent.asset_id,'delete_source'
    );
    expired:=expired+1;
  END LOOP;
  RETURN jsonb_build_object('recoveredJobs',recovered,'expiredIntents',expired);
END;
$$;

CREATE FUNCTION public.showcase_room_video_gallery_json(p_room_id uuid,p_owner_id uuid,p_room_visibility text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('videoId','video_'||a.id::text,'title',g.title,
    'caption',g.caption,'alt',g.alt_text,'durationSeconds',round(a.duration_seconds::numeric,3),
    'order',g.display_order) ORDER BY g.display_order,a.id),'[]'::jsonb)
  FROM public.showcase_room_videos g JOIN public.showcase_video_assets a
    ON a.id=g.asset_id AND a.owner_id=g.owner_id AND a.room_id=g.room_id
  WHERE g.room_id=p_room_id AND g.owner_id=p_owner_id AND g.state='active' AND a.state='ready'
    AND (p_room_visibility='private' OR g.visibility='public'
      OR (p_room_visibility='unlisted' AND g.visibility='unlisted'));
$$;

ALTER FUNCTION public.showcase_render_room_projection(public.showcase_rooms)
  RENAME TO showcase_render_room_projection_without_videos_r1;
ALTER FUNCTION public.showcase_public_room(text,text)
  RENAME TO showcase_public_room_without_videos_r1;

CREATE FUNCTION public.showcase_render_room_projection(p_room public.showcase_rooms)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE result jsonb; gallery jsonb;
BEGIN
  result:=public.showcase_render_room_projection_without_videos_r1(p_room);
  gallery:=public.showcase_room_video_gallery_json(p_room.id,p_room.owner_id,p_room.visibility);
  result:=jsonb_set(result,'{room,videos}',gallery,true);
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE='54000'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.showcase_public_room(normalized_room_slug text,normalized_tank_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; room_row public.showcase_rooms%ROWTYPE; gallery jsonb;
BEGIN
  result:=public.showcase_public_room_without_videos_r1(normalized_room_slug,normalized_tank_slug);
  IF result IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO room_row FROM public.showcase_rooms WHERE slug=normalized_room_slug AND visibility IN ('unlisted','public');
  IF NOT FOUND THEN RETURN NULL; END IF;
  gallery:=public.showcase_room_video_gallery_json(room_row.id,room_row.owner_id,room_row.visibility);
  result:=jsonb_set(result,'{room,videos}',gallery,true);
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'SHOWCASE_PUBLIC_DTO_TOO_LARGE' USING ERRCODE='54000'; END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.showcase_revoke_videos_on_room_reset()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE item record;
BEGIN
  IF current_setting('showcase.owner_reset_room_id',true)=NEW.id::text
    AND current_setting('showcase.owner_reset_owner_id',true)=NEW.owner_id::text THEN
    FOR item IN SELECT id,mux_upload_id FROM public.showcase_video_assets
      WHERE owner_id=NEW.owner_id AND room_id=NEW.id
      AND state NOT IN ('revoked','deleted','rejected') FOR UPDATE LOOP
      UPDATE public.showcase_video_assets SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=item.id;
      UPDATE public.showcase_room_videos SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE asset_id=item.id AND state='active';
      UPDATE public.showcase_video_upload_intents SET state='cancelled',cancelled_at=clock_timestamp()
        WHERE asset_id=item.id AND state='staging';
      UPDATE public.showcase_video_jobs SET state='dead',leased_at=NULL,leased_until=NULL,worker_id=NULL,
        completed_at=clock_timestamp(),last_error_code='OWNER_REVOKED',updated_at=clock_timestamp()
        WHERE asset_id=item.id AND job_kind='ingest_mux' AND state='queued';
      IF item.mux_upload_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.showcase_video_jobs
        WHERE asset_id=item.id AND job_kind='ingest_mux' AND state='leased'
      ) THEN
        UPDATE public.showcase_video_quota_reservations
          SET provider_deleted_at=COALESCE(provider_deleted_at,clock_timestamp()),updated_at=clock_timestamp()
          WHERE asset_id=item.id;
      ELSIF item.mux_upload_id IS NOT NULL THEN
        PERFORM public.showcase_enqueue_video_job(NEW.owner_id,NEW.id,item.id,'delete_mux_asset');
      END IF;
      PERFORM public.showcase_enqueue_video_job(NEW.owner_id,NEW.id,item.id,'delete_source');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_rooms_video_reset AFTER UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_revoke_videos_on_room_reset();

DO $video_rls$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['showcase_video_assets','showcase_video_upload_intents','showcase_video_quota_reservations',
    'showcase_room_videos','showcase_video_jobs','showcase_mux_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',n);
  END LOOP;
END $video_rls$;

DO $video_acl$ DECLARE sig text; BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.showcase_stage_room_video(uuid,uuid,uuid)',
    'public.showcase_cancel_room_video_stage(uuid,uuid,uuid,uuid)',
    'public.showcase_owner_video_upload_binding(uuid,uuid,uuid,uuid)',
    'public.showcase_finalize_room_video_upload(uuid,uuid,uuid,uuid,bigint)',
    'public.showcase_owner_room_videos(uuid,uuid)',
    'public.showcase_put_room_video(uuid,uuid,uuid,bigint,text,text,text,integer,text)',
    'public.showcase_revoke_room_video(uuid,uuid,uuid,bigint)',
    'public.showcase_authorize_owner_video_playback(uuid,uuid,uuid)',
    'public.showcase_authorize_public_video_playback(text,uuid)',
    'public.showcase_claim_video_job(uuid,integer)',
    'public.showcase_bind_video_mux_upload(uuid,uuid,bigint,text,text)',
    'public.showcase_complete_video_ingest_submit(uuid,uuid)',
    'public.showcase_complete_video_deletion(uuid,uuid)',
    'public.showcase_fail_video_job(uuid,uuid,text,boolean,boolean)',
    'public.showcase_apply_mux_event(text,text,text,uuid,text,text,text,text,double precision,integer,integer,text,text)',
    'public.showcase_sweep_video_maintenance(integer)',
    'public.showcase_public_room(text,text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',sig);
  END LOOP;
END $video_acl$;

REVOKE ALL ON FUNCTION public.showcase_enqueue_video_job(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_video_asset_identity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_video_child_identity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_mux_event_identity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_room_video_gallery_json(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_render_room_projection_without_videos_r1(public.showcase_rooms) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_public_room_without_videos_r1(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_render_room_projection(public.showcase_rooms) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.showcase_revoke_videos_on_room_reset() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.showcase_enqueue_video_job(uuid,uuid,uuid,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.showcase_guard_video_asset_identity() OWNER TO postgres;
ALTER FUNCTION public.showcase_guard_video_child_identity() OWNER TO postgres;
ALTER FUNCTION public.showcase_guard_mux_event_identity() OWNER TO postgres;
ALTER FUNCTION public.showcase_room_video_gallery_json(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_render_room_projection_without_videos_r1(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_public_room_without_videos_r1(text,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_render_room_projection(public.showcase_rooms) OWNER TO postgres;
ALTER FUNCTION public.showcase_revoke_videos_on_room_reset() OWNER TO postgres;

COMMIT;
