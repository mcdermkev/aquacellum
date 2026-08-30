-- S2 authenticated cart-linking: durable idempotency plus one serialized merge.
-- api/cart.js derives wallet_address from a verified Privy token and is the
-- only caller. The RPC is service-role-only; browser roles cannot select the
-- ledger or choose another wallet.

ALTER TABLE canonical_carts
  ADD COLUMN IF NOT EXISTS last_merge_operation_id TEXT,
  ADD COLUMN IF NOT EXISTS last_merge_result JSONB,
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS canonical_cart_merge_operations (
  wallet_address TEXT NOT NULL,
  operation_id TEXT NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 120),
  request_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_resolution', 'completed')),
  resolution TEXT CHECK (resolution IN ('account', 'guest')),
  reviewed_account_revision BIGINT CHECK (reviewed_account_revision >= 0),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (wallet_address, operation_id)
);

ALTER TABLE canonical_cart_merge_operations
  ADD COLUMN IF NOT EXISTS reviewed_account_revision BIGINT
    CHECK (reviewed_account_revision >= 0);

ALTER TABLE canonical_cart_merge_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role full access on canonical_cart_merge_operations"
  ON canonical_cart_merge_operations;
CREATE POLICY "service_role full access on canonical_cart_merge_operations"
  ON canonical_cart_merge_operations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Normalize every persisted row from server-resolved contract state. Missing
-- keys stay visible but unavailable; client seller and availability snapshots
-- never authorize the resulting account cart.
CREATE OR REPLACE FUNCTION normalize_canonical_cart_items(
  p_items JSONB,
  p_authoritative_listings JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_auth JSONB;
  v_result JSONB := '[]'::jsonb;
  v_key TEXT;
  v_seller TEXT;
  v_active BOOLEAN;
  v_is_batch BOOLEAN;
  v_available NUMERIC;
  v_requested NUMERIC;
  v_quantity INTEGER;
  v_snapshot JSONB;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_result;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_key := v_item->>'listingKey';
    v_auth := CASE WHEN v_key IS NULL THEN NULL ELSE p_authoritative_listings->v_key END;

    IF v_auth IS NULL THEN
      v_item := v_item || jsonb_build_object(
        'seller', NULL,
        'unavailable', TRUE
      );
    ELSE
      v_seller := NULLIF(lower(trim(v_auth->>'seller')), '');
      v_active := COALESCE((v_auth->>'active')::boolean, FALSE);
      v_is_batch := COALESCE((v_auth->>'isBatch')::boolean, FALSE);
      v_available := CASE
        WHEN COALESCE(v_auth->>'availableQuantity', '') ~ '^\d+(\.\d+)?$'
          THEN floor((v_auth->>'availableQuantity')::numeric)
        ELSE 0
      END;
      v_requested := CASE
        WHEN COALESCE(v_item->>'quantity', '') ~ '^\d+$'
          THEN (v_item->>'quantity')::numeric
        ELSE 1
      END;
      v_quantity := CASE
        WHEN v_is_batch THEN LEAST(GREATEST(v_requested, 1), GREATEST(v_available, 1))::integer
        ELSE 1
      END;
      v_snapshot := COALESCE(v_item->'snapshot', '{}'::jsonb)
        || jsonb_build_object('quantityAvailable', CASE WHEN v_is_batch THEN v_available ELSE 1 END);
      v_item := v_item || jsonb_build_object(
        'listingKey', v_key,
        'seller', v_seller,
        'isBatch', v_is_batch,
        'quantity', v_quantity,
        'snapshot', v_snapshot,
        'unavailable', (NOT v_active OR v_seller IS NULL OR v_available < 1)
      );
    END IF;

    v_result := v_result || jsonb_build_array(v_item);
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION canonical_cart_seller(p_items JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_seller TEXT;
BEGIN
  SELECT count(DISTINCT lower(value->>'seller')), min(lower(value->>'seller'))
    INTO v_count, v_seller
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
   WHERE NULLIF(value->>'seller', '') IS NOT NULL
     AND COALESCE((value->>'unavailable')::boolean, FALSE) = FALSE;
  IF v_count > 1 THEN RETURN '__multiple__'; END IF;
  RETURN v_seller;
END;
$$;

DROP FUNCTION IF EXISTS merge_canonical_cart(TEXT, TEXT, JSONB, BIGINT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION merge_canonical_cart(
  p_wallet TEXT,
  p_operation_id TEXT,
  p_guest_items JSONB,
  p_guest_updated_at BIGINT,
  p_resolution TEXT,
  p_reviewed_account_revision BIGINT,
  p_authoritative_listings JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet TEXT := lower(trim(p_wallet));
  v_request JSONB;
  v_operation canonical_cart_merge_operations%ROWTYPE;
  v_cart canonical_carts%ROWTYPE;
  v_base JSONB;
  v_guest JSONB;
  v_final JSONB;
  v_map JSONB := '{}'::jsonb;
  v_item JSONB;
  v_existing JSONB;
  v_auth JSONB;
  v_key TEXT;
  v_base_seller TEXT;
  v_guest_seller TEXT;
  v_final_seller TEXT;
  v_kept TEXT;
  v_discarded_seller TEXT;
  v_cap INTEGER;
  v_quantity INTEGER;
  v_result JSONB;
BEGIN
  IF v_wallet = '' OR p_operation_id IS NULL
     OR char_length(p_operation_id) NOT BETWEEN 8 AND 120
     OR p_guest_updated_at IS NULL OR p_guest_updated_at <= 0
     OR jsonb_typeof(p_guest_items) <> 'array'
     OR jsonb_array_length(p_guest_items) > 200
     OR (p_resolution IS NOT NULL AND p_resolution NOT IN ('account', 'guest'))
     OR (p_resolution IS NULL AND p_reviewed_account_revision IS NOT NULL)
     OR (p_resolution IS NOT NULL AND (
       p_reviewed_account_revision IS NULL OR p_reviewed_account_revision < 0
     ))
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(p_guest_items) AS entry
        WHERE jsonb_typeof(entry) <> 'object'
           OR COALESCE(entry->>'listingKey', '') !~ '^(single|batch)-[1-9][0-9]*$'
           OR COALESCE(entry->>'quantity', '') !~ '^[1-9][0-9]*$'
           OR (entry->>'listingKey' LIKE 'single-%' AND entry->>'quantity' <> '1')
     )
     OR (
       SELECT count(*) <> count(DISTINCT entry->>'listingKey')
         FROM jsonb_array_elements(p_guest_items) AS entry
     ) THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'invalid_cart', 'error', 'Invalid cart merge request');
  END IF;

  -- Serialize all account-link operations, including the first operation for a
  -- wallet with no canonical_carts row yet.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_wallet, 0));

  -- Idempotency is keyed only by immutable merge intent. Display metadata may
  -- be refreshed between retries, and input order is not semantically relevant.
  -- This shape matches cartStore.js: canonical listing key, numeric quantity,
  -- deterministic key order, and the one validated guest-cart timestamp.
  SELECT jsonb_build_object(
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'listingKey', entry->>'listingKey',
          'quantity', (entry->>'quantity')::numeric
        ) ORDER BY (entry->>'listingKey') COLLATE "C"
      ),
      '[]'::jsonb
    ),
    'updatedAt', p_guest_updated_at
  )
    INTO v_request
    FROM jsonb_array_elements(p_guest_items) AS entry;

  SELECT * INTO v_operation
    FROM canonical_cart_merge_operations
   WHERE wallet_address = v_wallet AND operation_id = p_operation_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_operation.request_payload <> v_request THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'operation_mismatch',
        'error', 'This merge operation was already used for a different cart'
      );
    END IF;
    IF v_operation.status = 'completed' THEN
      -- A completed immutable operation is authoritative even if an ambiguous
      -- response led the client to click the opposite choice on retry. Replaying
      -- the committed cart lets the client clear its preserved guest copy;
      -- rejecting and rotating the operation would merge batch quantities twice.
      SELECT * INTO v_cart FROM canonical_carts WHERE wallet_address = v_wallet;
      RETURN jsonb_build_object(
        'success', TRUE,
        'sellerWallet', v_cart.seller_wallet,
        'items', COALESCE(v_cart.items, '[]'::jsonb),
        'updatedAt', v_cart.updated_at,
        'revision', v_cart.revision,
        'idempotentReplay', TRUE,
        'committedResolution', v_operation.resolution,
        'decisionMismatch', p_resolution IS NOT NULL AND (
          v_operation.resolution IS DISTINCT FROM p_resolution
          OR v_operation.reviewed_account_revision IS DISTINCT FROM p_reviewed_account_revision
        )
      ) || COALESCE(v_operation.result, '{}'::jsonb);
    END IF;
    IF p_resolution IS NOT NULL AND v_operation.status <> 'awaiting_resolution' THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'operation_mismatch',
        'error', 'This merge operation is not awaiting a cart choice'
      );
    END IF;
  ELSE
    IF p_resolution IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'operation_mismatch',
        'error', 'Review both carts before choosing which cart to keep'
      );
    END IF;
    INSERT INTO canonical_cart_merge_operations (
      wallet_address, operation_id, request_payload, status
    ) VALUES (
      v_wallet, p_operation_id, v_request, 'pending'
    ) RETURNING * INTO v_operation;
  END IF;

  INSERT INTO canonical_carts (wallet_address, seller_wallet, items)
  VALUES (v_wallet, NULL, '[]'::jsonb)
  ON CONFLICT (wallet_address) DO NOTHING;

  SELECT * INTO v_cart
    FROM canonical_carts
   WHERE wallet_address = v_wallet
   FOR UPDATE;

  -- A cart choice authorizes only the account snapshot the user reviewed.
  -- This comparison occurs under the same wallet lock as PUT replacement and
  -- before any cart/ledger mutation, so a newer device edit is never discarded.
  IF p_resolution IS NOT NULL AND v_cart.revision <> p_reviewed_account_revision THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'seller_conflict',
      'reason', 'account_revision_changed',
      'error', 'Your account cart changed. Review both carts again.',
      'accountCart', jsonb_build_object(
        'sellerWallet', v_cart.seller_wallet,
        'items', COALESCE(v_cart.items, '[]'::jsonb),
        'updatedAt', v_cart.updated_at,
        'revision', v_cart.revision
      )
    );
  END IF;

  -- The contract snapshot is resolved outside Postgres. If another request
  -- introduced a key after that snapshot, fail without mutating; the caller
  -- retries with a fresh preview rather than degrading the new row.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(v_cart.items, '[]'::jsonb)) AS entry
     WHERE entry->>'listingKey' IS NULL
        OR NOT (p_authoritative_listings ? (entry->>'listingKey'))
  ) THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'catalog_retry',
      'error', 'Cart changed while live availability was checked'
    );
  END IF;

  v_base := normalize_canonical_cart_items(v_cart.items, p_authoritative_listings);
  v_guest := normalize_canonical_cart_items(p_guest_items, p_authoritative_listings);
  v_base_seller := canonical_cart_seller(v_base);
  v_guest_seller := canonical_cart_seller(v_guest);

  IF v_base_seller = '__multiple__' OR v_guest_seller = '__multiple__' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'invalid_cart',
      'error', 'Cart items must all belong to one verified seller'
    );
  END IF;

  IF jsonb_array_length(v_base) > 0
     AND jsonb_array_length(v_guest) > 0
     AND v_base_seller IS NOT NULL
     AND v_guest_seller IS NOT NULL
     AND v_base_seller <> v_guest_seller
     AND p_resolution IS NULL THEN
    UPDATE canonical_cart_merge_operations
       SET status = 'awaiting_resolution', updated_at = NOW()
     WHERE wallet_address = v_wallet AND operation_id = p_operation_id;
    RETURN jsonb_build_object(
      'success', FALSE,
      'code', 'seller_conflict',
      'error', 'Choose which seller cart to keep',
      'accountCart', jsonb_build_object(
        'sellerWallet', v_base_seller,
        'items', v_base,
        'updatedAt', v_cart.updated_at,
        'revision', v_cart.revision
      )
    );
  END IF;

  IF p_resolution = 'account' THEN
    v_final := v_base;
    v_final_seller := v_base_seller;
    v_kept := 'base';
    v_discarded_seller := v_guest_seller;
  ELSIF p_resolution = 'guest' THEN
    v_final := v_guest;
    v_final_seller := v_guest_seller;
    v_kept := 'incoming';
    v_discarded_seller := v_base_seller;
  ELSE
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_base)
    LOOP
      v_key := v_item->>'listingKey';
      IF v_key IS NOT NULL THEN
        v_map := jsonb_set(v_map, ARRAY[v_key], v_item, TRUE);
      END IF;
    END LOOP;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_guest)
    LOOP
      v_key := v_item->>'listingKey';
      IF v_key IS NULL THEN CONTINUE; END IF;
      v_existing := v_map->v_key;
      IF v_existing IS NULL THEN
        v_map := jsonb_set(v_map, ARRAY[v_key], v_item, TRUE);
      ELSE
        v_auth := p_authoritative_listings->v_key;
        v_cap := CASE
          WHEN COALESCE(v_auth->>'availableQuantity', '') ~ '^\d+$'
            THEN GREATEST((v_auth->>'availableQuantity')::integer, 1)
          ELSE 1
        END;
        v_quantity := CASE
          WHEN COALESCE((v_auth->>'isBatch')::boolean, FALSE)
            THEN LEAST(
              v_cap,
              COALESCE((v_existing->>'quantity')::integer, 1)
                + COALESCE((v_item->>'quantity')::integer, 1)
            )
          ELSE 1
        END;
        v_existing := v_existing || jsonb_build_object('quantity', v_quantity);
        v_map := jsonb_set(v_map, ARRAY[v_key], v_existing, TRUE);
      END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(value ORDER BY key), '[]'::jsonb)
      INTO v_final
      FROM jsonb_each(v_map);
    v_final_seller := COALESCE(v_base_seller, v_guest_seller);
    v_kept := CASE
      WHEN jsonb_array_length(v_base) = 0 THEN 'incoming'
      WHEN jsonb_array_length(v_guest) = 0 THEN 'base'
      ELSE 'merged'
    END;
    v_discarded_seller := NULL;
  END IF;

  v_result := jsonb_build_object(
    'kept', v_kept,
    'discardedSeller', v_discarded_seller
  );

  UPDATE canonical_carts
     SET seller_wallet = v_final_seller,
         items = COALESCE(v_final, '[]'::jsonb),
         last_merge_operation_id = p_operation_id,
         last_merge_result = v_result,
         revision = revision + 1,
         updated_at = NOW()
   WHERE wallet_address = v_wallet
   RETURNING * INTO v_cart;

  UPDATE canonical_cart_merge_operations
     SET status = 'completed',
         resolution = p_resolution,
         reviewed_account_revision = p_reviewed_account_revision,
         result = v_result,
         updated_at = NOW(),
         completed_at = NOW()
   WHERE wallet_address = v_wallet AND operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'sellerWallet', v_cart.seller_wallet,
    'items', v_cart.items,
    'updatedAt', v_cart.updated_at,
    'revision', v_cart.revision
  ) || v_result;
END;
$$;

REVOKE ALL ON FUNCTION normalize_canonical_cart_items(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION canonical_cart_seller(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION merge_canonical_cart(TEXT, TEXT, JSONB, BIGINT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_canonical_cart(TEXT, TEXT, JSONB, BIGINT, TEXT, BIGINT, JSONB) TO service_role;


-- Every authenticated cart replacement shares the merge wallet lock and uses
-- compare-and-set revisioning. A stale tab/device can never overwrite a merge
-- that already committed and caused the merging client to clear its guest cart.
CREATE OR REPLACE FUNCTION replace_canonical_cart(
  p_wallet TEXT,
  p_items JSONB,
  p_seller_wallet TEXT,
  p_expected_revision BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet TEXT := lower(trim(p_wallet));
  v_cart canonical_carts%ROWTYPE;
BEGIN
  IF v_wallet = ''
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) > 200 THEN
    RETURN jsonb_build_object('success', FALSE, 'code', 'invalid_cart', 'error', 'Invalid cart replacement');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_wallet, 0));

  SELECT * INTO v_cart
    FROM canonical_carts
   WHERE wallet_address = v_wallet
   FOR UPDATE;

  IF FOUND THEN
    IF v_cart.revision <> p_expected_revision THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'revision_conflict',
        'error', 'Cart changed on another device',
        'sellerWallet', v_cart.seller_wallet,
        'items', COALESCE(v_cart.items, '[]'::jsonb),
        'updatedAt', v_cart.updated_at,
        'revision', v_cart.revision
      );
    END IF;

    UPDATE canonical_carts
       SET seller_wallet = NULLIF(lower(trim(p_seller_wallet)), ''),
           items = p_items,
           revision = revision + 1,
           updated_at = NOW()
     WHERE wallet_address = v_wallet
     RETURNING * INTO v_cart;
  ELSE
    IF p_expected_revision <> 0 THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'code', 'revision_conflict',
        'error', 'Cart changed on another device',
        'sellerWallet', NULL,
        'items', '[]'::jsonb,
        'updatedAt', NULL,
        'revision', 0
      );
    END IF;

    INSERT INTO canonical_carts (
      wallet_address, seller_wallet, items, revision, updated_at
    ) VALUES (
      v_wallet, NULLIF(lower(trim(p_seller_wallet)), ''), p_items, 1, NOW()
    ) RETURNING * INTO v_cart;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'sellerWallet', v_cart.seller_wallet,
    'items', v_cart.items,
    'updatedAt', v_cart.updated_at,
    'revision', v_cart.revision
  );
END;
$$;

REVOKE ALL ON FUNCTION replace_canonical_cart(TEXT, JSONB, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_canonical_cart(TEXT, JSONB, TEXT, BIGINT) TO service_role;