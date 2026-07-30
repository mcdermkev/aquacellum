-- ============================================================================
-- Certificate metadata document hosting (docs/BREEDER_STATE_MODEL.md §4.3, §9.19)
--
-- Backs services/specimenMetadata.js `publishSpecimenMetadata` /
-- `publicMetadataUri` / `retryPendingMetadataPublishes`.
--
-- WHY THIS BUCKET EXISTS: `AquadexManager.tokenURI(tokenId)` returns
-- `specimens[tokenId].ipfsMetadataUri` verbatim — that field IS the certificate's
-- ERC-721 metadata claim, read by any external wallet, explorer, or marketplace.
-- The app used to write fabricated `ipfs://` identifiers there (one hardcoded and
-- identical across every registration, one built with Math.random() per spawn
-- offspring). Nothing was pinned; both resolved to nothing. This bucket is where
-- the document actually lives now, so the URI resolves.
--
-- WHY NOT IPFS: §9.19 was resolved as option (c). Pinata is the project's IPFS
-- provider for seeding but has no credentials provisioned for the app, and adding
-- a pin call would put a network round-trip and a new failure mode on a
-- certificate write path that is deliberately local-first and fire-and-forget.
-- This reuses storage the project already runs (the sibling `specimen-photos`
-- bucket) and needs no new provider. Stated plainly: this is centralized and
-- mutable, so it is provenance HOSTING, not provenance PROOF. Moving to IPFS
-- later changes only which URI `publicMetadataUri` returns.
--
-- WHY THE PATH IS DETERMINISTIC: `<owner_wallet_lowercase>/<serial>.json`, with
-- no timestamp or hash. Two properties depend on it:
--   1. The public URL is computable WITHOUT a network call, so it can be written
--      on-chain before the upload completes — which is what keeps certificate
--      creation non-blocking.
--   2. A failed upload is retryable to the exact same URL, so the on-chain value
--      never needs to change.
-- The owner prefix is also required for uniqueness: serials are per-device
-- sequential, so two breeders both have specimen #1.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'specimen-metadata',
  'specimen-metadata',
  true,                        -- public read: tokenURI must resolve for anyone
  262144,                      -- 256KB — a metadata document, never an image
  ARRAY['application/json']
)
ON CONFLICT (id) DO NOTHING;

-- ─── Policies ───────────────────────────────────────────────────────────────
-- Idempotent (DROP IF EXISTS first), matching 20260701_specimen_photo_storage.sql.

-- READ: public. This is the whole point — an external viewer resolving tokenURI
-- has no session and must still be able to fetch the document.
DROP POLICY IF EXISTS "Public read access for specimen metadata" ON storage.objects;
CREATE POLICY "Public read access for specimen metadata"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'specimen-metadata');

-- WRITE: only under your own wallet prefix.
--
-- Deliberately STRICTER than the sibling specimen-photos bucket, which matches
-- only the first 10 characters of the header address. A metadata document is the
-- content behind an on-chain provenance claim, so a prefix collision must not be
-- enough to overwrite someone else's. This compares the FULL folder name against
-- the caller's wallet, preferring the minted JWT's `wallet_address` claim and
-- falling back to the `x-wallet-address` header — the same two identity sources
-- documented in services/supabaseClient.js and used by
-- 20260729_spawn_growout_sync.sql.
--
-- The header fallback is not a hard security boundary (a caller can set a
-- header); it exists because the JWT bridge is best-effort by design and the
-- alternative is silently losing every write when minting a session fails. The
-- blast radius is bounded: a forged header can overwrite another breeder's
-- metadata document, but it cannot alter the on-chain certificate, its ownership,
-- or any money. Tightening this to JWT-only is tracked in BREEDER_STATE_MODEL
-- §9.20 alongside the wider RLS audit (§9.5).
DROP POLICY IF EXISTS "Breeders write their own specimen metadata" ON storage.objects;
CREATE POLICY "Breeders write their own specimen metadata"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'specimen-metadata'
    AND (storage.foldername(name))[1] = lower(coalesce(
      nullif(current_setting('request.jwt.claims', true)::json->>'wallet_address', ''),
      nullif(current_setting('request.headers', true)::json->>'x-wallet-address', '')
    ))
  );

-- UPDATE: same ownership rule. Needed because `publishSpecimenMetadata` upserts —
-- a retry must be able to re-publish to the already-committed URL.
DROP POLICY IF EXISTS "Breeders update their own specimen metadata" ON storage.objects;
CREATE POLICY "Breeders update their own specimen metadata"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'specimen-metadata'
    AND (storage.foldername(name))[1] = lower(coalesce(
      nullif(current_setting('request.jwt.claims', true)::json->>'wallet_address', ''),
      nullif(current_setting('request.headers', true)::json->>'x-wallet-address', '')
    ))
  );

-- No DELETE policy. A certificate's metadata document is the content behind a
-- permanent on-chain pointer; removing it would turn a resolving tokenURI into a
-- dead one, which is the exact failure this work set out to fix. Consistent with
-- §4.1 — a certificate is never destroyed.

-- ============================================================================
-- Done. `tokenURI` now resolves to a real document for every certificate
-- registered while storage is configured.
-- ============================================================================
