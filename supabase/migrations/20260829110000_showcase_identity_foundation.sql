-- Fish Room R1.2 Tier A identity foundation.
-- Additive only: legacy wallet/local-ID tables are evidence, never authority.

BEGIN;

CREATE TABLE public.showcase_owner_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_owner_principals_privy_user_id_nonblank
    CHECK (privy_user_id = btrim(privy_user_id) AND char_length(privy_user_id) BETWEEN 1 AND 255),
  CONSTRAINT showcase_owner_principals_privy_user_id_key UNIQUE (privy_user_id),
  CONSTRAINT showcase_owner_principals_id_owner_key UNIQUE (id, privy_user_id)
);

CREATE TABLE public.showcase_owner_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  chain_id bigint NOT NULL,
  normalized_wallet_address text NOT NULL,
  display_wallet_address text,
  evidence_kind text NOT NULL,
  evidence_reference text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_owner_wallets_chain_positive CHECK (chain_id > 0),
  CONSTRAINT showcase_owner_wallets_address_canonical
    CHECK (normalized_wallet_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT showcase_owner_wallets_display_address_valid
    CHECK (display_wallet_address IS NULL OR display_wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
  CONSTRAINT showcase_owner_wallets_evidence_kind_closed
    CHECK (evidence_kind IN ('privy_token_claim', 'eip191_nonce')),
  CONSTRAINT showcase_owner_wallets_evidence_reference_bounded
    CHECK (evidence_reference IS NULL OR char_length(evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_owner_wallets_revocation_order
    CHECK (revoked_at IS NULL OR revoked_at >= verified_at),
  CONSTRAINT showcase_owner_wallets_chain_address_key
    UNIQUE (chain_id, normalized_wallet_address),
  CONSTRAINT showcase_owner_wallets_id_owner_key UNIQUE (id, owner_id)
);

CREATE INDEX showcase_owner_wallets_owner_active_idx
  ON public.showcase_owner_wallets(owner_id, chain_id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.showcase_wallet_link_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  chain_id bigint NOT NULL,
  normalized_wallet_address text NOT NULL,
  purpose text NOT NULL,
  message_version smallint NOT NULL DEFAULT 1,
  app_origin text NOT NULL,
  privy_app_id text NOT NULL,
  nonce_hash bytea NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_wallet_link_nonces_chain_positive CHECK (chain_id > 0),
  CONSTRAINT showcase_wallet_link_nonces_address_canonical
    CHECK (normalized_wallet_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT showcase_wallet_link_nonces_purpose_canonical
    CHECK (purpose ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_wallet_link_nonces_message_version_v1 CHECK (message_version = 1),
  CONSTRAINT showcase_wallet_link_nonces_origin_bounded
    CHECK (app_origin = btrim(app_origin) AND char_length(app_origin) BETWEEN 8 AND 255),
  CONSTRAINT showcase_wallet_link_nonces_app_id_canonical
    CHECK (privy_app_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  CONSTRAINT showcase_wallet_link_nonces_hash_sha256 CHECK (octet_length(nonce_hash) = 32),
  CONSTRAINT showcase_wallet_link_nonces_hash_key UNIQUE (nonce_hash),
  CONSTRAINT showcase_wallet_link_nonces_lifetime
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CONSTRAINT showcase_wallet_link_nonces_consumption_order
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX showcase_wallet_link_nonces_lookup_idx
  ON public.showcase_wallet_link_nonces(owner_id, normalized_wallet_address, purpose, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE public.showcase_datasets (
  dataset_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  enrollment_version integer NOT NULL,
  enrollment_status text NOT NULL DEFAULT 'enrolled',
  manifest_checksum bytea,
  enrollment_evidence_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  adopted_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT showcase_datasets_version_positive CHECK (enrollment_version > 0),
  CONSTRAINT showcase_datasets_status_closed
    CHECK (enrollment_status IN ('enrolled', 'adopted', 'revoked', 'quarantined')),
  CONSTRAINT showcase_datasets_manifest_sha256
    CHECK (manifest_checksum IS NULL OR octet_length(manifest_checksum) = 32),
  CONSTRAINT showcase_datasets_evidence_bounded
    CHECK (enrollment_evidence_reference = btrim(enrollment_evidence_reference)
      AND char_length(enrollment_evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_datasets_timestamp_order
    CHECK ((adopted_at IS NULL OR adopted_at >= created_at)
      AND (revoked_at IS NULL OR revoked_at >= created_at)),
  CONSTRAINT showcase_datasets_dataset_owner_key UNIQUE (dataset_id, owner_id)
);

CREATE TABLE public.showcase_dataset_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  source_dataset_id uuid,
  source_schema_version integer NOT NULL,
  backup_checksum bytea NOT NULL,
  manifest_checksum bytea,
  import_namespace text NOT NULL,
  processing_state text NOT NULL DEFAULT 'staged',
  conflict_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_dataset_imports_source_dataset_owner_fkey
    FOREIGN KEY (source_dataset_id, owner_id)
    REFERENCES public.showcase_datasets(dataset_id, owner_id),
  CONSTRAINT showcase_dataset_imports_schema_version_positive CHECK (source_schema_version > 0),
  CONSTRAINT showcase_dataset_imports_backup_sha256 CHECK (octet_length(backup_checksum) = 32),
  CONSTRAINT showcase_dataset_imports_manifest_sha256
    CHECK (manifest_checksum IS NULL OR octet_length(manifest_checksum) = 32),
  CONSTRAINT showcase_dataset_imports_namespace_canonical
    CHECK (import_namespace ~ '^[a-z0-9][a-z0-9:._-]{2,255}$'),
  CONSTRAINT showcase_dataset_imports_namespace_key UNIQUE (import_namespace),
  CONSTRAINT showcase_dataset_imports_state_closed
    CHECK (processing_state IN ('staged', 'quarantined', 'adjudicating', 'adopted', 'rejected')),
  CONSTRAINT showcase_dataset_imports_conflicts_nonnegative CHECK (conflict_count >= 0),
  CONSTRAINT showcase_dataset_imports_owner_checksum_key UNIQUE (owner_id, backup_checksum)
);

CREATE TABLE public.showcase_entities (
  public_key uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,
  origin_owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  identity_state text NOT NULL DEFAULT 'pending',
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_entities_kind_closed CHECK (entity_kind IN ('tank', 'specimen')),
  CONSTRAINT showcase_entities_identity_state_closed
    CHECK (identity_state IN ('verified', 'pending', 'ambiguous', 'revoked', 'tombstoned')),
  CONSTRAINT showcase_entities_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT showcase_entities_public_kind_key UNIQUE (public_key, entity_kind),
  CONSTRAINT showcase_entities_public_owner_kind_key UNIQUE (public_key, owner_id, entity_kind)
);

CREATE INDEX showcase_entities_owner_kind_state_idx
  ON public.showcase_entities(owner_id, entity_kind, identity_state);

CREATE TABLE public.showcase_tanks (
  tank_key uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  entity_kind text NOT NULL DEFAULT 'tank',
  internal_name text NOT NULL,
  volume_liters numeric(12,3),
  tank_type text,
  established_at date,
  is_active boolean NOT NULL DEFAULT true,
  source_revision bigint NOT NULL,
  source_checksum bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_tanks_kind_tank CHECK (entity_kind = 'tank'),
  CONSTRAINT showcase_tanks_entity_owner_fkey
    FOREIGN KEY (tank_key, owner_id, entity_kind)
    REFERENCES public.showcase_entities(public_key, owner_id, entity_kind)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT showcase_tanks_internal_name_bounded
    CHECK (internal_name = btrim(internal_name) AND char_length(internal_name) BETWEEN 1 AND 255),
  CONSTRAINT showcase_tanks_volume_positive CHECK (volume_liters IS NULL OR volume_liters > 0),
  CONSTRAINT showcase_tanks_type_bounded
    CHECK (tank_type IS NULL OR (tank_type = btrim(tank_type) AND char_length(tank_type) BETWEEN 1 AND 64)),
  CONSTRAINT showcase_tanks_source_revision_nonnegative CHECK (source_revision >= 0),
  CONSTRAINT showcase_tanks_source_checksum_sha256 CHECK (octet_length(source_checksum) = 32),
  CONSTRAINT showcase_tanks_tank_owner_key UNIQUE (tank_key, owner_id)
);

CREATE TABLE public.showcase_specimens (
  specimen_key uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  entity_kind text NOT NULL DEFAULT 'specimen',
  current_tank_key uuid,
  common_name text,
  scientific_name text,
  sex text,
  life_stage text,
  approximate_size text,
  provenance text,
  pedigree_reference text,
  lifecycle_state text,
  source_revision bigint NOT NULL,
  source_checksum bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_specimens_kind_specimen CHECK (entity_kind = 'specimen'),
  CONSTRAINT showcase_specimens_entity_owner_fkey
    FOREIGN KEY (specimen_key, owner_id, entity_kind)
    REFERENCES public.showcase_entities(public_key, owner_id, entity_kind)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT showcase_specimens_current_tank_owner_fkey
    FOREIGN KEY (current_tank_key, owner_id)
    REFERENCES public.showcase_tanks(tank_key, owner_id)
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT showcase_specimens_common_name_bounded
    CHECK (common_name IS NULL OR (common_name = btrim(common_name) AND char_length(common_name) BETWEEN 1 AND 120)),
  CONSTRAINT showcase_specimens_scientific_name_bounded
    CHECK (scientific_name IS NULL OR (scientific_name = btrim(scientific_name) AND char_length(scientific_name) BETWEEN 1 AND 160)),
  CONSTRAINT showcase_specimens_sex_bounded
    CHECK (sex IS NULL OR (sex = btrim(sex) AND char_length(sex) BETWEEN 1 AND 32)),
  CONSTRAINT showcase_specimens_life_stage_bounded
    CHECK (life_stage IS NULL OR (life_stage = btrim(life_stage) AND char_length(life_stage) BETWEEN 1 AND 48)),
  CONSTRAINT showcase_specimens_size_bounded
    CHECK (approximate_size IS NULL OR (approximate_size = btrim(approximate_size) AND char_length(approximate_size) BETWEEN 1 AND 80)),
  CONSTRAINT showcase_specimens_provenance_bounded
    CHECK (provenance IS NULL OR (provenance = btrim(provenance) AND char_length(provenance) BETWEEN 1 AND 255)),
  CONSTRAINT showcase_specimens_pedigree_bounded
    CHECK (pedigree_reference IS NULL OR (pedigree_reference = btrim(pedigree_reference) AND char_length(pedigree_reference) BETWEEN 1 AND 255)),
  CONSTRAINT showcase_specimens_lifecycle_bounded
    CHECK (lifecycle_state IS NULL OR (lifecycle_state = btrim(lifecycle_state) AND char_length(lifecycle_state) BETWEEN 1 AND 48)),
  CONSTRAINT showcase_specimens_source_revision_nonnegative CHECK (source_revision >= 0),
  CONSTRAINT showcase_specimens_source_checksum_sha256 CHECK (octet_length(source_checksum) = 32),
  CONSTRAINT showcase_specimens_specimen_owner_key UNIQUE (specimen_key, owner_id)
);

CREATE INDEX showcase_specimens_owner_tank_idx
  ON public.showcase_specimens(owner_id, current_tank_key);

CREATE TABLE public.showcase_transfer_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specimen_key uuid NOT NULL REFERENCES public.showcase_specimens(specimen_key),
  from_owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  to_owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  evidence_kind text NOT NULL,
  evidence_reference text NOT NULL,
  evidence_checksum bytea NOT NULL,
  finality_state text NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  processed_at timestamptz,
  committed_ownership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_transfer_evidence_distinct_owners CHECK (from_owner_id <> to_owner_id),
  CONSTRAINT showcase_transfer_evidence_kind_bounded
    CHECK (evidence_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_transfer_evidence_reference_bounded
    CHECK (evidence_reference = btrim(evidence_reference)
      AND char_length(evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_transfer_evidence_checksum_sha256 CHECK (octet_length(evidence_checksum) = 32),
  CONSTRAINT showcase_transfer_evidence_finality_closed
    CHECK (finality_state IN ('pending', 'accepted_final', 'disputed', 'reorged', 'rejected', 'malformed')),
  CONSTRAINT showcase_transfer_evidence_acceptance_coherent
    CHECK ((finality_state = 'accepted_final' AND accepted_at IS NOT NULL)
      OR (finality_state <> 'accepted_final' AND accepted_at IS NULL)),
  CONSTRAINT showcase_transfer_evidence_processing_coherent
    CHECK ((processed_at IS NULL AND committed_ownership_id IS NULL)
      OR (processed_at IS NOT NULL AND committed_ownership_id IS NOT NULL)),
  CONSTRAINT showcase_transfer_evidence_kind_reference_key UNIQUE (evidence_kind, evidence_reference)
);

CREATE TABLE public.showcase_specimen_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specimen_key uuid NOT NULL REFERENCES public.showcase_specimens(specimen_key),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  evidence_kind text NOT NULL,
  evidence_reference text NOT NULL,
  finality_state text NOT NULL,
  transfer_evidence_id uuid REFERENCES public.showcase_transfer_evidence(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_specimen_ownership_interval_valid
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT showcase_specimen_ownership_evidence_kind_bounded
    CHECK (evidence_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_specimen_ownership_evidence_reference_bounded
    CHECK (evidence_reference = btrim(evidence_reference)
      AND char_length(evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_specimen_ownership_finality_closed
    CHECK (finality_state IN ('initial', 'accepted_final')),
  CONSTRAINT showcase_specimen_ownership_transfer_key UNIQUE (transfer_evidence_id)
);

CREATE UNIQUE INDEX showcase_specimen_ownership_one_open_idx
  ON public.showcase_specimen_ownership(specimen_key)
  WHERE valid_to IS NULL;

CREATE INDEX showcase_specimen_ownership_history_idx
  ON public.showcase_specimen_ownership(specimen_key, valid_from DESC);

ALTER TABLE public.showcase_transfer_evidence
  ADD CONSTRAINT showcase_transfer_evidence_committed_ownership_fkey
  FOREIGN KEY (committed_ownership_id)
  REFERENCES public.showcase_specimen_ownership(id);

CREATE TABLE public.showcase_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key uuid NOT NULL,
  entity_kind text NOT NULL,
  owner_scope_id uuid REFERENCES public.showcase_owner_principals(id),
  dataset_id uuid,
  alias_kind text NOT NULL,
  namespace text NOT NULL,
  value text NOT NULL,
  initial_evidence_kind text NOT NULL,
  initial_evidence_reference text,
  initial_evidence_checksum bytea,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_entity_aliases_entity_kind_closed CHECK (entity_kind IN ('tank', 'specimen')),
  CONSTRAINT showcase_entity_aliases_entity_kind_fkey
    FOREIGN KEY (entity_key, entity_kind)
    REFERENCES public.showcase_entities(public_key, entity_kind),
  CONSTRAINT showcase_entity_aliases_dataset_scope_required
    CHECK (dataset_id IS NULL OR owner_scope_id IS NOT NULL),
  CONSTRAINT showcase_entity_aliases_dataset_owner_fkey
    FOREIGN KEY (dataset_id, owner_scope_id)
    REFERENCES public.showcase_datasets(dataset_id, owner_id),
  CONSTRAINT showcase_entity_aliases_alias_kind_canonical
    CHECK (alias_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_entity_aliases_namespace_bounded
    CHECK (namespace = btrim(namespace) AND char_length(namespace) BETWEEN 1 AND 512),
  CONSTRAINT showcase_entity_aliases_value_bounded
    CHECK (value = btrim(value) AND char_length(value) BETWEEN 1 AND 512),
  CONSTRAINT showcase_entity_aliases_evidence_kind_closed
    CHECK (initial_evidence_kind IN ('migration', 'verified_chain', 'signed_certificate', 'owner_adjudication', 'system')),
  CONSTRAINT showcase_entity_aliases_evidence_reference_bounded
    CHECK (initial_evidence_reference IS NULL OR char_length(initial_evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_entity_aliases_evidence_checksum_sha256
    CHECK (initial_evidence_checksum IS NULL OR octet_length(initial_evidence_checksum) = 32),
  CONSTRAINT showcase_entity_aliases_status_closed
    CHECK (status IN ('active', 'ambiguous', 'revoked', 'superseded', 'tombstoned')),
  CONSTRAINT showcase_entity_aliases_lifetime_tuple_key
    UNIQUE (entity_kind, alias_kind, namespace, value)
);

CREATE INDEX showcase_entity_aliases_target_idx
  ON public.showcase_entity_aliases(entity_key, entity_kind, status);

CREATE TABLE public.showcase_alias_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_id uuid NOT NULL REFERENCES public.showcase_entity_aliases(id),
  event_kind text NOT NULL,
  resulting_status text NOT NULL,
  evidence_kind text NOT NULL,
  evidence_reference text,
  evidence_checksum bytea,
  actor_owner_id uuid REFERENCES public.showcase_owner_principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_alias_events_kind_canonical CHECK (event_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_alias_events_status_closed
    CHECK (resulting_status IN ('active', 'ambiguous', 'revoked', 'superseded', 'tombstoned')),
  CONSTRAINT showcase_alias_events_evidence_kind_bounded
    CHECK (evidence_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_alias_events_evidence_reference_bounded
    CHECK (evidence_reference IS NULL OR char_length(evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_alias_events_evidence_checksum_sha256
    CHECK (evidence_checksum IS NULL OR octet_length(evidence_checksum) = 32)
);

CREATE INDEX showcase_alias_events_alias_created_idx
  ON public.showcase_alias_events(alias_id, created_at);

CREATE TABLE public.showcase_alias_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  entity_kind text NOT NULL,
  alias_kind text NOT NULL,
  namespace text NOT NULL,
  value text NOT NULL,
  candidate_entity_key uuid NOT NULL,
  candidate_checksum bytea NOT NULL,
  evidence_kind text NOT NULL,
  evidence_reference text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_alias_claims_entity_kind_closed CHECK (entity_kind IN ('tank', 'specimen')),
  CONSTRAINT showcase_alias_claims_candidate_kind_fkey
    FOREIGN KEY (candidate_entity_key, entity_kind)
    REFERENCES public.showcase_entities(public_key, entity_kind),
  CONSTRAINT showcase_alias_claims_alias_kind_canonical
    CHECK (alias_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_alias_claims_namespace_bounded
    CHECK (namespace = btrim(namespace) AND char_length(namespace) BETWEEN 1 AND 512),
  CONSTRAINT showcase_alias_claims_value_bounded
    CHECK (value = btrim(value) AND char_length(value) BETWEEN 1 AND 512),
  CONSTRAINT showcase_alias_claims_checksum_sha256 CHECK (octet_length(candidate_checksum) = 32),
  CONSTRAINT showcase_alias_claims_evidence_kind_bounded
    CHECK (evidence_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_alias_claims_evidence_reference_bounded
    CHECK (evidence_reference IS NULL OR char_length(evidence_reference) BETWEEN 1 AND 512),
  CONSTRAINT showcase_alias_claims_status_closed
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn'))
);

CREATE INDEX showcase_alias_claims_tuple_idx
  ON public.showcase_alias_claims(entity_kind, alias_kind, namespace, value, status);
CREATE INDEX showcase_alias_claims_candidate_idx
  ON public.showcase_alias_claims(candidate_entity_key, status);

CREATE TABLE public.showcase_identity_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  conflict_kind text NOT NULL,
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT showcase_identity_conflicts_kind_canonical
    CHECK (conflict_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT showcase_identity_conflicts_reason_canonical
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT showcase_identity_conflicts_status_closed
    CHECK (status IN ('open', 'resolved', 'rejected')),
  CONSTRAINT showcase_identity_conflicts_resolution_coherent
    CHECK ((status = 'open' AND resolved_at IS NULL)
      OR (status <> 'open' AND resolved_at IS NOT NULL))
);

CREATE INDEX showcase_identity_conflicts_owner_status_idx
  ON public.showcase_identity_conflicts(owner_id, status);

CREATE TABLE public.showcase_identity_conflict_claims (
  conflict_id uuid NOT NULL REFERENCES public.showcase_identity_conflicts(id),
  claim_id uuid NOT NULL REFERENCES public.showcase_alias_claims(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conflict_id, claim_id)
);

CREATE TABLE public.showcase_identity_conflict_entities (
  conflict_id uuid NOT NULL REFERENCES public.showcase_identity_conflicts(id),
  entity_key uuid NOT NULL REFERENCES public.showcase_entities(public_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conflict_id, entity_key)
);

CREATE INDEX showcase_identity_conflict_entities_entity_idx
  ON public.showcase_identity_conflict_entities(entity_key, conflict_id);

CREATE TABLE public.showcase_identity_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL UNIQUE REFERENCES public.showcase_identity_conflicts(id),
  actor_owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  chosen_entity_key uuid REFERENCES public.showcase_entities(public_key),
  reason text NOT NULL,
  candidate_checksums jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_identity_resolutions_reason_bounded
    CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 1000),
  CONSTRAINT showcase_identity_resolutions_checksums_object
    CHECK (jsonb_typeof(candidate_checksums) = 'object'
      AND octet_length(candidate_checksums::text) <= 65536)
);

CREATE TABLE public.showcase_projection_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  entity_key uuid REFERENCES public.showcase_entities(public_key),
  reason text NOT NULL,
  transfer_evidence_id uuid REFERENCES public.showcase_transfer_evidence(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_projection_invalidations_reason_closed
    CHECK (reason IN ('identity_change', 'conflict_change', 'publication_change', 'transfer', 'media_change'))
);

CREATE INDEX showcase_projection_invalidations_owner_created_idx
  ON public.showcase_projection_invalidations(owner_id, created_at DESC);

-- Generic timestamp maintenance is never identity authority.
CREATE FUNCTION public.showcase_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_deny_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'SHOWCASE_IMMUTABLE_HISTORY' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.showcase_deny_update_or_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'SHOWCASE_APPEND_ONLY_HISTORY' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.showcase_guard_principal_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.privy_user_id <> OLD.privy_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_PRINCIPAL_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_wallet_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.chain_id <> OLD.chain_id
     OR NEW.normalized_wallet_address <> OLD.normalized_wallet_address
     OR NEW.evidence_kind <> OLD.evidence_kind
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.verified_at <> OLD.verified_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_LINK_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_REVOCATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_nonce_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.chain_id <> OLD.chain_id
     OR NEW.normalized_wallet_address <> OLD.normalized_wallet_address
     OR NEW.purpose <> OLD.purpose
     OR NEW.message_version <> OLD.message_version
     OR NEW.app_origin <> OLD.app_origin
     OR NEW.privy_app_id <> OLD.privy_app_id
     OR NEW.nonce_hash <> OLD.nonce_hash
     OR NEW.issued_at <> OLD.issued_at
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_NONCE_BINDING_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'SHOWCASE_NONCE_ALREADY_CONSUMED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_dataset_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.dataset_id <> OLD.dataset_id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.enrollment_version <> OLD.enrollment_version
     OR NEW.manifest_checksum IS DISTINCT FROM OLD.manifest_checksum
     OR NEW.enrollment_evidence_reference <> OLD.enrollment_evidence_reference
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_BINDING_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_REVOCATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_import_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.source_dataset_id IS DISTINCT FROM OLD.source_dataset_id
     OR NEW.source_schema_version <> OLD.source_schema_version
     OR NEW.backup_checksum <> OLD.backup_checksum
     OR NEW.manifest_checksum IS DISTINCT FROM OLD.manifest_checksum
     OR NEW.import_namespace <> OLD.import_namespace
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_EVIDENCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_entity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_id text := current_setting('showcase.transfer_evidence_id', true);
BEGIN
  IF NEW.public_key <> OLD.public_key
     OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.origin_owner_id <> OLD.origin_owner_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ENTITY_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.owner_id <> OLD.owner_id
     AND (OLD.entity_kind <> 'specimen' OR transfer_id IS NULL OR transfer_id = '') THEN
    RAISE EXCEPTION 'SHOWCASE_OWNER_CHANGE_REQUIRES_TRANSFER' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_ENTITY_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_tank_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tank_key <> OLD.tank_key OR NEW.owner_id <> OLD.owner_id
     OR NEW.entity_kind <> OLD.entity_kind OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_TANK_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.source_revision <= OLD.source_revision THEN
    RAISE EXCEPTION 'SHOWCASE_SOURCE_REVISION_STALE' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_specimen_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_id text := current_setting('showcase.transfer_evidence_id', true);
  transfer_only boolean;
BEGIN
  IF NEW.specimen_key <> OLD.specimen_key OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_SPECIMEN_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  transfer_only := transfer_id IS NOT NULL AND transfer_id <> ''
    AND NEW.owner_id <> OLD.owner_id
    AND NEW.current_tank_key IS NULL
    AND NEW.common_name IS NOT DISTINCT FROM OLD.common_name
    AND NEW.scientific_name IS NOT DISTINCT FROM OLD.scientific_name
    AND NEW.sex IS NOT DISTINCT FROM OLD.sex
    AND NEW.life_stage IS NOT DISTINCT FROM OLD.life_stage
    AND NEW.approximate_size IS NOT DISTINCT FROM OLD.approximate_size
    AND NEW.provenance IS NOT DISTINCT FROM OLD.provenance
    AND NEW.pedigree_reference IS NOT DISTINCT FROM OLD.pedigree_reference
    AND NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state
    AND NEW.source_revision = OLD.source_revision
    AND NEW.source_checksum = OLD.source_checksum;

  IF NEW.owner_id <> OLD.owner_id AND NOT transfer_only THEN
    RAISE EXCEPTION 'SHOWCASE_OWNER_CHANGE_REQUIRES_TRANSFER' USING ERRCODE = '55000';
  END IF;
  IF NOT transfer_only AND NEW.source_revision <= OLD.source_revision THEN
    RAISE EXCEPTION 'SHOWCASE_SOURCE_REVISION_STALE' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_transfer_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_id text := current_setting('showcase.transfer_evidence_id', true);
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.specimen_key <> OLD.specimen_key
     OR NEW.from_owner_id <> OLD.from_owner_id
     OR NEW.to_owner_id <> OLD.to_owner_id
     OR NEW.evidence_kind <> OLD.evidence_kind
     OR NEW.evidence_reference <> OLD.evidence_reference
     OR NEW.evidence_checksum <> OLD.evidence_checksum
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_EVIDENCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_ALREADY_COMMITTED' USING ERRCODE = '55000';
  END IF;
  IF NEW.processed_at IS NOT NULL
     AND (transfer_id IS NULL OR transfer_id <> OLD.id::text) THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_COMMIT_GUARD_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_id text := current_setting('showcase.transfer_evidence_id', true);
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.specimen_key <> OLD.specimen_key
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.valid_from <> OLD.valid_from
     OR NEW.evidence_kind <> OLD.evidence_kind
     OR NEW.evidence_reference <> OLD.evidence_reference
     OR NEW.finality_state <> OLD.finality_state
     OR NEW.transfer_evidence_id IS DISTINCT FROM OLD.transfer_evidence_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_OWNERSHIP_HISTORY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL
     OR transfer_id IS NULL OR transfer_id = '' THEN
    RAISE EXCEPTION 'SHOWCASE_OWNERSHIP_CLOSE_REQUIRES_TRANSFER' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_alias_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.entity_key <> OLD.entity_key
     OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.owner_scope_id IS DISTINCT FROM OLD.owner_scope_id
     OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
     OR NEW.alias_kind <> OLD.alias_kind
     OR NEW.namespace <> OLD.namespace
     OR NEW.value <> OLD.value
     OR NEW.initial_evidence_kind <> OLD.initial_evidence_kind
     OR NEW.initial_evidence_reference IS DISTINCT FROM OLD.initial_evidence_reference
     OR NEW.initial_evidence_checksum IS DISTINCT FROM OLD.initial_evidence_checksum
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_TUPLE_TARGET_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_claim_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id
     OR NEW.entity_kind <> OLD.entity_kind OR NEW.alias_kind <> OLD.alias_kind
     OR NEW.namespace <> OLD.namespace OR NEW.value <> OLD.value
     OR NEW.candidate_entity_key <> OLD.candidate_entity_key
     OR NEW.candidate_checksum <> OLD.candidate_checksum
     OR NEW.evidence_kind <> OLD.evidence_kind
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_CLAIM_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_guard_conflict_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id
     OR NEW.conflict_kind <> OLD.conflict_kind OR NEW.reason_code <> OLD.reason_code
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'open' AND (NEW.status <> OLD.status OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_RESOLUTION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_transfer_evidence_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  current_owner uuid;
BEGIN
  SELECT owner_id INTO STRICT current_owner
  FROM public.showcase_specimens
  WHERE specimen_key = NEW.specimen_key
  FOR KEY SHARE;
  IF current_owner <> NEW.from_owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_FROM_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_ownership_interval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  current_owner uuid;
  transfer_row public.showcase_transfer_evidence%ROWTYPE;
BEGIN
  SELECT owner_id INTO STRICT current_owner
  FROM public.showcase_specimens
  WHERE specimen_key = NEW.specimen_key
  FOR KEY SHARE;
  IF current_owner <> NEW.owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_OWNERSHIP_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.transfer_evidence_id IS NOT NULL THEN
    SELECT * INTO STRICT transfer_row
    FROM public.showcase_transfer_evidence
    WHERE id = NEW.transfer_evidence_id;
    IF transfer_row.specimen_key <> NEW.specimen_key
       OR transfer_row.to_owner_id <> NEW.owner_id
       OR transfer_row.finality_state <> 'accepted_final' THEN
      RAISE EXCEPTION 'SHOWCASE_OWNERSHIP_TRANSFER_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_alias_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_owner uuid;
  dataset_owner uuid;
BEGIN
  SELECT owner_id INTO STRICT entity_owner
  FROM public.showcase_entities
  WHERE public_key = NEW.entity_key AND entity_kind = NEW.entity_kind
  FOR KEY SHARE;
  IF NEW.owner_scope_id IS NOT NULL AND NEW.owner_scope_id <> entity_owner THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_OWNER_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.dataset_id IS NOT NULL THEN
    SELECT owner_id INTO STRICT dataset_owner
    FROM public.showcase_datasets
    WHERE dataset_id = NEW.dataset_id;
    IF NEW.owner_scope_id IS NULL OR dataset_owner <> NEW.owner_scope_id THEN
      RAISE EXCEPTION 'SHOWCASE_ALIAS_DATASET_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_claim_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_owner uuid;
BEGIN
  SELECT owner_id INTO STRICT entity_owner
  FROM public.showcase_entities
  WHERE public_key = NEW.candidate_entity_key AND entity_kind = NEW.entity_kind
  FOR KEY SHARE;
  IF entity_owner <> NEW.owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_CLAIM_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_conflict_claim_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  conflict_owner uuid;
  claim_owner uuid;
  candidate_key uuid;
  entity_owner uuid;
BEGIN
  SELECT owner_id INTO STRICT conflict_owner
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id;
  SELECT owner_id, candidate_entity_key INTO STRICT claim_owner, candidate_key
  FROM public.showcase_alias_claims WHERE id = NEW.claim_id;
  SELECT owner_id INTO STRICT entity_owner
  FROM public.showcase_entities WHERE public_key = candidate_key
  FOR KEY SHARE;
  IF conflict_owner <> claim_owner OR claim_owner <> entity_owner THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_conflict_entity_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  conflict_owner uuid;
  entity_owner uuid;
BEGIN
  SELECT owner_id INTO STRICT conflict_owner
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id;
  SELECT owner_id INTO STRICT entity_owner
  FROM public.showcase_entities WHERE public_key = NEW.entity_key
  FOR KEY SHARE;
  IF conflict_owner <> entity_owner THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_validate_identity_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  conflict_owner uuid;
  conflict_status text;
  entity_owner uuid;
BEGIN
  -- Entity before conflict matches the specimen-transfer lock order and avoids deadlocks.
  IF NEW.chosen_entity_key IS NOT NULL THEN
    SELECT owner_id INTO STRICT entity_owner
    FROM public.showcase_entities WHERE public_key = NEW.chosen_entity_key
    FOR KEY SHARE;
  END IF;

  SELECT owner_id, status INTO STRICT conflict_owner, conflict_status
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id FOR UPDATE;
  IF conflict_status <> 'open' OR conflict_owner <> NEW.actor_owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_OWNER_OR_STATE_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW.chosen_entity_key IS NOT NULL AND entity_owner <> conflict_owner THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_ENTITY_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER showcase_owner_principals_guard_update
  BEFORE UPDATE ON public.showcase_owner_principals
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_principal_change();
CREATE TRIGGER showcase_owner_principals_touch
  BEFORE UPDATE ON public.showcase_owner_principals
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_owner_principals_deny_delete
  BEFORE DELETE ON public.showcase_owner_principals
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_owner_wallets_guard_update
  BEFORE UPDATE ON public.showcase_owner_wallets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_wallet_change();
CREATE TRIGGER showcase_owner_wallets_deny_delete
  BEFORE DELETE ON public.showcase_owner_wallets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_wallet_link_nonces_guard_update
  BEFORE UPDATE ON public.showcase_wallet_link_nonces
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_nonce_change();
CREATE TRIGGER showcase_wallet_link_nonces_deny_delete
  BEFORE DELETE ON public.showcase_wallet_link_nonces
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_datasets_guard_update
  BEFORE UPDATE ON public.showcase_datasets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_dataset_change();
CREATE TRIGGER showcase_datasets_deny_delete
  BEFORE DELETE ON public.showcase_datasets
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_dataset_imports_guard_update
  BEFORE UPDATE ON public.showcase_dataset_imports
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_import_change();
CREATE TRIGGER showcase_dataset_imports_touch
  BEFORE UPDATE ON public.showcase_dataset_imports
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_dataset_imports_deny_delete
  BEFORE DELETE ON public.showcase_dataset_imports
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_entities_guard_update
  BEFORE UPDATE ON public.showcase_entities
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_entity_change();
CREATE TRIGGER showcase_entities_touch
  BEFORE UPDATE ON public.showcase_entities
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_entities_deny_delete
  BEFORE DELETE ON public.showcase_entities
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_tanks_guard_update
  BEFORE UPDATE ON public.showcase_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_tank_change();
CREATE TRIGGER showcase_tanks_touch
  BEFORE UPDATE ON public.showcase_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_tanks_deny_delete
  BEFORE DELETE ON public.showcase_tanks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_specimens_guard_update
  BEFORE UPDATE ON public.showcase_specimens
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_specimen_change();
CREATE TRIGGER showcase_specimens_touch
  BEFORE UPDATE ON public.showcase_specimens
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_specimens_deny_delete
  BEFORE DELETE ON public.showcase_specimens
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_transfer_evidence_guard_update
  BEFORE UPDATE ON public.showcase_transfer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_transfer_evidence_change();
CREATE TRIGGER showcase_transfer_evidence_deny_delete
  BEFORE DELETE ON public.showcase_transfer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_specimen_ownership_guard_update
  BEFORE UPDATE ON public.showcase_specimen_ownership
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_ownership_change();
CREATE TRIGGER showcase_specimen_ownership_deny_delete
  BEFORE DELETE ON public.showcase_specimen_ownership
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_entity_aliases_guard_update
  BEFORE UPDATE ON public.showcase_entity_aliases
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_alias_change();
CREATE TRIGGER showcase_entity_aliases_touch
  BEFORE UPDATE ON public.showcase_entity_aliases
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_entity_aliases_deny_delete
  BEFORE DELETE ON public.showcase_entity_aliases
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

CREATE TRIGGER showcase_alias_events_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_alias_events
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_alias_claims_guard_update
  BEFORE UPDATE ON public.showcase_alias_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_claim_change();
CREATE TRIGGER showcase_alias_claims_touch
  BEFORE UPDATE ON public.showcase_alias_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_touch_updated_at();
CREATE TRIGGER showcase_alias_claims_deny_delete
  BEFORE DELETE ON public.showcase_alias_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();
CREATE TRIGGER showcase_identity_conflicts_guard_update
  BEFORE UPDATE ON public.showcase_identity_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_conflict_change();
CREATE TRIGGER showcase_identity_conflicts_deny_delete
  BEFORE DELETE ON public.showcase_identity_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();
CREATE TRIGGER showcase_identity_conflict_claims_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_identity_conflict_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_identity_conflict_entities_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_identity_conflict_entities
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_identity_resolutions_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_identity_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_projection_invalidations_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_projection_invalidations
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();

CREATE TRIGGER showcase_transfer_evidence_validate_owner
  BEFORE INSERT ON public.showcase_transfer_evidence
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_transfer_evidence_owner();
CREATE TRIGGER showcase_specimen_ownership_validate_insert
  BEFORE INSERT ON public.showcase_specimen_ownership
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_ownership_interval();
CREATE TRIGGER showcase_entity_aliases_validate_scope
  BEFORE INSERT ON public.showcase_entity_aliases
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_alias_scope();
CREATE TRIGGER showcase_alias_claims_validate_owner
  BEFORE INSERT ON public.showcase_alias_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_claim_owner();
CREATE TRIGGER showcase_identity_conflict_claims_validate_owner
  BEFORE INSERT ON public.showcase_identity_conflict_claims
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_conflict_claim_link();
CREATE TRIGGER showcase_identity_conflict_entities_validate_owner
  BEFORE INSERT ON public.showcase_identity_conflict_entities
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_conflict_entity_link();
CREATE TRIGGER showcase_identity_resolutions_validate
  BEFORE INSERT ON public.showcase_identity_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.showcase_validate_identity_resolution();

-- Concurrency-idempotent principal resolution from an already verified Privy subject.
CREATE FUNCTION public.showcase_resolve_owner_principal(p_privy_user_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resolved_owner_id uuid;
BEGIN
  IF p_privy_user_id IS NULL
     OR p_privy_user_id <> btrim(p_privy_user_id)
     OR char_length(p_privy_user_id) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'SHOWCASE_PRIVY_SUB_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.showcase_owner_principals (privy_user_id)
  VALUES (p_privy_user_id)
  ON CONFLICT (privy_user_id) DO NOTHING
  RETURNING id INTO resolved_owner_id;

  IF resolved_owner_id IS NULL THEN
    SELECT id INTO STRICT resolved_owner_id
    FROM public.showcase_owner_principals
    WHERE privy_user_id = p_privy_user_id;
  END IF;

  RETURN resolved_owner_id;
END;
$$;

-- Links only a server-verified wallet proof. Lifetime uniqueness prevents reassignment.
CREATE FUNCTION public.showcase_link_owner_wallet(
  p_owner_id uuid,
  p_chain_id bigint,
  p_normalized_wallet_address text,
  p_display_wallet_address text,
  p_evidence_kind text,
  p_evidence_reference text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_link public.showcase_owner_wallets%ROWTYPE;
  linked_id uuid;
BEGIN
  IF p_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.showcase_owner_principals WHERE id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_OWNER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF p_chain_id IS NULL OR p_chain_id <= 0 THEN
    RAISE EXCEPTION 'SHOWCASE_CHAIN_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_normalized_wallet_address IS NULL
     OR p_normalized_wallet_address !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_display_wallet_address IS NOT NULL
     AND p_display_wallet_address !~ '^0x[0-9A-Fa-f]{40}$' THEN
    RAISE EXCEPTION 'SHOWCASE_DISPLAY_WALLET_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_kind NOT IN ('privy_token_claim', 'eip191_nonce') THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_EVIDENCE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_reference IS NOT NULL
     AND char_length(p_evidence_reference) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_EVIDENCE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO existing_link
  FROM public.showcase_owner_wallets
  WHERE chain_id = p_chain_id
    AND normalized_wallet_address = p_normalized_wallet_address
  FOR UPDATE;

  IF FOUND THEN
    IF existing_link.owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'SHOWCASE_WALLET_UNAVAILABLE' USING ERRCODE = '23505';
    END IF;
    IF existing_link.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'SHOWCASE_WALLET_REVOKED' USING ERRCODE = '55000';
    END IF;
    RETURN existing_link.id;
  END IF;

  BEGIN
    INSERT INTO public.showcase_owner_wallets (
      owner_id, chain_id, normalized_wallet_address, display_wallet_address,
      evidence_kind, evidence_reference
    ) VALUES (
      p_owner_id, p_chain_id, p_normalized_wallet_address, p_display_wallet_address,
      p_evidence_kind, p_evidence_reference
    ) RETURNING id INTO linked_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO STRICT existing_link
    FROM public.showcase_owner_wallets
    WHERE chain_id = p_chain_id
      AND normalized_wallet_address = p_normalized_wallet_address
    FOR UPDATE;
    IF existing_link.owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'SHOWCASE_WALLET_UNAVAILABLE' USING ERRCODE = '23505';
    END IF;
    IF existing_link.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'SHOWCASE_WALLET_REVOKED' USING ERRCODE = '55000';
    END IF;
    linked_id := existing_link.id;
  END;

  RETURN linked_id;
END;
$$;

ALTER FUNCTION public.showcase_resolve_owner_principal(text) OWNER TO postgres;
ALTER FUNCTION public.showcase_link_owner_wallet(uuid, bigint, text, text, text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.showcase_resolve_owner_principal(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.showcase_link_owner_wallet(uuid, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_resolve_owner_principal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_link_owner_wallet(uuid, bigint, text, text, text, text) TO service_role;

-- Lock every base relation immediately; the final migration repeats this as a convergent audit boundary.
DO $showcase_identity_rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'showcase_owner_principals', 'showcase_owner_wallets', 'showcase_wallet_link_nonces',
    'showcase_datasets', 'showcase_dataset_imports', 'showcase_entities', 'showcase_tanks',
    'showcase_specimens', 'showcase_transfer_evidence', 'showcase_specimen_ownership',
    'showcase_entity_aliases', 'showcase_alias_events', 'showcase_alias_claims',
    'showcase_identity_conflicts', 'showcase_identity_conflict_claims',
    'showcase_identity_conflict_entities', 'showcase_identity_resolutions',
    'showcase_projection_invalidations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
  END LOOP;
END;
$showcase_identity_rls$;

REVOKE ALL ON FUNCTION public.showcase_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_deny_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_deny_update_or_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_principal_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_wallet_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_nonce_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_dataset_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_import_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_entity_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_tank_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_specimen_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_transfer_evidence_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_ownership_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_alias_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_claim_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_conflict_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_transfer_evidence_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_ownership_interval() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_alias_scope() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_claim_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_conflict_claim_link() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_conflict_entity_link() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_validate_identity_resolution() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
