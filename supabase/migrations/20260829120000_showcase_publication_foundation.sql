-- Fish Room R1.2 Tier A publication, private media metadata, slug, and transfer foundation.
-- Storage buckets/routes remain gated by R1.0 section 8.4.

BEGIN;

CREATE FUNCTION public.showcase_slug_is_valid(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT candidate IS NOT NULL
    AND char_length(candidate) BETWEEN 3 AND 63
    AND octet_length(candidate) = char_length(candidate)
    AND candidate ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND NOT (candidate = ANY (ARRAY[
      'admin','api','app','assets','auth','checkout','delete','edit','false','help',
      'index','login','logout','marketplace','media','new','null','private','public',
      'register','room','rooms','settings','signin','signup','specimen','specimens',
      'static','store','support','tank','tanks','true','undefined','unlisted'
    ]::text[]));
$$;

CREATE FUNCTION public.showcase_schematic_is_valid(candidate jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  zone jsonb;
  zone_id text;
  seen_ids text[] := ARRAY[]::text[];
BEGIN
  IF candidate IS NULL OR jsonb_typeof(candidate) <> 'object'
     OR NOT (candidate ? 'zones') OR (candidate - 'zones') <> '{}'::jsonb
     OR jsonb_typeof(candidate->'zones') <> 'array'
     OR jsonb_array_length(candidate->'zones') > 20
     OR octet_length(candidate::text) > 65536 THEN
    RETURN false;
  END IF;

  FOR zone IN SELECT value FROM jsonb_array_elements(candidate->'zones') LOOP
    IF jsonb_typeof(zone) <> 'object'
       OR NOT (zone ?& ARRAY['id','label','kind'])
       OR (zone - ARRAY['id','label','kind']) <> '{}'::jsonb
       OR jsonb_typeof(zone->'id') <> 'string'
       OR jsonb_typeof(zone->'label') <> 'string'
       OR jsonb_typeof(zone->'kind') <> 'string' THEN
      RETURN false;
    END IF;
    zone_id := zone->>'id';
    IF zone_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR char_length(zone_id) > 63
       OR zone->>'label' <> btrim(zone->>'label')
       OR char_length(zone->>'label') NOT BETWEEN 1 AND 80
       OR zone->>'kind' !~ '^[a-z][a-z0-9_-]{0,31}$'
       OR zone_id = ANY(seen_ids) THEN
      RETURN false;
    END IF;
    seen_ids := array_append(seen_ids, zone_id);
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE public.showcase_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'private',
  schematic_version integer NOT NULL DEFAULT 1,
  schematic_data jsonb NOT NULL DEFAULT '{"zones":[]}'::jsonb,
  show_keeper_display_name boolean NOT NULL DEFAULT false,
  show_keeper_profile_path boolean NOT NULL DEFAULT false,
  show_keeper_avatar boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  published_at timestamptz,
  first_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_rooms_owner_key UNIQUE (owner_id),
  CONSTRAINT showcase_rooms_id_owner_key UNIQUE (id, owner_id),
  CONSTRAINT showcase_rooms_slug_key UNIQUE (slug),
  CONSTRAINT showcase_rooms_slug_valid CHECK (public.showcase_slug_is_valid(slug)),
  CONSTRAINT showcase_rooms_title_bounded
    CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 80),
  CONSTRAINT showcase_rooms_description_bounded
    CHECK (description IS NULL OR char_length(description) <= 1000),
  CONSTRAINT showcase_rooms_visibility_closed CHECK (visibility IN ('private', 'unlisted', 'public')),
  CONSTRAINT showcase_rooms_schematic_v1 CHECK (schematic_version = 1),
  CONSTRAINT showcase_rooms_schematic_valid CHECK (public.showcase_schematic_is_valid(schematic_data)),
  CONSTRAINT showcase_rooms_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT showcase_rooms_publication_coherent
    CHECK ((visibility = 'private' AND published_at IS NULL)
      OR (visibility <> 'private' AND published_at IS NOT NULL AND first_published_at IS NOT NULL)),
  CONSTRAINT showcase_rooms_timestamp_order
    CHECK ((published_at IS NULL OR published_at >= created_at)
      AND (first_published_at IS NULL OR first_published_at >= created_at))
);

CREATE TABLE public.showcase_room_tanks (
  room_id uuid NOT NULL,
  tank_key uuid NOT NULL,
  owner_id uuid NOT NULL,
  entity_kind text NOT NULL DEFAULT 'tank',
  slug text NOT NULL,
  visibility text NOT NULL DEFAULT 'private',
  public_label text,
  caption text,
  show_volume boolean NOT NULL DEFAULT false,
  show_tank_type boolean NOT NULL DEFAULT false,
  show_established_at boolean NOT NULL DEFAULT false,
  show_published_inhabitant_count boolean NOT NULL DEFAULT false,
  care_fact_kind text,
  x double precision NOT NULL,
  y double precision NOT NULL,
  width double precision,
  height double precision,
  focal_x double precision,
  focal_y double precision,
  zone_id text,
  display_order integer NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  published_at timestamptz,
  first_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, tank_key),
  CONSTRAINT showcase_room_tanks_room_owner_fkey
    FOREIGN KEY (room_id, owner_id)
    REFERENCES public.showcase_rooms(id, owner_id),
  CONSTRAINT showcase_room_tanks_entity_owner_fkey
    FOREIGN KEY (tank_key, owner_id, entity_kind)
    REFERENCES public.showcase_entities(public_key, owner_id, entity_kind),
  CONSTRAINT showcase_room_tanks_canonical_tank_owner_fkey
    FOREIGN KEY (tank_key, owner_id)
    REFERENCES public.showcase_tanks(tank_key, owner_id),
  CONSTRAINT showcase_room_tanks_kind_tank CHECK (entity_kind = 'tank'),
  CONSTRAINT showcase_room_tanks_room_slug_key UNIQUE (room_id, slug),
  CONSTRAINT showcase_room_tanks_room_order_key UNIQUE (room_id, display_order),
  CONSTRAINT showcase_room_tanks_slug_valid CHECK (public.showcase_slug_is_valid(slug)),
  CONSTRAINT showcase_room_tanks_visibility_closed CHECK (visibility IN ('private', 'unlisted', 'public')),
  CONSTRAINT showcase_room_tanks_public_label_bounded
    CHECK (public_label IS NULL OR char_length(public_label) BETWEEN 1 AND 80),
  CONSTRAINT showcase_room_tanks_public_label_required
    CHECK (visibility = 'private' OR (public_label IS NOT NULL AND btrim(public_label) <> '')),
  CONSTRAINT showcase_room_tanks_caption_bounded CHECK (caption IS NULL OR char_length(caption) <= 1000),
  CONSTRAINT showcase_room_tanks_care_fact_closed
    CHECK (care_fact_kind IS NULL OR care_fact_kind = 'water_change'),
  CONSTRAINT showcase_room_tanks_x_normalized CHECK (x BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_room_tanks_y_normalized CHECK (y BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_room_tanks_width_normalized
    CHECK (width IS NULL OR width > 0::double precision AND width <= 1::double precision),
  CONSTRAINT showcase_room_tanks_height_normalized
    CHECK (height IS NULL OR height > 0::double precision AND height <= 1::double precision),
  CONSTRAINT showcase_room_tanks_focal_x_normalized
    CHECK (focal_x IS NULL OR focal_x BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_room_tanks_focal_y_normalized
    CHECK (focal_y IS NULL OR focal_y BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_room_tanks_zone_id_bounded
    CHECK (zone_id IS NULL OR (zone_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(zone_id) <= 63)),
  CONSTRAINT showcase_room_tanks_order_nonnegative CHECK (display_order >= 0),
  CONSTRAINT showcase_room_tanks_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT showcase_room_tanks_publication_coherent
    CHECK ((visibility = 'private' AND published_at IS NULL)
      OR (visibility <> 'private' AND published_at IS NOT NULL AND first_published_at IS NOT NULL)),
  CONSTRAINT showcase_room_tanks_timestamp_order
    CHECK ((published_at IS NULL OR published_at >= created_at)
      AND (first_published_at IS NULL OR first_published_at >= created_at))
);

CREATE INDEX showcase_room_tanks_owner_visibility_idx
  ON public.showcase_room_tanks(owner_id, visibility, display_order);

CREATE TABLE public.showcase_specimen_settings (
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  specimen_key uuid NOT NULL,
  entity_kind text NOT NULL DEFAULT 'specimen',
  visibility text NOT NULL DEFAULT 'private',
  public_name text,
  story text,
  show_species boolean NOT NULL DEFAULT false,
  show_sex boolean NOT NULL DEFAULT false,
  show_life_stage boolean NOT NULL DEFAULT false,
  show_approximate_size boolean NOT NULL DEFAULT false,
  show_provenance boolean NOT NULL DEFAULT false,
  show_pedigree boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, specimen_key),
  CONSTRAINT showcase_specimen_settings_entity_owner_fkey
    FOREIGN KEY (specimen_key, owner_id, entity_kind)
    REFERENCES public.showcase_entities(public_key, owner_id, entity_kind),
  CONSTRAINT showcase_specimen_settings_canonical_owner_fkey
    FOREIGN KEY (specimen_key, owner_id)
    REFERENCES public.showcase_specimens(specimen_key, owner_id),
  CONSTRAINT showcase_specimen_settings_kind_specimen CHECK (entity_kind = 'specimen'),
  CONSTRAINT showcase_specimen_settings_visibility_closed CHECK (visibility IN ('private', 'public')),
  CONSTRAINT showcase_specimen_settings_name_bounded
    CHECK (public_name IS NULL OR (public_name = btrim(public_name) AND char_length(public_name) BETWEEN 1 AND 80)),
  CONSTRAINT showcase_specimen_settings_story_bounded
    CHECK (story IS NULL OR (char_length(story) BETWEEN 1 AND 2000 AND btrim(story) <> '')),
  CONSTRAINT showcase_specimen_settings_revision_nonnegative CHECK (revision >= 0)
);

CREATE INDEX showcase_specimen_settings_owner_visibility_idx
  ON public.showcase_specimen_settings(owner_id, visibility);

CREATE TABLE public.showcase_specimen_setting_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  specimen_key uuid NOT NULL REFERENCES public.showcase_specimens(specimen_key),
  visibility text NOT NULL,
  public_name text,
  story text,
  show_species boolean NOT NULL,
  show_sex boolean NOT NULL,
  show_life_stage boolean NOT NULL,
  show_approximate_size boolean NOT NULL,
  show_provenance boolean NOT NULL,
  show_pedigree boolean NOT NULL,
  source_revision bigint NOT NULL,
  archive_reason text NOT NULL,
  transfer_evidence_id uuid REFERENCES public.showcase_transfer_evidence(id),
  archived_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_specimen_setting_history_visibility_closed CHECK (visibility IN ('private', 'public')),
  CONSTRAINT showcase_specimen_setting_history_revision_nonnegative CHECK (source_revision >= 0),
  CONSTRAINT showcase_specimen_setting_history_reason_closed CHECK (archive_reason IN ('transfer', 'owner_reset')),
  CONSTRAINT showcase_specimen_setting_history_transfer_required
    CHECK ((archive_reason = 'transfer' AND transfer_evidence_id IS NOT NULL)
      OR (archive_reason <> 'transfer'))
);

CREATE TABLE public.showcase_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'staging',
  source_object_key text NOT NULL,
  decoded_mime text,
  width integer,
  height integer,
  pixel_count bigint,
  byte_size bigint,
  checksum bytea,
  metadata_stripped boolean NOT NULL DEFAULT false,
  alt_text text,
  focal_x double precision,
  focal_y double precision,
  moderation_result jsonb,
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_media_assets_id_owner_key UNIQUE (id, owner_id),
  CONSTRAINT showcase_media_assets_purpose_closed CHECK (purpose IN ('room_hero', 'tank', 'specimen')),
  CONSTRAINT showcase_media_assets_state_closed
    CHECK (state IN ('staging', 'processing', 'approved', 'published', 'revoked', 'deleted', 'rejected')),
  CONSTRAINT showcase_media_assets_source_key_key UNIQUE (source_object_key),
  CONSTRAINT showcase_media_assets_source_key_bounded
    CHECK (source_object_key = btrim(source_object_key) AND char_length(source_object_key) BETWEEN 1 AND 512),
  CONSTRAINT showcase_media_assets_mime_closed
    CHECK (decoded_mime IS NULL OR decoded_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT showcase_media_assets_width_bound CHECK (width IS NULL OR width BETWEEN 1 AND 8192),
  CONSTRAINT showcase_media_assets_height_bound CHECK (height IS NULL OR height BETWEEN 1 AND 8192),
  CONSTRAINT showcase_media_assets_pixel_bound CHECK (pixel_count IS NULL OR pixel_count BETWEEN 1 AND 20000000),
  CONSTRAINT showcase_media_assets_source_size_bound CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 8388608),
  CONSTRAINT showcase_media_assets_checksum_sha256 CHECK (checksum IS NULL OR octet_length(checksum) = 32),
  CONSTRAINT showcase_media_assets_alt_bounded CHECK (alt_text IS NULL OR char_length(alt_text) <= 500),
  CONSTRAINT showcase_media_assets_focal_x_normalized
    CHECK (focal_x IS NULL OR focal_x BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_media_assets_focal_y_normalized
    CHECK (focal_y IS NULL OR focal_y BETWEEN 0::double precision AND 1::double precision),
  CONSTRAINT showcase_media_assets_moderation_bounded
    CHECK (moderation_result IS NULL OR (jsonb_typeof(moderation_result) = 'object'
      AND octet_length(moderation_result::text) <= 65536)),
  CONSTRAINT showcase_media_assets_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT showcase_media_assets_decoded_metadata_coherent
    CHECK ((decoded_mime IS NULL AND width IS NULL AND height IS NULL AND pixel_count IS NULL AND checksum IS NULL)
      OR (decoded_mime IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
        AND pixel_count = width::bigint * height::bigint AND checksum IS NOT NULL))
);

CREATE INDEX showcase_media_assets_owner_state_idx
  ON public.showcase_media_assets(owner_id, state);

CREATE TABLE public.showcase_media_asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  variant text NOT NULL,
  object_key text NOT NULL,
  mime text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  byte_size bigint NOT NULL,
  checksum bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_media_asset_versions_asset_owner_fkey
    FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_media_assets(id, owner_id),
  CONSTRAINT showcase_media_asset_versions_id_asset_owner_key UNIQUE (id, asset_id, owner_id),
  CONSTRAINT showcase_media_asset_versions_asset_variant_key UNIQUE (asset_id, variant),
  CONSTRAINT showcase_media_asset_versions_object_key_key UNIQUE (object_key),
  CONSTRAINT showcase_media_asset_versions_variant_canonical
    CHECK (variant ~ '^[a-z][a-z0-9_-]{0,31}$'),
  CONSTRAINT showcase_media_asset_versions_object_key_bounded
    CHECK (object_key = btrim(object_key) AND char_length(object_key) BETWEEN 1 AND 512),
  CONSTRAINT showcase_media_asset_versions_mime_closed CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT showcase_media_asset_versions_width_bound CHECK (width BETWEEN 1 AND 8192),
  CONSTRAINT showcase_media_asset_versions_height_bound CHECK (height BETWEEN 1 AND 8192),
  CONSTRAINT showcase_media_asset_versions_pixel_bound CHECK (width::bigint * height::bigint <= 20000000),
  CONSTRAINT showcase_media_asset_versions_size_bound CHECK (byte_size BETWEEN 1 AND 4194304),
  CONSTRAINT showcase_media_asset_versions_checksum_sha256 CHECK (octet_length(checksum) = 32)
);

CREATE TABLE public.showcase_media_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  asset_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  parent_kind text NOT NULL,
  parent_key uuid NOT NULL,
  purpose text NOT NULL,
  slot text NOT NULL,
  state text NOT NULL DEFAULT 'private',
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT showcase_media_attachments_asset_owner_fkey
    FOREIGN KEY (asset_id, owner_id)
    REFERENCES public.showcase_media_assets(id, owner_id),
  CONSTRAINT showcase_media_attachments_version_asset_owner_fkey
    FOREIGN KEY (asset_version_id, asset_id, owner_id)
    REFERENCES public.showcase_media_asset_versions(id, asset_id, owner_id),
  CONSTRAINT showcase_media_attachments_parent_kind_closed CHECK (parent_kind IN ('room', 'tank', 'specimen')),
  CONSTRAINT showcase_media_attachments_purpose_closed CHECK (purpose IN ('room_hero', 'tank', 'specimen')),
  CONSTRAINT showcase_media_attachments_slot_closed CHECK (slot IN ('hero', 'primary')),
  CONSTRAINT showcase_media_attachments_state_closed CHECK (state IN ('private', 'published', 'revoked', 'archived')),
  CONSTRAINT showcase_media_attachments_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT showcase_media_attachments_revocation_coherent
    CHECK ((state IN ('revoked', 'archived') AND revoked_at IS NOT NULL)
      OR (state IN ('private', 'published') AND revoked_at IS NULL))
);

CREATE UNIQUE INDEX showcase_media_attachments_one_active_asset_idx
  ON public.showcase_media_attachments(asset_id)
  WHERE state IN ('private', 'published');
CREATE UNIQUE INDEX showcase_media_attachments_one_active_slot_idx
  ON public.showcase_media_attachments(parent_kind, parent_key, slot)
  WHERE state IN ('private', 'published');
CREATE INDEX showcase_media_attachments_parent_idx
  ON public.showcase_media_attachments(parent_kind, parent_key, state);

CREATE TABLE public.showcase_room_slug_history (
  slug text PRIMARY KEY,
  room_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  disposition text NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  tombstoned_at timestamptz,
  CONSTRAINT showcase_room_slug_history_room_owner_fkey
    FOREIGN KEY (room_id, owner_id)
    REFERENCES public.showcase_rooms(id, owner_id),
  CONSTRAINT showcase_room_slug_history_slug_valid CHECK (public.showcase_slug_is_valid(slug)),
  CONSTRAINT showcase_room_slug_history_disposition_closed CHECK (disposition IN ('reserved', 'tombstoned')),
  CONSTRAINT showcase_room_slug_history_tombstone_coherent
    CHECK ((disposition = 'reserved' AND tombstoned_at IS NULL)
      OR (disposition = 'tombstoned' AND tombstoned_at IS NOT NULL))
);

CREATE TABLE public.showcase_tank_slug_history (
  room_id uuid NOT NULL,
  slug text NOT NULL,
  tank_key uuid NOT NULL,
  owner_id uuid NOT NULL,
  disposition text NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  tombstoned_at timestamptz,
  PRIMARY KEY (room_id, slug),
  CONSTRAINT showcase_tank_slug_history_room_owner_fkey
    FOREIGN KEY (room_id, owner_id)
    REFERENCES public.showcase_rooms(id, owner_id),
  CONSTRAINT showcase_tank_slug_history_tank_owner_fkey
    FOREIGN KEY (tank_key, owner_id)
    REFERENCES public.showcase_tanks(tank_key, owner_id),
  CONSTRAINT showcase_tank_slug_history_slug_valid CHECK (public.showcase_slug_is_valid(slug)),
  CONSTRAINT showcase_tank_slug_history_disposition_closed CHECK (disposition IN ('reserved', 'tombstoned')),
  CONSTRAINT showcase_tank_slug_history_tombstone_coherent
    CHECK ((disposition = 'reserved' AND tombstoned_at IS NULL)
      OR (disposition = 'tombstoned' AND tombstoned_at IS NOT NULL))
);

CREATE FUNCTION public.showcase_set_publication_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visibility = 'private' THEN
    NEW.published_at := NULL;
  ELSE
    NEW.published_at := COALESCE(NEW.published_at, now());
    NEW.first_published_at := COALESCE(OLD.first_published_at, NEW.first_published_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_set_publication_timestamps_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.visibility = 'private' THEN
    NEW.published_at := NULL;
    NEW.first_published_at := NULL;
  ELSE
    NEW.published_at := COALESCE(NEW.published_at, now());
    NEW.first_published_at := COALESCE(NEW.first_published_at, NEW.published_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_room_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_room uuid;
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.first_published_at IS NOT NULL AND NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLISHED_SLUG_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.first_published_at IS NOT NULL
     AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
    RAISE EXCEPTION 'SHOWCASE_FIRST_PUBLICATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  SELECT room_id INTO reserved_room
  FROM public.showcase_room_slug_history WHERE slug = NEW.slug;
  IF reserved_room IS NOT NULL AND reserved_room <> NEW.id THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_room_insert_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_room uuid;
BEGIN
  SELECT room_id INTO reserved_room
  FROM public.showcase_room_slug_history WHERE slug = NEW.slug;
  IF reserved_room IS NOT NULL AND reserved_room <> NEW.id THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_reserve_room_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_room uuid;
BEGIN
  IF NEW.first_published_at IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.showcase_room_slug_history (slug, room_id, owner_id)
  VALUES (NEW.slug, NEW.id, NEW.owner_id)
  ON CONFLICT (slug) DO NOTHING;
  SELECT room_id INTO STRICT reserved_room
  FROM public.showcase_room_slug_history WHERE slug = NEW.slug;
  IF reserved_room <> NEW.id THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_room_tank_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_tank uuid;
  reserved_disposition text;
BEGIN
  IF NEW.room_id <> OLD.room_id OR NEW.tank_key <> OLD.tank_key
     OR NEW.owner_id <> OLD.owner_id OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_TANK_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.first_published_at IS NOT NULL AND NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLISHED_SLUG_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.first_published_at IS NOT NULL
     AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
    RAISE EXCEPTION 'SHOWCASE_FIRST_PUBLICATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  SELECT tank_key, disposition INTO reserved_tank, reserved_disposition
  FROM public.showcase_tank_slug_history
  WHERE room_id = NEW.room_id AND slug = NEW.slug
  FOR UPDATE;
  IF reserved_disposition = 'tombstoned'
     OR (reserved_tank IS NOT NULL AND reserved_tank <> NEW.tank_key) THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_room_tank_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_tank uuid;
  reserved_disposition text;
BEGIN
  SELECT tank_key, disposition INTO reserved_tank, reserved_disposition
  FROM public.showcase_tank_slug_history
  WHERE room_id = NEW.room_id AND slug = NEW.slug
  FOR UPDATE;
  IF reserved_disposition = 'tombstoned'
     OR (reserved_tank IS NOT NULL AND reserved_tank <> NEW.tank_key) THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_reserve_tank_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  reserved_tank uuid;
  reserved_disposition text;
BEGIN
  IF NEW.first_published_at IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.showcase_tank_slug_history (room_id, slug, tank_key, owner_id)
  VALUES (NEW.room_id, NEW.slug, NEW.tank_key, NEW.owner_id)
  ON CONFLICT (room_id, slug) DO NOTHING;
  SELECT tank_key, disposition INTO STRICT reserved_tank, reserved_disposition
  FROM public.showcase_tank_slug_history
  WHERE room_id = NEW.room_id AND slug = NEW.slug
  FOR UPDATE;
  IF reserved_disposition = 'tombstoned' OR reserved_tank <> NEW.tank_key THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_LIFETIME_RESERVED' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_tombstone_tank_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.first_published_at IS NOT NULL THEN
    UPDATE public.showcase_tank_slug_history
    SET disposition = 'tombstoned', tombstoned_at = COALESCE(tombstoned_at, now())
    WHERE room_id = OLD.room_id AND slug = OLD.slug AND tank_key = OLD.tank_key;
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.showcase_validate_room_tank_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  room_owner uuid;
  room_schematic jsonb;
BEGIN
  SELECT owner_id, schematic_data INTO STRICT room_owner, room_schematic
  FROM public.showcase_rooms WHERE id = NEW.room_id;
  IF room_owner <> NEW.owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_TANK_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.zone_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(room_schematic->'zones') zone
    WHERE zone->>'id' = NEW.zone_id
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_PLACEMENT_ZONE_NOT_FOUND' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_room_schematic_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.showcase_room_tanks rt
    WHERE rt.room_id = NEW.id AND rt.zone_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.schematic_data->'zones') zone
        WHERE zone->>'id' = rt.zone_id
      )
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_SCHEMATIC_ZONE_IN_USE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_revision_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_specimen_setting_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_id <> OLD.owner_id OR NEW.specimen_key <> OLD.specimen_key
     OR NEW.entity_kind <> OLD.entity_kind OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_SPECIMEN_SETTING_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_specimen_setting_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(current_setting('showcase.transfer_evidence_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_SETTING_DELETE_REQUIRES_TRANSFER' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.showcase_acquire_publication_owner_lock(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_owner_id IS NULL OR NOT pg_try_advisory_xact_lock(
    hashtextextended('showcase-publication-owner:' || p_owner_id::text, 0)
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_PUBLICATION_RETRY_REQUIRED' USING ERRCODE = '40001';
  END IF;
END;
$$;

CREATE FUNCTION public.showcase_serialize_publication_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  old_owner uuid;
  new_owner uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_owner := OLD.owner_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_owner := NEW.owner_id; END IF;

  IF old_owner IS NOT NULL AND new_owner IS NOT NULL AND old_owner <> new_owner THEN
    IF old_owner::text < new_owner::text THEN
      PERFORM public.showcase_acquire_publication_owner_lock(old_owner);
      PERFORM public.showcase_acquire_publication_owner_lock(new_owner);
    ELSE
      PERFORM public.showcase_acquire_publication_owner_lock(new_owner);
      PERFORM public.showcase_acquire_publication_owner_lock(old_owner);
    END IF;
  ELSE
    PERFORM public.showcase_acquire_publication_owner_lock(COALESCE(new_owner, old_owner));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_assert_owner_publication_bounds(p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  placement_count integer;
  total_specimens integer;
  excessive_tank uuid;
BEGIN
  SELECT count(*) INTO placement_count
  FROM public.showcase_room_tanks WHERE owner_id = p_owner_id;
  IF placement_count > 100 THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_TANK_LIMIT' USING ERRCODE = '23514';
  END IF;

  SELECT s.current_tank_key INTO excessive_tank
  FROM public.showcase_specimen_settings ss
  JOIN public.showcase_specimens s
    ON s.specimen_key = ss.specimen_key AND s.owner_id = ss.owner_id
  WHERE ss.owner_id = p_owner_id AND ss.visibility = 'public' AND s.current_tank_key IS NOT NULL
  GROUP BY s.current_tank_key
  HAVING count(*) > 25
  LIMIT 1;
  IF excessive_tank IS NOT NULL THEN
    RAISE EXCEPTION 'SHOWCASE_TANK_SPECIMEN_LIMIT' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO total_specimens
  FROM public.showcase_specimen_settings ss
  JOIN public.showcase_specimens s
    ON s.specimen_key = ss.specimen_key AND s.owner_id = ss.owner_id
  WHERE ss.owner_id = p_owner_id AND ss.visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM public.showcase_room_tanks rt
      WHERE rt.owner_id = p_owner_id AND rt.tank_key = s.current_tank_key
    );
  IF total_specimens > 100 THEN
    RAISE EXCEPTION 'SHOWCASE_ROOM_SPECIMEN_LIMIT' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.showcase_enforce_publication_bounds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.showcase_assert_owner_publication_bounds(OLD.owner_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    PERFORM public.showcase_assert_owner_publication_bounds(OLD.owner_id);
  END IF;
  PERFORM public.showcase_assert_owner_publication_bounds(NEW.owner_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_media_asset_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.purpose <> OLD.purpose
     OR NEW.source_object_key <> OLD.source_object_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_ASSET_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.state IN ('revoked', 'deleted', 'rejected') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_TERMINAL_STATE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_media_asset_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  exact_prefix text;
BEGIN
  exact_prefix := 'owners/' || NEW.owner_id::text || '/assets/' || NEW.id::text || '/source.';
  IF NEW.source_object_key NOT IN (
    exact_prefix || 'jpg', exact_prefix || 'jpeg', exact_prefix || 'png', exact_prefix || 'webp'
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_SOURCE_PATH_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_media_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  exact_prefix text;
BEGIN
  exact_prefix := 'owners/' || NEW.owner_id::text || '/assets/' || NEW.asset_id::text
    || '/versions/' || NEW.id::text || '/' || NEW.variant || '.';
  IF NEW.object_key NOT IN (
    exact_prefix || 'jpg', exact_prefix || 'jpeg', exact_prefix || 'png', exact_prefix || 'webp'
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_VERSION_PATH_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_media_attachment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_owner uuid;
  asset_purpose text;
  asset_state text;
BEGIN
  -- Parent first, then asset: this is the same lock order used by specimen transfer.
  IF NEW.parent_kind = 'room' THEN
    SELECT owner_id INTO STRICT parent_owner
    FROM public.showcase_rooms WHERE id = NEW.parent_key
    FOR KEY SHARE;
    IF NEW.purpose <> 'room_hero' OR NEW.slot <> 'hero' THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PARENT_PURPOSE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.parent_kind = 'tank' THEN
    SELECT owner_id INTO STRICT parent_owner
    FROM public.showcase_tanks WHERE tank_key = NEW.parent_key
    FOR KEY SHARE;
    IF NEW.purpose <> 'tank' OR NEW.slot <> 'primary' THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PARENT_PURPOSE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT owner_id INTO STRICT parent_owner
    FROM public.showcase_specimens WHERE specimen_key = NEW.parent_key
    FOR KEY SHARE;
    IF NEW.purpose <> 'specimen' OR NEW.slot <> 'primary' THEN
      RAISE EXCEPTION 'SHOWCASE_MEDIA_PARENT_PURPOSE_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT purpose, state INTO STRICT asset_purpose, asset_state
  FROM public.showcase_media_assets
  WHERE id = NEW.asset_id AND owner_id = NEW.owner_id
  FOR KEY SHARE;

  IF parent_owner <> NEW.owner_id OR asset_purpose <> NEW.purpose THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_OWNER_OR_PURPOSE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'published' AND asset_state NOT IN ('approved', 'published') THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_NOT_APPROVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_media_attachment_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.asset_id <> OLD.asset_id
     OR NEW.asset_version_id <> OLD.asset_version_id OR NEW.parent_kind <> OLD.parent_kind
     OR NEW.parent_key <> OLD.parent_key OR NEW.purpose <> OLD.purpose OR NEW.slot <> OLD.slot
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_ATTACHMENT_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.state IN ('revoked', 'archived') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'SHOWCASE_MEDIA_ATTACHMENT_TERMINAL' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_slug_history_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) - ARRAY['disposition','tombstoned_at']
     <> to_jsonb(OLD) - ARRAY['disposition','tombstoned_at'] THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_HISTORY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.disposition = 'tombstoned'
     AND (NEW.disposition <> OLD.disposition OR NEW.tombstoned_at IS DISTINCT FROM OLD.tombstoned_at) THEN
    RAISE EXCEPTION 'SHOWCASE_SLUG_TOMBSTONE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER showcase_rooms_validate_insert_slug
  BEFORE INSERT ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_room_insert_slug();
CREATE TRIGGER showcase_rooms_publication_timestamps_insert
  BEFORE INSERT ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_set_publication_timestamps_insert();
CREATE TRIGGER showcase_rooms_guard_update
  BEFORE UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_room_change();
CREATE TRIGGER showcase_rooms_validate_schematic_references
  BEFORE UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_room_schematic_references();
CREATE TRIGGER showcase_rooms_publication_timestamps_update
  BEFORE UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_set_publication_timestamps();
CREATE TRIGGER showcase_rooms_touch
  BEFORE UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_rooms_reserve_slug
  AFTER INSERT OR UPDATE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_reserve_room_slug();
CREATE TRIGGER showcase_rooms_deny_delete
  BEFORE DELETE ON public.showcase_rooms
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_room_tanks_00_serialize
  BEFORE INSERT OR UPDATE OR DELETE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_serialize_publication_mutation();
CREATE TRIGGER showcase_room_tanks_validate_insert
  BEFORE INSERT ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_room_tank_insert();
CREATE TRIGGER showcase_room_tanks_validate_zone
  BEFORE INSERT OR UPDATE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_room_tank_zone();
CREATE TRIGGER showcase_room_tanks_publication_timestamps_insert
  BEFORE INSERT ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_set_publication_timestamps_insert();
CREATE TRIGGER showcase_room_tanks_guard_update
  BEFORE UPDATE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_room_tank_change();
CREATE TRIGGER showcase_room_tanks_publication_timestamps_update
  BEFORE UPDATE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_set_publication_timestamps();
CREATE TRIGGER showcase_room_tanks_touch
  BEFORE UPDATE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_room_tanks_reserve_slug
  AFTER INSERT OR UPDATE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_reserve_tank_slug();
CREATE TRIGGER showcase_room_tanks_tombstone_slug
  BEFORE DELETE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_tombstone_tank_slug();
CREATE TRIGGER showcase_room_tanks_bounds
  AFTER INSERT OR UPDATE OR DELETE ON public.showcase_room_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_enforce_publication_bounds();

CREATE TRIGGER showcase_specimen_settings_00_serialize
  BEFORE INSERT OR UPDATE OR DELETE ON public.showcase_specimen_settings
  FOR EACH ROW EXECUTE FUNCTION public.showcase_serialize_publication_mutation();
CREATE TRIGGER showcase_specimen_settings_guard_update
  BEFORE UPDATE ON public.showcase_specimen_settings
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_specimen_setting_change();
CREATE TRIGGER showcase_specimen_settings_touch
  BEFORE UPDATE ON public.showcase_specimen_settings
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_specimen_settings_guard_delete
  BEFORE DELETE ON public.showcase_specimen_settings
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_specimen_setting_delete();
CREATE TRIGGER showcase_specimen_settings_bounds
  AFTER INSERT OR UPDATE OR DELETE ON public.showcase_specimen_settings
  FOR EACH ROW EXECUTE FUNCTION public.showcase_enforce_publication_bounds();
CREATE TRIGGER showcase_specimen_setting_history_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_specimen_setting_history
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_specimens_00_serialize_publication
  BEFORE UPDATE ON public.showcase_specimens
  FOR EACH ROW EXECUTE FUNCTION public.showcase_serialize_publication_mutation();
CREATE TRIGGER showcase_specimens_publication_bounds
  AFTER UPDATE ON public.showcase_specimens
  FOR EACH ROW EXECUTE FUNCTION public.showcase_enforce_publication_bounds();

CREATE TRIGGER showcase_media_assets_validate_path
  BEFORE INSERT OR UPDATE ON public.showcase_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_media_asset_path();
CREATE TRIGGER showcase_media_assets_guard_update
  BEFORE UPDATE ON public.showcase_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_media_asset_change();
CREATE TRIGGER showcase_media_assets_touch
  BEFORE UPDATE ON public.showcase_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_media_assets_deny_delete
  BEFORE DELETE ON public.showcase_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();
CREATE TRIGGER showcase_media_asset_versions_validate_path
  BEFORE INSERT ON public.showcase_media_asset_versions
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_media_version_path();
CREATE TRIGGER showcase_media_asset_versions_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_media_asset_versions
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_media_attachments_validate
  BEFORE INSERT OR UPDATE ON public.showcase_media_attachments
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_media_attachment();
CREATE TRIGGER showcase_media_attachments_guard_update
  BEFORE UPDATE ON public.showcase_media_attachments
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_media_attachment_change();
CREATE TRIGGER showcase_media_attachments_touch
  BEFORE UPDATE ON public.showcase_media_attachments
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_media_attachments_deny_delete
  BEFORE DELETE ON public.showcase_media_attachments
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_room_slug_history_guard_update
  BEFORE UPDATE ON public.showcase_room_slug_history
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_slug_history_change();
CREATE TRIGGER showcase_room_slug_history_deny_delete
  BEFORE DELETE ON public.showcase_room_slug_history
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();
CREATE TRIGGER showcase_tank_slug_history_guard_update
  BEFORE UPDATE ON public.showcase_tank_slug_history
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_slug_history_change();
CREATE TRIGGER showcase_tank_slug_history_deny_delete
  BEFORE DELETE ON public.showcase_tank_slug_history
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

-- The only specimen-owner transition. Evidence verification/finalization is a separate Tier A server flow.
CREATE FUNCTION public.showcase_transfer_specimen(p_transfer_evidence_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_row public.showcase_transfer_evidence%ROWTYPE;
  specimen_row public.showcase_specimens%ROWTYPE;
  entity_row public.showcase_entities%ROWTYPE;
  ownership_row public.showcase_specimen_ownership%ROWTYPE;
  new_ownership_id uuid;
  transfer_time timestamptz;
BEGIN
  IF p_transfer_evidence_id IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_EVIDENCE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT transfer_row
  FROM public.showcase_transfer_evidence
  WHERE id = p_transfer_evidence_id
  FOR UPDATE;

  IF transfer_row.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'transferEvidenceId', transfer_row.id,
      'specimenKey', transfer_row.specimen_key,
      'fromOwnerId', transfer_row.from_owner_id,
      'toOwnerId', transfer_row.to_owner_id,
      'ownershipId', transfer_row.committed_ownership_id,
      'committed', true,
      'replay', true
    );
  END IF;

  IF transfer_row.finality_state <> 'accepted_final' OR transfer_row.accepted_at IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_NOT_FINAL' USING ERRCODE = '55000';
  END IF;

  IF transfer_row.from_owner_id::text < transfer_row.to_owner_id::text THEN
    PERFORM public.showcase_acquire_publication_owner_lock(transfer_row.from_owner_id);
    PERFORM public.showcase_acquire_publication_owner_lock(transfer_row.to_owner_id);
  ELSE
    PERFORM public.showcase_acquire_publication_owner_lock(transfer_row.to_owner_id);
    PERFORM public.showcase_acquire_publication_owner_lock(transfer_row.from_owner_id);
  END IF;

  PERFORM set_config('showcase.transfer_evidence_id', transfer_row.id::text, true);
  SET CONSTRAINTS showcase_specimens_entity_owner_fkey DEFERRED;

  SELECT * INTO STRICT entity_row
  FROM public.showcase_entities
  WHERE public_key = transfer_row.specimen_key AND entity_kind = 'specimen'
  FOR UPDATE;

  SELECT * INTO STRICT specimen_row
  FROM public.showcase_specimens
  WHERE specimen_key = transfer_row.specimen_key
  FOR UPDATE;

  SELECT * INTO STRICT ownership_row
  FROM public.showcase_specimen_ownership
  WHERE specimen_key = transfer_row.specimen_key AND valid_to IS NULL
  FOR UPDATE;

  IF entity_row.owner_id <> transfer_row.from_owner_id
     OR specimen_row.owner_id <> transfer_row.from_owner_id
     OR ownership_row.owner_id <> transfer_row.from_owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_CURRENT_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF entity_row.identity_state <> 'verified' THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_IDENTITY_NOT_VERIFIED' USING ERRCODE = '55000';
  END IF;

  PERFORM a.id FROM public.showcase_entity_aliases a
  WHERE a.entity_key = transfer_row.specimen_key FOR UPDATE;
  PERFORM c.id FROM public.showcase_alias_claims c
  WHERE c.candidate_entity_key = transfer_row.specimen_key FOR UPDATE;
  PERFORM ic.id
  FROM public.showcase_identity_conflicts ic
  WHERE ic.id IN (
    SELECT ice.conflict_id FROM public.showcase_identity_conflict_entities ice
    WHERE ice.entity_key = transfer_row.specimen_key
    UNION
    SELECT icc.conflict_id
    FROM public.showcase_identity_conflict_claims icc
    JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
    WHERE ac.candidate_entity_key = transfer_row.specimen_key
  )
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.showcase_identity_conflicts ic
    WHERE ic.status = 'open' AND ic.id IN (
      SELECT ice.conflict_id FROM public.showcase_identity_conflict_entities ice
      WHERE ice.entity_key = transfer_row.specimen_key
      UNION
      SELECT icc.conflict_id
      FROM public.showcase_identity_conflict_claims icc
      JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
      WHERE ac.candidate_entity_key = transfer_row.specimen_key
    )
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_OPEN_IDENTITY_CONFLICT' USING ERRCODE = '55000';
  END IF;

  PERFORM r.id FROM public.showcase_rooms r
  WHERE r.owner_id = transfer_row.from_owner_id FOR UPDATE;
  PERFORM rt.room_id FROM public.showcase_room_tanks rt
  WHERE rt.owner_id = transfer_row.from_owner_id
    AND (rt.tank_key = specimen_row.current_tank_key OR specimen_row.current_tank_key IS NULL)
  FOR UPDATE;
  PERFORM ss.specimen_key FROM public.showcase_specimen_settings ss
  WHERE ss.owner_id = transfer_row.from_owner_id
    AND ss.specimen_key = transfer_row.specimen_key
  FOR UPDATE;
  PERFORM ma.id
  FROM public.showcase_media_attachments ma
  WHERE ma.owner_id = transfer_row.from_owner_id
    AND ma.parent_kind = 'specimen'
    AND ma.parent_key = transfer_row.specimen_key
  FOR UPDATE;
  PERFORM asset.id
  FROM public.showcase_media_assets asset
  WHERE asset.id IN (
    SELECT ma.asset_id FROM public.showcase_media_attachments ma
    WHERE ma.owner_id = transfer_row.from_owner_id
      AND ma.parent_kind = 'specimen'
      AND ma.parent_key = transfer_row.specimen_key
  )
  FOR UPDATE;
  PERFORM pi.id FROM public.showcase_projection_invalidations pi
  WHERE pi.owner_id IN (transfer_row.from_owner_id, transfer_row.to_owner_id)
  FOR UPDATE;

  INSERT INTO public.showcase_specimen_setting_history (
    owner_id, specimen_key, visibility, public_name, story,
    show_species, show_sex, show_life_stage, show_approximate_size,
    show_provenance, show_pedigree, source_revision,
    archive_reason, transfer_evidence_id
  )
  SELECT owner_id, specimen_key, visibility, public_name, story,
    show_species, show_sex, show_life_stage, show_approximate_size,
    show_provenance, show_pedigree, revision,
    'transfer', transfer_row.id
  FROM public.showcase_specimen_settings
  WHERE owner_id = transfer_row.from_owner_id
    AND specimen_key = transfer_row.specimen_key;

  DELETE FROM public.showcase_specimen_settings
  WHERE owner_id = transfer_row.from_owner_id
    AND specimen_key = transfer_row.specimen_key;

  UPDATE public.showcase_media_attachments
  SET state = 'archived', revoked_at = now(), revision = revision + 1
  WHERE owner_id = transfer_row.from_owner_id
    AND parent_kind = 'specimen'
    AND parent_key = transfer_row.specimen_key
    AND state IN ('private', 'published');

  UPDATE public.showcase_media_assets asset
  SET state = 'revoked', revision = revision + 1
  WHERE asset.owner_id = transfer_row.from_owner_id
    AND asset.state IN ('approved', 'published')
    AND EXISTS (
      SELECT 1 FROM public.showcase_media_attachments ma
      WHERE ma.asset_id = asset.id
        AND ma.parent_kind = 'specimen'
        AND ma.parent_key = transfer_row.specimen_key
    );

  transfer_time := GREATEST(clock_timestamp(), ownership_row.valid_from + interval '1 microsecond');

  UPDATE public.showcase_specimen_ownership
  SET valid_to = transfer_time
  WHERE id = ownership_row.id;

  UPDATE public.showcase_entities
  SET owner_id = transfer_row.to_owner_id, revision = revision + 1
  WHERE public_key = transfer_row.specimen_key AND entity_kind = 'specimen';

  UPDATE public.showcase_specimens
  SET current_tank_key = NULL, owner_id = transfer_row.to_owner_id
  WHERE specimen_key = transfer_row.specimen_key;

  INSERT INTO public.showcase_specimen_ownership (
    specimen_key, owner_id, valid_from, evidence_kind, evidence_reference,
    finality_state, transfer_evidence_id
  ) VALUES (
    transfer_row.specimen_key, transfer_row.to_owner_id, transfer_time,
    transfer_row.evidence_kind, transfer_row.evidence_reference,
    'accepted_final', transfer_row.id
  ) RETURNING id INTO new_ownership_id;

  INSERT INTO public.showcase_projection_invalidations
    (owner_id, entity_key, reason, transfer_evidence_id)
  VALUES
    (transfer_row.from_owner_id, transfer_row.specimen_key, 'transfer', transfer_row.id),
    (transfer_row.to_owner_id, transfer_row.specimen_key, 'transfer', transfer_row.id);

  UPDATE public.showcase_transfer_evidence
  SET processed_at = transfer_time, committed_ownership_id = new_ownership_id
  WHERE id = transfer_row.id;

  RETURN jsonb_build_object(
    'transferEvidenceId', transfer_row.id,
    'specimenKey', transfer_row.specimen_key,
    'fromOwnerId', transfer_row.from_owner_id,
    'toOwnerId', transfer_row.to_owner_id,
    'ownershipId', new_ownership_id,
    'committed', true,
    'replay', false
  );
END;
$$;

ALTER FUNCTION public.showcase_transfer_specimen(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.showcase_transfer_specimen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_transfer_specimen(uuid) TO service_role;

DO $showcase_publication_rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'showcase_rooms', 'showcase_room_tanks', 'showcase_specimen_settings',
    'showcase_specimen_setting_history', 'showcase_media_assets',
    'showcase_media_asset_versions', 'showcase_media_attachments',
    'showcase_room_slug_history', 'showcase_tank_slug_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
  END LOOP;
END;
$showcase_publication_rls$;

REVOKE ALL ON FUNCTION public.showcase_slug_is_valid(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_schematic_is_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_set_publication_timestamps() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_set_publication_timestamps_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_room_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_room_insert_slug() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_reserve_room_slug() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_room_tank_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_room_tank_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_reserve_tank_slug() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_tombstone_tank_slug() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_room_tank_zone() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_room_schematic_references() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_revision_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_specimen_setting_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_specimen_setting_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_acquire_publication_owner_lock(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_serialize_publication_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_assert_owner_publication_bounds(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_enforce_publication_bounds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_media_asset_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_media_asset_path() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_media_version_path() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_media_attachment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_media_attachment_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_slug_history_change() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
