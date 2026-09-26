-- Owner-authenticated preview of processed room-hero derivatives.
--
-- This is deliberately separate from anonymous publication. It authorizes only an exact
-- owner/room/upload-intent/asset/version binding while the room is private and the asset remains
-- approved (processed, metadata-stripped, and not yet published). The trusted API revalidates the
-- returned key/metadata and streams bytes with private, no-store headers; no key reaches a browser.
BEGIN;

CREATE FUNCTION public.showcase_authorize_owner_media_preview(
  p_owner_id uuid, p_room_id uuid, p_asset_id uuid, p_variant text
)
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
  FROM public.showcase_rooms r
  JOIN public.showcase_media_upload_intents ui
    ON ui.owner_id = r.owner_id AND ui.room_id = r.id
    AND ui.asset_id = p_asset_id AND ui.state = 'finalized'
  JOIN public.showcase_media_assets a
    ON a.id = ui.asset_id AND a.owner_id = ui.owner_id
  JOIN public.showcase_media_asset_versions v
    ON v.asset_id = a.id AND v.owner_id = a.owner_id AND v.variant = p_variant
  WHERE p_owner_id IS NOT NULL AND p_room_id IS NOT NULL AND p_asset_id IS NOT NULL
    AND p_variant IN ('hero', 'thumb')
    AND r.id = p_room_id AND r.owner_id = p_owner_id AND r.visibility = 'private'
    AND a.purpose = 'room_hero' AND a.state = 'approved'
    AND a.metadata_stripped IS TRUE
    AND v.mime = 'image/webp' AND v.byte_size BETWEEN 1 AND 4194304
    AND octet_length(v.checksum) = 32
    AND v.object_key = 'owners/' || p_owner_id::text || '/assets/' || p_asset_id::text
      || '/versions/' || v.id::text || '/' || p_variant || '.webp'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.showcase_authorize_owner_media_preview(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.showcase_authorize_owner_media_preview(uuid,uuid,uuid,text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.showcase_authorize_owner_media_preview(uuid,uuid,uuid,text)
  TO service_role;

COMMIT;
