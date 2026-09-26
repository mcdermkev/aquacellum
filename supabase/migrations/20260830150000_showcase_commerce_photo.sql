-- Fish Room R1.4 (P2) follow-up — surface the linked listing's photo in the tank commerce snapshot.
--
-- The listing's photoUrl is ALREADY public data (it is in the aquadex_listings_public allowlist and
-- rendered on the marketplace today), so exposing it through the showcase commerce snapshot is
-- consistent and is NOT showcase-media (the projection's own `media` slot stays NULL — that remains
-- gated behind the R1.0 §8 processing pipeline). This lets a tub linked to a buyable pack show that
-- pack's product photo as its hero image now, without the heavyweight media system.
--
-- Additive: CREATE OR REPLACE of the resolver only (the two projection functions call it unchanged),
-- which preserves the function's existing ownership and ACL. Registered after 20260830140000.

BEGIN;

CREATE OR REPLACE FUNCTION public.showcase_resolve_tank_commerce(p_owner_id uuid, p_listing_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_batch boolean;
  v_id text;
  listing_row record;
  data_obj jsonb;
  pack_size integer;
  price_cents bigint;
  fulfillment text;
  photo_url text;
BEGIN
  IF p_owner_id IS NULL OR p_listing_key IS NULL
     OR p_listing_key !~ '^(single|batch)-[1-9][0-9]*$' THEN
    RETURN NULL;
  END IF;
  v_is_batch := split_part(p_listing_key, '-', 1) = 'batch';
  v_id := split_part(p_listing_key, '-', 2);

  SELECT l.id, l.is_batch, l.seller_address, l.data
    INTO listing_row
  FROM public.aquadex_listings l
  WHERE l.id = v_id
    AND l.is_batch = v_is_batch
    AND l.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.showcase_owner_wallets w
      WHERE w.owner_id = p_owner_id
        AND w.revoked_at IS NULL
        AND w.normalized_wallet_address = lower(l.seller_address)
    );
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  data_obj := CASE jsonb_typeof(listing_row.data)
    WHEN 'string' THEN (listing_row.data #>> '{}')::jsonb
    WHEN 'object' THEN listing_row.data
    ELSE '{}'::jsonb
  END;

  IF v_is_batch THEN
    pack_size := CASE WHEN (data_obj->>'quantity') ~ '^[0-9]+$'
      THEN LEAST((data_obj->>'quantity')::bigint, 2147483647)::integer ELSE NULL END;
  ELSE
    pack_size := 1;
  END IF;

  price_cents := CASE WHEN (data_obj->>'priceCentsUSD') ~ '^[0-9]+$'
    THEN (data_obj->>'priceCentsUSD')::bigint ELSE NULL END;

  fulfillment := CASE
    WHEN (data_obj->>'isShipping') = 'true' THEN 'shipping'
    WHEN (data_obj->>'localPickup') = 'true' THEN 'pickup'
    ELSE 'ask'
  END;

  -- Only surface an http(s) image URL; anything else (javascript:, data:, malformed) is dropped.
  -- Length + whitespace are checked separately so the regex stays within Postgres's repetition limit.
  photo_url := CASE
    WHEN (data_obj->>'photoUrl') IS NOT NULL
     AND char_length(data_obj->>'photoUrl') BETWEEN 8 AND 2048
     AND (data_obj->>'photoUrl') ~* '^https?://'
     AND (data_obj->>'photoUrl') !~ '[[:space:]]'
    THEN data_obj->>'photoUrl' ELSE NULL END;

  RETURN jsonb_build_object(
    'listingKey', p_listing_key,
    'isBatch', v_is_batch,
    'packSize', pack_size,
    'priceCents', price_cents,
    'price', data_obj->>'price',
    'fulfillment', fulfillment,
    'photoUrl', photo_url,
    'buyPath', '/app/products/' || p_listing_key
  );
END;
$$;

COMMIT;
