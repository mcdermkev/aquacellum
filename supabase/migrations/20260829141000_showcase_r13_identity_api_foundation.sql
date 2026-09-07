-- Fish Room R1.3A Tier A identity and owner-API SQL foundation.
-- Additive only. R1.2 migrations remain immutable evidence.

BEGIN;

-- R1.2 never exposed import creation. Refuse to invent operation/checksum authority
-- if an operator populated the table out of band before this reviewed upgrade.
DO $showcase_r13_upgrade_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.showcase_dataset_imports) THEN
    RAISE EXCEPTION 'SHOWCASE_R13_IMPORT_BACKFILL_REVIEW_REQUIRED' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT owner_id
    FROM public.showcase_datasets
    WHERE enrollment_status IN ('enrolled', 'adopted') AND revoked_at IS NULL
    GROUP BY owner_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_R13_ACTIVE_DATASET_REVIEW_REQUIRED' USING ERRCODE = '55000';
  END IF;
END;
$showcase_r13_upgrade_guard$;

ALTER TABLE public.showcase_datasets
  DROP CONSTRAINT showcase_datasets_status_closed,
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT showcase_datasets_status_closed
    CHECK (enrollment_status IN ('enrolled', 'adopted', 'staged', 'quarantined', 'revoked')),
  ADD CONSTRAINT showcase_datasets_revision_nonnegative CHECK (revision >= 0);

CREATE UNIQUE INDEX showcase_datasets_one_active_owner_idx
  ON public.showcase_datasets(owner_id)
  WHERE enrollment_status IN ('enrolled', 'adopted') AND revoked_at IS NULL;

ALTER TABLE public.showcase_dataset_imports
  DROP CONSTRAINT showcase_dataset_imports_owner_checksum_key,
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN operation_id uuid NOT NULL,
  ADD COLUMN start_request_checksum bytea NOT NULL,
  ADD COLUMN identity_package_checksum bytea,
  ADD COLUMN sealed_at timestamptz,
  ADD COLUMN final_result jsonb,
  ADD CONSTRAINT showcase_dataset_imports_id_owner_key UNIQUE (id, owner_id),
  ADD CONSTRAINT showcase_dataset_imports_owner_operation_key UNIQUE (owner_id, operation_id),
  ADD CONSTRAINT showcase_dataset_imports_revision_nonnegative CHECK (revision >= 0),
  ADD CONSTRAINT showcase_dataset_imports_start_request_sha256
    CHECK (octet_length(start_request_checksum) = 32),
  ADD CONSTRAINT showcase_dataset_imports_identity_package_sha256
    CHECK (identity_package_checksum IS NULL OR octet_length(identity_package_checksum) = 32),
  ADD CONSTRAINT showcase_dataset_imports_final_result_bounded
    CHECK (final_result IS NULL OR (
      jsonb_typeof(final_result) = 'object'
      AND octet_length(final_result::text) <= 65536
      AND final_result - ARRAY[
        'importId', 'datasetId', 'processingState', 'eligible',
        'adopted', 'replay', 'conflictCount'
      ]::text[] = '{}'::jsonb
    )),
  ADD CONSTRAINT showcase_dataset_imports_seal_coherent
    CHECK (
      (sealed_at IS NULL AND identity_package_checksum IS NULL AND final_result IS NULL)
      OR (sealed_at IS NOT NULL AND final_result IS NOT NULL)
    );

CREATE UNIQUE INDEX showcase_dataset_imports_owner_identity_package_idx
  ON public.showcase_dataset_imports(owner_id, identity_package_checksum)
  WHERE identity_package_checksum IS NOT NULL;
CREATE INDEX showcase_dataset_imports_owner_unsealed_idx
  ON public.showcase_dataset_imports(owner_id, processing_state, id)
  WHERE sealed_at IS NULL;

CREATE TABLE public.showcase_dataset_import_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  section text NOT NULL,
  chunk_index integer NOT NULL,
  row_count integer NOT NULL,
  chunk_checksum bytea NOT NULL,
  payload jsonb NOT NULL,
  canonical_byte_size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_dataset_import_chunks_import_owner_fkey
    FOREIGN KEY (import_id, owner_id)
    REFERENCES public.showcase_dataset_imports(id, owner_id),
  CONSTRAINT showcase_dataset_import_chunks_section_closed
    CHECK (section IN ('tanks', 'specimens', 'aliases')),
  CONSTRAINT showcase_dataset_import_chunks_index_nonnegative CHECK (chunk_index >= 0),
  CONSTRAINT showcase_dataset_import_chunks_row_count_bounded CHECK (row_count BETWEEN 0 AND 500),
  CONSTRAINT showcase_dataset_import_chunks_checksum_sha256 CHECK (octet_length(chunk_checksum) = 32),
  CONSTRAINT showcase_dataset_import_chunks_payload_array_bounded
    CHECK (jsonb_typeof(payload) = 'array'
      AND row_count = jsonb_array_length(payload)
      AND canonical_byte_size BETWEEN 2 AND 1048576),
  CONSTRAINT showcase_dataset_import_chunks_section_index_key
    UNIQUE (import_id, section, chunk_index)
);

CREATE INDEX showcase_dataset_import_chunks_owner_import_idx
  ON public.showcase_dataset_import_chunks(owner_id, import_id);

CREATE TABLE public.showcase_identity_operations (
  operation_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.showcase_owner_principals(id),
  operation_kind text NOT NULL,
  request_checksum bytea NOT NULL,
  result_conflict_id uuid REFERENCES public.showcase_identity_conflicts(id),
  result jsonb,
  status text NOT NULL DEFAULT 'processing',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (owner_id, operation_id),
  CONSTRAINT showcase_identity_operations_kind_closed CHECK (operation_kind = 'candidate_stage'),
  CONSTRAINT showcase_identity_operations_request_sha256 CHECK (octet_length(request_checksum) = 32),
  CONSTRAINT showcase_identity_operations_status_closed
    CHECK (status IN ('processing', 'completed', 'rejected')),
  CONSTRAINT showcase_identity_operations_result_bounded
    CHECK (result IS NULL OR (
      jsonb_typeof(result) = 'object'
      AND octet_length(result::text) <= 65536
      AND result - ARRAY[
        'operationId', 'importId', 'stagedCount', 'conflictCount',
        'firstConflictId', 'status', 'replay'
      ]::text[] = '{}'::jsonb
    )),
  CONSTRAINT showcase_identity_operations_completion_coherent
    CHECK (
      (status = 'processing' AND completed_at IS NULL AND result IS NULL)
      OR (status IN ('completed', 'rejected') AND completed_at IS NOT NULL AND result IS NOT NULL)
    )
);

CREATE TRIGGER showcase_dataset_import_chunks_append_only
  BEFORE UPDATE OR DELETE ON public.showcase_dataset_import_chunks
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_update_or_delete();
CREATE TRIGGER showcase_identity_operations_deny_delete
  BEFORE DELETE ON public.showcase_identity_operations
  FOR EACH ROW EXECUTE FUNCTION public.showcase_deny_delete();

-- Durable replay evidence: identity/checksum/kind are immutable and status advances one way from
-- processing to a terminal completed/rejected with a write-once coherent result and timestamp.
CREATE FUNCTION public.showcase_guard_operation_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.operation_id <> OLD.operation_id OR NEW.owner_id <> OLD.owner_id
     OR NEW.operation_kind <> OLD.operation_kind OR NEW.request_checksum <> OLD.request_checksum
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'processing' THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_TERMINAL' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('completed', 'rejected')
     OR NEW.result IS NULL OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_COMPLETION_INVALID' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_identity_operations_guard_update
  BEFORE UPDATE ON public.showcase_identity_operations
  FOR EACH ROW EXECUTE FUNCTION public.showcase_guard_operation_change();

-- RFC 8785 (JCS) canonicalization plus SHA-256 for the restricted I-JSON domain in
-- section 10. Implemented as three ungranted, stateless, IMMUTABLE helpers:
--   * showcase_jcs_estr(text)             -> RFC 8785 escaped JSON string (with quotes)
--   * showcase_jcs_canonicalize(jsonb)    -> canonical UTF-8 bytes (recursive)
--   * showcase_jcs_sha256(jsonb)          -> exactly 32 bytes, SHA-256 of the canonical form
-- The prior single stateful GUC-based helper was rejected: it violated the exact
-- 32-byte return contract, could not be IMMUTABLE, and used pgcrypto digest() which is
-- unresolvable under the pinned search_path on Supabase. The built-in pg_catalog
-- sha256(bytea) is used instead, so no extension dependency exists. Object keys in this
-- domain are printable ASCII field names, for which C-collation ordering is identical to
-- RFC 8785 UTF-16 code-unit ordering; non-ASCII keys are rejected so the equivalence holds.
CREATE FUNCTION public.showcase_jcs_estr(p_in text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $showcase_jcs_estr$
DECLARE
  s text;
  i integer;
BEGIN
  s := replace(p_in, '\', '\\');
  s := replace(s, '"', '\"');
  s := replace(s, E'\x08', '\b');
  s := replace(s, E'\x09', '\t');
  s := replace(s, E'\x0A', '\n');
  s := replace(s, E'\x0C', '\f');
  s := replace(s, E'\x0D', '\r');
  FOR i IN 1..31 LOOP
    IF i NOT IN (8, 9, 10, 12, 13) THEN
      s := replace(s, chr(i), '\u' || lpad(to_hex(i), 4, '0'));
    END IF;
  END LOOP;
  RETURN '"' || s || '"';
END;
$showcase_jcs_estr$;

CREATE FUNCTION public.showcase_jcs_canonicalize(p_value jsonb, p_depth integer DEFAULT 0)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $showcase_jcs$
DECLARE
  value_type text := jsonb_typeof(p_value);
  canonical bytea;
  numeric_value numeric;
  item_value jsonb;
  object_key text;
  first_item boolean := true;
BEGIN
  IF p_depth > 128 THEN
    RAISE EXCEPTION 'SHOWCASE_JCS_DEPTH_EXCEEDED' USING ERRCODE = '54001';
  END IF;
  IF value_type = 'null' THEN
    RETURN convert_to('null', 'UTF8');
  ELSIF value_type = 'boolean' THEN
    RETURN convert_to(CASE WHEN p_value = 'true'::jsonb THEN 'true' ELSE 'false' END, 'UTF8');
  ELSIF value_type = 'number' THEN
    numeric_value := p_value::text::numeric;
    IF numeric_value <> trunc(numeric_value)
       OR abs(numeric_value) > 9007199254740991::numeric THEN
      RAISE EXCEPTION 'SHOWCASE_JCS_NUMBER_OUT_OF_DOMAIN' USING ERRCODE = '22023';
    END IF;
    RETURN convert_to(trim_scale(numeric_value)::text, 'UTF8');
  ELSIF value_type = 'string' THEN
    RETURN convert_to(public.showcase_jcs_estr(p_value #>> '{}'), 'UTF8');
  ELSIF value_type = 'array' THEN
    canonical := convert_to('[', 'UTF8');
    FOR item_value IN
      SELECT value FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value, ordinal)
      ORDER BY ordinal
    LOOP
      IF NOT first_item THEN canonical := canonical || convert_to(',', 'UTF8'); END IF;
      canonical := canonical || public.showcase_jcs_canonicalize(item_value, p_depth + 1);
      first_item := false;
    END LOOP;
    RETURN canonical || convert_to(']', 'UTF8');
  ELSIF value_type = 'object' THEN
    canonical := convert_to('{', 'UTF8');
    FOR object_key, item_value IN
      SELECT e.key, e.value FROM jsonb_each(p_value) e ORDER BY e.key COLLATE "C"
    LOOP
      IF object_key !~ '^[ -~]+$' THEN
        RAISE EXCEPTION 'SHOWCASE_JCS_KEY_INVALID' USING ERRCODE = '22023';
      END IF;
      IF NOT first_item THEN canonical := canonical || convert_to(',', 'UTF8'); END IF;
      canonical := canonical
        || convert_to(public.showcase_jcs_estr(object_key) || ':', 'UTF8')
        || public.showcase_jcs_canonicalize(item_value, p_depth + 1);
      first_item := false;
    END LOOP;
    RETURN canonical || convert_to('}', 'UTF8');
  ELSE
    RAISE EXCEPTION 'SHOWCASE_JCS_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;
END;
$showcase_jcs$;

CREATE FUNCTION public.showcase_jcs_sha256(p_value jsonb)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $showcase_jcs_sha256$
  SELECT sha256(public.showcase_jcs_canonicalize(p_value, 0));
$showcase_jcs_sha256$;

-- Ungranted I-JSON field validators for the section 10.3 row schemas. A present member is
-- either JSON null or a trimmed NFC string within the stated character bound; empty string
-- is never a substitute for null. Safe unsigned integers are JSON numbers in [0, 2^53-1].
CREATE FUNCTION public.showcase_ijson_text_ok(p_value jsonb, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_value IS NOT NULL AND (
    p_value = 'null'::jsonb
    OR (
      jsonb_typeof(p_value) = 'string'
      AND (p_value #>> '{}') = btrim(p_value #>> '{}')
      AND char_length(p_value #>> '{}') BETWEEN 1 AND p_max
      AND (p_value #>> '{}') IS NFC NORMALIZED
    )
  );
$$;

CREATE FUNCTION public.showcase_ijson_safe_uint_ok(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_value IS NOT NULL
    AND jsonb_typeof(p_value) = 'number'
    AND (p_value::text::numeric) = trunc(p_value::text::numeric)
    AND (p_value::text::numeric) BETWEEN 0 AND 9007199254740991::numeric;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_dataset_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.dataset_id <> OLD.dataset_id
     OR NEW.owner_id <> OLD.owner_id
     OR NEW.enrollment_version <> OLD.enrollment_version
     OR NEW.manifest_checksum IS DISTINCT FROM OLD.manifest_checksum
     OR NEW.enrollment_evidence_reference <> OLD.enrollment_evidence_reference
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_BINDING_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.enrollment_status = OLD.enrollment_status THEN
    IF NEW.revision <> OLD.revision
       OR NEW.adopted_at IS DISTINCT FROM OLD.adopted_at
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'SHOWCASE_DATASET_TRANSITION_REQUIRED' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  allowed := (OLD.enrollment_status = 'enrolled' AND NEW.enrollment_status IN ('adopted', 'revoked', 'quarantined'))
    OR (OLD.enrollment_status = 'adopted' AND NEW.enrollment_status IN ('revoked', 'quarantined'))
    OR (OLD.enrollment_status = 'staged' AND NEW.enrollment_status IN ('revoked', 'quarantined'))
    OR (OLD.enrollment_status = 'quarantined' AND NEW.enrollment_status = 'revoked');
  IF NOT allowed THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  IF NEW.enrollment_status = 'adopted' THEN
    IF OLD.enrollment_status <> 'enrolled' OR OLD.adopted_at IS NOT NULL OR NEW.adopted_at IS NULL THEN
      RAISE EXCEPTION 'SHOWCASE_DATASET_ADOPTION_INVALID' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.adopted_at IS DISTINCT FROM OLD.adopted_at THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_ADOPTION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.enrollment_status = 'revoked' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'SHOWCASE_DATASET_REVOCATION_INVALID' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_REVOCATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_import_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed boolean;
  mutation_context text := NULLIF(current_setting('showcase.identity_mutation', true), '');
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id
     OR NEW.source_dataset_id IS DISTINCT FROM OLD.source_dataset_id
     OR NEW.source_schema_version <> OLD.source_schema_version
     OR NEW.backup_checksum <> OLD.backup_checksum
     OR NEW.manifest_checksum IS DISTINCT FROM OLD.manifest_checksum
     OR NEW.import_namespace <> OLD.import_namespace
     OR NEW.operation_id <> OLD.operation_id
     OR NEW.start_request_checksum <> OLD.start_request_checksum
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_EVIDENCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.sealed_at IS NOT NULL AND (
      NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
      OR NEW.identity_package_checksum IS DISTINCT FROM OLD.identity_package_checksum
      OR NEW.final_result IS DISTINCT FROM OLD.final_result
    ) THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_SEAL_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.identity_package_checksum IS NOT NULL
     AND NEW.identity_package_checksum IS DISTINCT FROM OLD.identity_package_checksum THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_PACKAGE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.final_result IS NOT NULL AND NEW.final_result IS DISTINCT FROM OLD.final_result THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_RESULT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF NEW.processing_state = OLD.processing_state THEN
    IF NEW.sealed_at IS NOT DISTINCT FROM OLD.sealed_at
       AND NEW.identity_package_checksum IS NOT DISTINCT FROM OLD.identity_package_checksum
       AND NEW.final_result IS NOT DISTINCT FROM OLD.final_result
       AND NEW.conflict_count = OLD.conflict_count
       AND NEW.revision = OLD.revision THEN
      RETURN NEW;
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'SHOWCASE_IMPORT_REVISION_REQUIRED' USING ERRCODE = '40001';
    END IF;
    IF NEW.conflict_count <> OLD.conflict_count AND mutation_context <> 'candidate_stage' THEN
      RAISE EXCEPTION 'SHOWCASE_IMPORT_CONFLICT_CONTEXT_REQUIRED' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  allowed := (OLD.processing_state = 'staged' AND NEW.processing_state IN ('adjudicating', 'adopted', 'rejected', 'quarantined'))
    OR (OLD.processing_state = 'adjudicating' AND NEW.processing_state IN ('adopted', 'rejected', 'quarantined'))
    OR (OLD.processing_state = 'quarantined' AND NEW.processing_state = 'rejected');
  IF NOT allowed THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_REVISION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_transfer_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_id text := current_setting('showcase.transfer_evidence_id', true);
BEGIN
  IF NEW.id <> OLD.id OR NEW.specimen_key <> OLD.specimen_key
     OR NEW.from_owner_id <> OLD.from_owner_id OR NEW.to_owner_id <> OLD.to_owner_id
     OR NEW.evidence_kind <> OLD.evidence_kind OR NEW.evidence_reference <> OLD.evidence_reference
     OR NEW.evidence_checksum <> OLD.evidence_checksum OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_EVIDENCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.finality_state <> 'pending' AND NEW.finality_state <> OLD.finality_state THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_FINALITY_TERMINAL' USING ERRCODE = '55000';
  END IF;
  IF OLD.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_ALREADY_COMMITTED' USING ERRCODE = '55000';
  END IF;
  IF NEW.processed_at IS NOT NULL AND (transfer_id IS NULL OR transfer_id <> OLD.id::text) THEN
    RAISE EXCEPTION 'SHOWCASE_TRANSFER_COMMIT_GUARD_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_alias_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  mutation_context text := NULLIF(current_setting('showcase.identity_mutation', true), '');
BEGIN
  IF NEW.id <> OLD.id OR NEW.entity_key <> OLD.entity_key OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.owner_scope_id IS DISTINCT FROM OLD.owner_scope_id OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
     OR NEW.alias_kind <> OLD.alias_kind OR NEW.namespace <> OLD.namespace OR NEW.value <> OLD.value
     OR NEW.initial_evidence_kind <> OLD.initial_evidence_kind
     OR NEW.initial_evidence_reference IS DISTINCT FROM OLD.initial_evidence_reference
     OR NEW.initial_evidence_checksum IS DISTINCT FROM OLD.initial_evidence_checksum
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_TUPLE_TARGET_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('revoked', 'superseded', 'tombstoned') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_STATUS_TERMINAL' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF mutation_context NOT IN ('candidate_stage', 'adjudicate') OR NOT EXISTS (
      SELECT 1 FROM public.showcase_alias_events ae
      WHERE ae.alias_id = OLD.id AND ae.resulting_status = NEW.status
        AND ae.created_at >= transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'SHOWCASE_ALIAS_EVENT_REQUIRED' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_claim_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  mutation_context text := NULLIF(current_setting('showcase.identity_mutation', true), '');
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.entity_kind <> OLD.entity_kind
     OR NEW.alias_kind <> OLD.alias_kind OR NEW.namespace <> OLD.namespace OR NEW.value <> OLD.value
     OR NEW.candidate_entity_key <> OLD.candidate_entity_key OR NEW.candidate_checksum <> OLD.candidate_checksum
     OR NEW.evidence_kind <> OLD.evidence_kind
     OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_ALIAS_CLAIM_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('accepted', 'rejected', 'withdrawn') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'SHOWCASE_CLAIM_STATUS_TERMINAL' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND mutation_context NOT IN ('candidate_stage', 'adjudicate') THEN
    RAISE EXCEPTION 'SHOWCASE_CLAIM_CONTEXT_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_guard_conflict_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  mutation_context text := NULLIF(current_setting('showcase.identity_mutation', true), '');
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id
     OR NEW.conflict_kind <> OLD.conflict_kind OR NEW.reason_code <> OLD.reason_code
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_IDENTITY_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'open' AND (NEW.status <> OLD.status OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_RESOLUTION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND mutation_context <> 'adjudicate' THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_CONTEXT_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_validate_conflict_claim_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE conflict_owner uuid; conflict_status text; claim_owner uuid; candidate_key uuid; entity_owner uuid;
BEGIN
  -- Entity-before-conflict lock order (matches the R1.2 transfer path): lock the claim and its
  -- candidate entity first, then the conflict.
  SELECT owner_id, candidate_entity_key INTO STRICT claim_owner, candidate_key
  FROM public.showcase_alias_claims WHERE id = NEW.claim_id FOR KEY SHARE;
  SELECT owner_id INTO STRICT entity_owner FROM public.showcase_entities
  WHERE public_key = candidate_key FOR KEY SHARE;
  SELECT owner_id, status INTO STRICT conflict_owner, conflict_status
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id FOR UPDATE;
  IF conflict_status <> 'open' THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_LINK_CLOSED' USING ERRCODE = '55000';
  END IF;
  IF conflict_owner <> claim_owner OR claim_owner <> entity_owner THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_validate_conflict_entity_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE conflict_owner uuid; conflict_status text; entity_owner uuid;
BEGIN
  -- Entity-before-conflict lock order: lock the entity first, then the conflict.
  SELECT owner_id INTO STRICT entity_owner FROM public.showcase_entities
  WHERE public_key = NEW.entity_key FOR KEY SHARE;
  SELECT owner_id, status INTO STRICT conflict_owner, conflict_status
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id FOR UPDATE;
  IF conflict_status <> 'open' THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_LINK_CLOSED' USING ERRCODE = '55000';
  END IF;
  IF conflict_owner <> entity_owner THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.showcase_validate_identity_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  conflict_owner uuid; conflict_status text; entity_owner uuid; expected_checksums jsonb;
BEGIN
  PERFORM e.public_key FROM public.showcase_entities e
  WHERE e.public_key IN (
    SELECT ice.entity_key FROM public.showcase_identity_conflict_entities ice WHERE ice.conflict_id = NEW.conflict_id
  ) ORDER BY e.public_key FOR UPDATE;
  IF NEW.chosen_entity_key IS NOT NULL THEN
    SELECT owner_id INTO STRICT entity_owner FROM public.showcase_entities
    WHERE public_key = NEW.chosen_entity_key;
  END IF;
  SELECT owner_id, status INTO STRICT conflict_owner, conflict_status
  FROM public.showcase_identity_conflicts WHERE id = NEW.conflict_id FOR UPDATE;
  IF conflict_status <> 'open' OR conflict_owner <> NEW.actor_owner_id THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_OWNER_OR_STATE_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW.chosen_entity_key IS NOT NULL AND (
      entity_owner <> conflict_owner OR NOT EXISTS (
        SELECT 1 FROM public.showcase_identity_conflict_entities
        WHERE conflict_id = NEW.conflict_id AND entity_key = NEW.chosen_entity_key
      )
    ) THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_ENTITY_NOT_LINKED' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(jsonb_object_agg(ac.id::text, encode(ac.candidate_checksum, 'hex') ORDER BY ac.id::text), '{}'::jsonb)
  INTO expected_checksums
  FROM public.showcase_identity_conflict_claims icc
  JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
  WHERE icc.conflict_id = NEW.conflict_id;
  IF NEW.candidate_checksums <> expected_checksums THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_CHECKSUM_MAP_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.showcase_issue_wallet_link_nonce(
  p_owner_id uuid, p_chain_id bigint, p_normalized_wallet_address text,
  p_purpose text, p_app_origin text, p_privy_app_id text, p_nonce_hash bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE nonce_id uuid; issued_time timestamptz := date_trunc('second', clock_timestamp());
BEGIN
  IF p_owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.showcase_owner_principals WHERE id = p_owner_id)
     OR p_chain_id IS NULL OR p_chain_id <= 0
     OR p_normalized_wallet_address IS NULL OR p_normalized_wallet_address !~ '^0x[0-9a-f]{40}$'
     OR p_purpose IS NULL OR p_purpose <> 'link_showcase_wallet'
     OR p_app_origin IS NULL OR p_app_origin <> btrim(p_app_origin) OR char_length(p_app_origin) NOT BETWEEN 8 AND 255
     OR p_privy_app_id IS NULL OR p_privy_app_id !~ '^[A-Za-z0-9_-]{1,128}$'
     OR p_nonce_hash IS NULL OR octet_length(p_nonce_hash) <> 32 THEN
    RAISE EXCEPTION 'SHOWCASE_NONCE_REQUEST_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.showcase_wallet_link_nonces (
    owner_id, chain_id, normalized_wallet_address, purpose, message_version,
    app_origin, privy_app_id, nonce_hash, issued_at, expires_at
  ) VALUES (
    p_owner_id, p_chain_id, p_normalized_wallet_address, p_purpose, 1,
    p_app_origin, p_privy_app_id, p_nonce_hash, issued_time, issued_time + interval '300 seconds'
  ) RETURNING id INTO nonce_id;
  RETURN jsonb_build_object(
    'nonceId', nonce_id, 'wallet', p_normalized_wallet_address, 'chainId', p_chain_id::text,
    'purpose', p_purpose, 'appOrigin', p_app_origin, 'privyAppId', p_privy_app_id,
    'issuedAt', to_char(issued_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expirationTime', to_char((issued_time + interval '300 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

CREATE FUNCTION public.showcase_consume_wallet_link_nonce(
  p_owner_id uuid, p_nonce_id uuid, p_nonce_hash bytea, p_chain_id bigint,
  p_normalized_wallet_address text, p_display_wallet_address text, p_purpose text,
  p_app_origin text, p_privy_app_id text, p_issued_at timestamptz, p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nonce_row public.showcase_wallet_link_nonces%ROWTYPE;
  wallet_id uuid;
  wallet_row public.showcase_owner_wallets%ROWTYPE;
  consumed_time timestamptz;
BEGIN
  -- Every binding field is required. A NULL argument must never satisfy the proof:
  -- three-valued <> comparisons collapse to NULL and were previously treated as "not true",
  -- which let a NULL hash/purpose/origin/timestamp reach consumption and wallet linking.
  IF p_owner_id IS NULL OR p_nonce_id IS NULL OR p_nonce_hash IS NULL OR p_chain_id IS NULL
     OR p_normalized_wallet_address IS NULL OR p_purpose IS NULL OR p_app_origin IS NULL
     OR p_privy_app_id IS NULL OR p_issued_at IS NULL OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_PROOF_INVALID_OR_EXPIRED' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO STRICT nonce_row FROM public.showcase_wallet_link_nonces
  WHERE id = p_nonce_id FOR UPDATE;
  IF nonce_row.owner_id IS DISTINCT FROM p_owner_id
     OR nonce_row.nonce_hash IS DISTINCT FROM p_nonce_hash
     OR nonce_row.chain_id IS DISTINCT FROM p_chain_id
     OR nonce_row.normalized_wallet_address IS DISTINCT FROM p_normalized_wallet_address
     OR nonce_row.purpose IS DISTINCT FROM p_purpose
     OR nonce_row.app_origin IS DISTINCT FROM p_app_origin
     OR nonce_row.privy_app_id IS DISTINCT FROM p_privy_app_id
     OR nonce_row.issued_at IS DISTINCT FROM p_issued_at
     OR nonce_row.expires_at IS DISTINCT FROM p_expires_at
     OR nonce_row.consumed_at IS NOT NULL
     OR clock_timestamp() >= nonce_row.expires_at THEN
    RAISE EXCEPTION 'SHOWCASE_WALLET_PROOF_INVALID_OR_EXPIRED' USING ERRCODE = '55000';
  END IF;
  consumed_time := clock_timestamp();
  UPDATE public.showcase_wallet_link_nonces SET consumed_at = consumed_time WHERE id = nonce_row.id;
  wallet_id := public.showcase_link_owner_wallet(
    p_owner_id, p_chain_id, p_normalized_wallet_address, p_display_wallet_address,
    'eip191_nonce', nonce_row.id::text
  );
  -- Return the persisted immutable wallet timestamps, not the local consume time, so an
  -- idempotent re-link reports the original verification instant.
  SELECT * INTO STRICT wallet_row FROM public.showcase_owner_wallets WHERE id = wallet_id;
  RETURN jsonb_build_object(
    'walletId', wallet_id, 'chainId', p_chain_id::text,
    'normalizedAddress', p_normalized_wallet_address,
    'displayAddress', wallet_row.display_wallet_address,
    'verifiedAt', to_char(wallet_row.verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revokedAt', CASE WHEN wallet_row.revoked_at IS NULL THEN NULL
      ELSE to_char(wallet_row.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
  );
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'SHOWCASE_WALLET_PROOF_INVALID_OR_EXPIRED' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.showcase_owner_identity_state(
  p_owner_id uuid, p_after_entity_key uuid DEFAULT NULL, p_entity_limit integer DEFAULT 50,
  p_after_conflict_id uuid DEFAULT NULL, p_conflict_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entities_json jsonb; conflicts_json jsonb; datasets_json jsonb; imports_json jsonb;
  entity_next uuid; conflict_next uuid;
  datasets_truncated boolean; imports_truncated boolean;
  result jsonb;
BEGIN
  IF p_owner_id IS NULL OR p_entity_limit NOT BETWEEN 1 AND 100 OR p_conflict_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'SHOWCASE_IDENTITY_PAGE_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Cursor keys are derived with ORDER BY/LIMIT, never min()/max() over uuid (no such aggregate).
  WITH page AS (
    SELECT e.public_key, e.entity_kind, e.identity_state, e.revision,
      row_number() OVER (ORDER BY e.public_key) AS rn
    FROM public.showcase_entities e
    WHERE e.owner_id = p_owner_id AND (p_after_entity_key IS NULL OR e.public_key > p_after_entity_key)
    ORDER BY e.public_key LIMIT p_entity_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'entityId', CASE entity_kind WHEN 'tank' THEN 'tank_' ELSE 'spec_' END || public_key::text,
      'kind', entity_kind, 'identityState', identity_state, 'revision', revision
    ) ORDER BY public_key) FILTER (WHERE rn <= p_entity_limit), '[]'::jsonb),
    (SELECT public_key FROM page
     WHERE rn = p_entity_limit AND EXISTS (SELECT 1 FROM page WHERE rn = p_entity_limit + 1))
  INTO entities_json, entity_next FROM page;

  WITH page AS (
    SELECT c.id, c.conflict_kind, c.reason_code, c.status,
      (SELECT count(*) FROM public.showcase_identity_conflict_entities ce WHERE ce.conflict_id = c.id) AS candidate_count,
      row_number() OVER (ORDER BY c.id) AS rn
    FROM public.showcase_identity_conflicts c
    WHERE c.owner_id = p_owner_id AND (p_after_conflict_id IS NULL OR c.id > p_after_conflict_id)
    ORDER BY c.id LIMIT p_conflict_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conflictId', id, 'kind', conflict_kind, 'reason', reason_code,
      'status', status, 'candidateCount', candidate_count
    ) ORDER BY id) FILTER (WHERE rn <= p_conflict_limit), '[]'::jsonb),
    (SELECT id FROM page
     WHERE rn = p_conflict_limit AND EXISTS (SELECT 1 FROM page WHERE rn = p_conflict_limit + 1))
  INTO conflicts_json, conflict_next FROM page;

  -- Datasets and imports are summaries, not authority; cap them so the DTO stays bounded.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'datasetId', dataset_id, 'status', enrollment_status, 'version', enrollment_version,
      'revision', revision, 'active', enrollment_status IN ('enrolled', 'adopted') AND revoked_at IS NULL
    ) ORDER BY created_at DESC, dataset_id) FILTER (WHERE rn <= 100), '[]'::jsonb),
    bool_or(rn > 100)
  INTO datasets_json, datasets_truncated
  FROM (
    SELECT dataset_id, enrollment_status, enrollment_version, revision, revoked_at, created_at,
      row_number() OVER (ORDER BY created_at DESC, dataset_id) AS rn
    FROM public.showcase_datasets WHERE owner_id = p_owner_id
  ) d;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'importId', id, 'schemaVersion', source_schema_version, 'state', processing_state,
      'conflictCount', conflict_count, 'revision', revision
    ) ORDER BY created_at DESC, id) FILTER (WHERE rn <= 100), '[]'::jsonb),
    bool_or(rn > 100)
  INTO imports_json, imports_truncated
  FROM (
    SELECT id, source_schema_version, processing_state, conflict_count, revision, created_at,
      row_number() OVER (ORDER BY created_at DESC, id) AS rn
    FROM public.showcase_dataset_imports WHERE owner_id = p_owner_id
  ) i;

  result := jsonb_build_object(
    'entities', entities_json, 'entityNextKey', entity_next,
    'conflicts', conflicts_json, 'conflictNextKey', conflict_next,
    'datasets', datasets_json, 'datasetsTruncated', COALESCE(datasets_truncated, false),
    'imports', imports_json, 'importsTruncated', COALESCE(imports_truncated, false)
  );
  IF octet_length(result::text) > 262144 THEN
    RAISE EXCEPTION 'SHOWCASE_IDENTITY_DTO_TOO_LARGE' USING ERRCODE = '54000';
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION public.showcase_owner_identity_conflict_candidates(
  p_owner_id uuid, p_conflict_id uuid,
  p_after_candidate_entity_key uuid DEFAULT NULL, p_candidate_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE candidates_json jsonb; next_key uuid; conflict_status text;
BEGIN
  IF p_owner_id IS NULL OR p_conflict_id IS NULL OR p_candidate_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_PAGE_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Lock/recheck same-owner conflict visibility so the candidate page is consistent with a
  -- concurrent resolution; this is intentionally VOLATILE, not a read-only STABLE surface.
  SELECT status INTO STRICT conflict_status FROM public.showcase_identity_conflicts
  WHERE id = p_conflict_id AND owner_id = p_owner_id FOR SHARE;
  WITH page AS (
    SELECT e.public_key, e.entity_kind, e.identity_state,
      row_number() OVER (ORDER BY e.public_key) AS rn
    FROM public.showcase_identity_conflict_entities ce
    JOIN public.showcase_entities e ON e.public_key = ce.entity_key AND e.owner_id = p_owner_id
    WHERE ce.conflict_id = p_conflict_id
      AND (p_after_candidate_entity_key IS NULL OR e.public_key > p_after_candidate_entity_key)
    ORDER BY e.public_key LIMIT p_candidate_limit + 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'entityId', CASE entity_kind WHEN 'tank' THEN 'tank_' ELSE 'spec_' END || public_key::text,
      'kind', entity_kind, 'identityState', identity_state
    ) ORDER BY public_key) FILTER (WHERE rn <= p_candidate_limit), '[]'::jsonb),
    (SELECT public_key FROM page
     WHERE rn = p_candidate_limit AND EXISTS (SELECT 1 FROM page WHERE rn = p_candidate_limit + 1))
  INTO candidates_json, next_key FROM page;
  RETURN jsonb_build_object(
    'conflictId', p_conflict_id, 'status', conflict_status,
    'candidates', candidates_json, 'nextKey', next_key
  );
EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'SHOWCASE_NOT_FOUND' USING ERRCODE = 'P0002';
END;
$$;

CREATE FUNCTION public.showcase_enroll_dataset(
  p_owner_id uuid, p_dataset_id uuid, p_enrollment_version integer, p_initial_manifest_checksum bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE existing_row public.showcase_datasets%ROWTYPE; new_status text; evidence_reference text;
BEGIN
  IF p_owner_id IS NULL OR p_dataset_id IS NULL OR p_enrollment_version IS NULL OR p_enrollment_version <= 0
     OR (p_initial_manifest_checksum IS NOT NULL AND octet_length(p_initial_manifest_checksum) <> 32) THEN
    RAISE EXCEPTION 'SHOWCASE_DATASET_ENROLLMENT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  SELECT * INTO existing_row FROM public.showcase_datasets WHERE dataset_id = p_dataset_id FOR UPDATE;
  IF FOUND THEN
    IF existing_row.owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'SHOWCASE_DATASET_UNAVAILABLE' USING ERRCODE = '23505';
    END IF;
    IF existing_row.enrollment_version <> p_enrollment_version
       OR existing_row.manifest_checksum IS DISTINCT FROM p_initial_manifest_checksum THEN
      RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'datasetId', existing_row.dataset_id, 'status', existing_row.enrollment_status,
      'version', existing_row.enrollment_version, 'revision', existing_row.revision,
      'enrollmentReference', existing_row.enrollment_evidence_reference, 'replay', true
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.showcase_datasets
    WHERE owner_id = p_owner_id AND enrollment_status IN ('enrolled', 'adopted') AND revoked_at IS NULL
  ) THEN new_status := 'enrolled'; ELSE new_status := 'staged'; END IF;
  evidence_reference := 'enroll:v1:' || gen_random_uuid()::text;
  INSERT INTO public.showcase_datasets (
    dataset_id, owner_id, enrollment_version, enrollment_status,
    manifest_checksum, enrollment_evidence_reference
  ) VALUES (
    p_dataset_id, p_owner_id, p_enrollment_version, new_status,
    p_initial_manifest_checksum, evidence_reference
  ) RETURNING * INTO existing_row;
  RETURN jsonb_build_object(
    'datasetId', existing_row.dataset_id, 'status', existing_row.enrollment_status,
    'version', existing_row.enrollment_version, 'revision', existing_row.revision,
    'enrollmentReference', existing_row.enrollment_evidence_reference, 'replay', false
  );
END;
$$;

CREATE FUNCTION public.showcase_start_dataset_import(
  p_owner_id uuid, p_operation_id uuid, p_start_request_checksum bytea,
  p_source_dataset_id uuid, p_enrollment_reference text, p_source_schema_version integer,
  p_backup_checksum bytea, p_manifest_checksum bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE existing_import public.showcase_dataset_imports%ROWTYPE; dataset_row public.showcase_datasets%ROWTYPE;
  import_id uuid := gen_random_uuid(); derived_dataset_id uuid; initial_state text; derived_namespace text;
BEGIN
  IF p_owner_id IS NULL OR p_operation_id IS NULL OR p_start_request_checksum IS NULL
     OR octet_length(p_start_request_checksum) <> 32 OR p_backup_checksum IS NULL
     OR octet_length(p_backup_checksum) <> 32 OR p_source_schema_version NOT IN (1,2,3)
     OR (p_manifest_checksum IS NOT NULL AND octet_length(p_manifest_checksum) <> 32) THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_START_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_source_schema_version = 3 AND (
      p_source_dataset_id IS NULL OR p_enrollment_reference IS NULL
      OR p_enrollment_reference <> btrim(p_enrollment_reference)
      OR char_length(p_enrollment_reference) NOT BETWEEN 1 AND 512
      OR p_manifest_checksum IS NULL
    ) THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_V3_BINDING_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_source_schema_version IN (1,2) AND (
      p_source_dataset_id IS NOT NULL OR p_enrollment_reference IS NOT NULL OR p_manifest_checksum IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_LEGACY_BINDING_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  SELECT * INTO existing_import FROM public.showcase_dataset_imports
  WHERE owner_id = p_owner_id AND operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF existing_import.start_request_checksum <> p_start_request_checksum THEN
      RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'importId', existing_import.id, 'processingState', existing_import.processing_state,
      'revision', existing_import.revision, 'sealed', existing_import.sealed_at IS NOT NULL,
      'replay', true
    );
  END IF;
  IF (SELECT count(*) FROM public.showcase_dataset_imports WHERE owner_id = p_owner_id AND sealed_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_UNSEALED_LIMIT' USING ERRCODE = '54000';
  END IF;

  IF p_source_schema_version = 3 THEN
    SELECT * INTO dataset_row FROM public.showcase_datasets
    WHERE dataset_id = p_source_dataset_id AND owner_id = p_owner_id
      AND enrollment_evidence_reference = p_enrollment_reference
    FOR UPDATE;
    IF FOUND AND dataset_row.enrollment_status IN ('enrolled', 'adopted', 'staged')
       AND dataset_row.revoked_at IS NULL THEN
      derived_dataset_id := dataset_row.dataset_id;
      initial_state := 'staged';
      derived_namespace := 'import:v3:' || dataset_row.dataset_id::text || ':' || import_id::text;
    ELSE
      derived_dataset_id := NULL;
      initial_state := 'quarantined';
      derived_namespace := 'import:v3-quarantine:' || import_id::text;
    END IF;
  ELSE
    derived_dataset_id := NULL;
    initial_state := 'quarantined';
    derived_namespace := 'import:v' || p_source_schema_version::text || ':' || import_id::text;
  END IF;

  INSERT INTO public.showcase_dataset_imports (
    id, owner_id, source_dataset_id, source_schema_version, backup_checksum,
    manifest_checksum, import_namespace, processing_state, operation_id, start_request_checksum
  ) VALUES (
    import_id, p_owner_id, derived_dataset_id, p_source_schema_version, p_backup_checksum,
    p_manifest_checksum, derived_namespace, initial_state, p_operation_id, p_start_request_checksum
  ) RETURNING * INTO existing_import;
  RETURN jsonb_build_object(
    'importId', existing_import.id, 'processingState', existing_import.processing_state,
    'revision', existing_import.revision, 'sealed', false, 'replay', false
  );
END;
$$;

CREATE FUNCTION public.showcase_stage_dataset_import_chunk(
  p_owner_id uuid, p_import_id uuid, p_section text, p_chunk_index integer,
  p_row_count integer, p_chunk_checksum bytea, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE import_row public.showcase_dataset_imports%ROWTYPE; existing_chunk public.showcase_dataset_import_chunks%ROWTYPE;
  canonical_payload bytea; calculated_checksum bytea; retained_bytes bigint; import_bytes bigint;
BEGIN
  IF p_owner_id IS NULL OR p_import_id IS NULL OR p_section NOT IN ('tanks','specimens','aliases')
     OR p_chunk_index NOT BETWEEN 0 AND 19 OR p_row_count NOT BETWEEN 0 AND 500
     OR p_chunk_checksum IS NULL OR octet_length(p_chunk_checksum) <> 32
     OR jsonb_typeof(p_payload) <> 'array' OR jsonb_array_length(p_payload) <> p_row_count THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_CHUNK_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  SELECT * INTO STRICT import_row FROM public.showcase_dataset_imports
  WHERE id = p_import_id AND owner_id = p_owner_id FOR UPDATE;
  IF import_row.sealed_at IS NOT NULL OR import_row.processing_state NOT IN ('staged','quarantined') THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_SEALED_OR_TERMINAL' USING ERRCODE = '55000';
  END IF;
  canonical_payload := public.showcase_jcs_canonicalize(p_payload);
  calculated_checksum := sha256(canonical_payload);
  IF calculated_checksum <> p_chunk_checksum OR octet_length(canonical_payload) > 1048576 THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_CHUNK_CHECKSUM_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing_chunk FROM public.showcase_dataset_import_chunks
  WHERE import_id = p_import_id AND section = p_section AND chunk_index = p_chunk_index;
  IF FOUND THEN
    IF existing_chunk.owner_id = p_owner_id AND existing_chunk.row_count = p_row_count
       AND existing_chunk.chunk_checksum = p_chunk_checksum AND existing_chunk.payload = p_payload
       AND existing_chunk.canonical_byte_size = octet_length(canonical_payload) THEN
      RETURN jsonb_build_object('chunkId', existing_chunk.id, 'replay', true);
    END IF;
    RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.showcase_dataset_import_chunks WHERE import_id = p_import_id AND section = p_section) >= 20
     OR (SELECT COALESCE(sum(row_count),0) FROM public.showcase_dataset_import_chunks
         WHERE import_id = p_import_id AND section = p_section) + p_row_count > 10000 THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_SECTION_LIMIT' USING ERRCODE = '54000';
  END IF;
  SELECT COALESCE(sum(canonical_byte_size),0) INTO import_bytes
  FROM public.showcase_dataset_import_chunks WHERE import_id = p_import_id;
  IF import_bytes + octet_length(canonical_payload) > 16777216 THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_PAYLOAD_LIMIT' USING ERRCODE = '54000';
  END IF;
  SELECT COALESCE(sum(canonical_byte_size),0) INTO retained_bytes
  FROM public.showcase_dataset_import_chunks WHERE owner_id = p_owner_id;
  IF retained_bytes + octet_length(canonical_payload) > 104857600 THEN
    RAISE EXCEPTION 'SHOWCASE_OWNER_IMPORT_RETENTION_LIMIT' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.showcase_dataset_import_chunks (
    import_id, owner_id, section, chunk_index, row_count, chunk_checksum,
    payload, canonical_byte_size
  ) VALUES (
    p_import_id, p_owner_id, p_section, p_chunk_index, p_row_count, p_chunk_checksum,
    p_payload, octet_length(canonical_payload)
  ) RETURNING * INTO existing_chunk;
  RETURN jsonb_build_object('chunkId', existing_chunk.id, 'replay', false);
END;
$$;

CREATE FUNCTION public.showcase_finalize_dataset_import(
  p_owner_id uuid, p_import_id uuid, p_expected_revision bigint,
  p_manifest jsonb, p_identity_package_checksum bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  import_row public.showcase_dataset_imports%ROWTYPE; dataset_row public.showcase_datasets%ROWTYPE;
  tanks_rows jsonb; specimens_rows jsonb; aliases_rows jsonb; identity_package jsonb;
  calculated_manifest bytea; calculated_package bytea; manifest_section jsonb; section_rows jsonb;
  section_name text; expected_count integer; expected_hash bytea; calculated_hash bytea;
  row_value jsonb; calculated_row_hash bytea; declared_row_hash bytea;
  previous_key text; current_key text; final_state text; result jsonb;
  chunk_record record; chunk_canonical bytea; exported_ts timestamptz; is_legacy_or_quarantine boolean;
BEGIN
  IF p_owner_id IS NULL OR p_import_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_manifest) <> 'object'
     OR (p_identity_package_checksum IS NOT NULL AND octet_length(p_identity_package_checksum) <> 32) THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_FINALIZE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  SELECT * INTO STRICT import_row FROM public.showcase_dataset_imports
  WHERE id = p_import_id AND owner_id = p_owner_id FOR UPDATE;

  is_legacy_or_quarantine := import_row.source_schema_version IN (1, 2)
    OR import_row.source_dataset_id IS NULL
    OR import_row.processing_state = 'quarantined';

  -- Replay: a sealed import returns its immutable result only on an exact retry. Legacy and
  -- quarantine seals carry a null package checksum, so their replay key is the empty manifest
  -- plus a null package digest; v3 eligible seals compare manifest and package digests.
  IF import_row.sealed_at IS NOT NULL THEN
    IF is_legacy_or_quarantine THEN
      IF p_manifest <> '{}'::jsonb OR p_identity_package_checksum IS NOT NULL THEN
        RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
      END IF;
    ELSE
      IF import_row.manifest_checksum IS DISTINCT FROM public.showcase_jcs_sha256(p_manifest)
         OR import_row.identity_package_checksum IS DISTINCT FROM p_identity_package_checksum THEN
        RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN import_row.final_result || jsonb_build_object('replay', true);
  END IF;
  IF import_row.revision <> p_expected_revision THEN
    -- A stale expected revision is a client CAS miss, not owner contention: fail with a
    -- non-retryable state conflict (55000) rather than the retryable serialization class (40001).
    RAISE EXCEPTION 'SHOWCASE_REVISION_CONFLICT' USING ERRCODE = '55000';
  END IF;

  -- Lock the entire chunk set (the owner advisory lock above already serializes this owner's
  -- identity operations) and independently recompute every persisted chunk digest and canonical
  -- byte size before trusting any stored payload. Immutable chunks make this the durable authority.
  FOR chunk_record IN
    SELECT id, payload, chunk_checksum, canonical_byte_size
    FROM public.showcase_dataset_import_chunks
    WHERE import_id = p_import_id ORDER BY section, chunk_index FOR UPDATE
  LOOP
    chunk_canonical := public.showcase_jcs_canonicalize(chunk_record.payload);
    IF sha256(chunk_canonical) <> chunk_record.chunk_checksum
       OR octet_length(chunk_canonical) <> chunk_record.canonical_byte_size THEN
      RAISE EXCEPTION 'SHOWCASE_CHUNK_CHECKSUM_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  -- Legacy (v1/v2) and v3-binding-quarantine imports seal as noneligible with a null package
  -- checksum. The caller presents the empty manifest and a null package digest.
  IF is_legacy_or_quarantine THEN
    IF p_manifest <> '{}'::jsonb OR p_identity_package_checksum IS NOT NULL THEN
      RAISE EXCEPTION 'SHOWCASE_LEGACY_MANIFEST_INVALID' USING ERRCODE = '23514';
    END IF;
    result := jsonb_build_object(
      'importId', import_row.id, 'datasetId', NULL, 'processingState', 'quarantined',
      'eligible', false, 'adopted', false, 'replay', false, 'conflictCount', 0
    );
    UPDATE public.showcase_dataset_imports
      SET processing_state = 'quarantined', sealed_at = clock_timestamp(),
          final_result = result, revision = revision + 1
      WHERE id = import_row.id;
    RETURN result;
  END IF;

  -- v3 eligible finalize requires a staged source and a nonnull package digest declaration.
  IF import_row.processing_state <> 'staged' THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;
  IF p_identity_package_checksum IS NULL THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_FINALIZE_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Manifest shape and exact typed values. `= 'x'::jsonb` compares are type-strict, so a JSON
  -- string "1" never satisfies a numeric 1.
  IF p_manifest - ARRAY['manifestVersion','schemaVersion','datasetId','enrollmentReference','exportedAt','sections']::text[] <> '{}'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(p_manifest)) <> 6
     OR p_manifest->'manifestVersion' <> '1'::jsonb
     OR p_manifest->'schemaVersion' <> '3'::jsonb
     OR jsonb_typeof(p_manifest->'datasetId') <> 'string'
     OR p_manifest->>'datasetId' <> import_row.source_dataset_id::text
     OR jsonb_typeof(p_manifest->'enrollmentReference') <> 'string'
     OR jsonb_typeof(p_manifest->'exportedAt') <> 'string'
     OR p_manifest->>'exportedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
     OR jsonb_typeof(p_manifest->'sections') <> 'array'
     OR jsonb_array_length(p_manifest->'sections') <> 3 THEN
    RAISE EXCEPTION 'SHOWCASE_MANIFEST_INVALID' USING ERRCODE = '23514';
  END IF;
  BEGIN
    exported_ts := (replace(replace(p_manifest->>'exportedAt', 'T', ' '), 'Z', '+00'))::timestamptz;
    IF to_char(exported_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') <> p_manifest->>'exportedAt' THEN
      RAISE EXCEPTION 'SHOWCASE_MANIFEST_INVALID' USING ERRCODE = '23514';
    END IF;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'SHOWCASE_MANIFEST_INVALID' USING ERRCODE = '23514';
  END;

  SELECT * INTO STRICT dataset_row FROM public.showcase_datasets
  WHERE dataset_id = import_row.source_dataset_id AND owner_id = p_owner_id FOR UPDATE;
  IF p_manifest->>'enrollmentReference' <> dataset_row.enrollment_evidence_reference
     OR dataset_row.enrollment_status NOT IN ('enrolled','adopted','staged') OR dataset_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_BINDING_INVALID' USING ERRCODE = '55000';
  END IF;
  calculated_manifest := public.showcase_jcs_sha256(p_manifest);
  IF import_row.manifest_checksum <> calculated_manifest THEN
    RAISE EXCEPTION 'SHOWCASE_MANIFEST_CHECKSUM_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(element ORDER BY chunk_index, row_ordinal), '[]'::jsonb) INTO tanks_rows
  FROM public.showcase_dataset_import_chunks c
  CROSS JOIN LATERAL jsonb_array_elements(c.payload) WITH ORDINALITY a(element, row_ordinal)
  WHERE c.import_id = p_import_id AND c.section = 'tanks';
  SELECT COALESCE(jsonb_agg(element ORDER BY chunk_index, row_ordinal), '[]'::jsonb) INTO specimens_rows
  FROM public.showcase_dataset_import_chunks c
  CROSS JOIN LATERAL jsonb_array_elements(c.payload) WITH ORDINALITY a(element, row_ordinal)
  WHERE c.import_id = p_import_id AND c.section = 'specimens';
  SELECT COALESCE(jsonb_agg(element ORDER BY chunk_index, row_ordinal), '[]'::jsonb) INTO aliases_rows
  FROM public.showcase_dataset_import_chunks c
  CROSS JOIN LATERAL jsonb_array_elements(c.payload) WITH ORDINALITY a(element, row_ordinal)
  WHERE c.import_id = p_import_id AND c.section = 'aliases';

  FOR section_name, section_rows IN SELECT * FROM (VALUES
    ('aliases'::text, aliases_rows), ('specimens'::text, specimens_rows), ('tanks'::text, tanks_rows)
  ) AS sections(name, rows)
  LOOP
    SELECT value INTO STRICT manifest_section FROM jsonb_array_elements(p_manifest->'sections') WITH ORDINALITY s(value, ordinal)
    WHERE value->>'name' = section_name
      AND ordinal = CASE section_name WHEN 'aliases' THEN 1 WHEN 'specimens' THEN 2 ELSE 3 END;
    IF manifest_section - ARRAY['name','count','sha256']::text[] <> '{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(manifest_section)) <> 3
       OR NOT public.showcase_ijson_safe_uint_ok(manifest_section->'count')
       OR jsonb_typeof(manifest_section->'sha256') <> 'string'
       OR (manifest_section->>'sha256') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'SHOWCASE_MANIFEST_SECTION_INVALID' USING ERRCODE = '23514';
    END IF;
    expected_count := jsonb_array_length(section_rows);
    expected_hash := decode(manifest_section->>'sha256', 'hex');
    IF (manifest_section->>'count')::numeric <> expected_count::numeric THEN
      RAISE EXCEPTION 'SHOWCASE_MANIFEST_COUNT_INVALID' USING ERRCODE = '23514';
    END IF;
    IF expected_count = 0 AND EXISTS (
      SELECT 1 FROM public.showcase_dataset_import_chunks WHERE import_id = p_import_id AND section = section_name
    ) THEN
      RAISE EXCEPTION 'SHOWCASE_EMPTY_SECTION_HAS_CHUNKS' USING ERRCODE = '23514';
    END IF;
    IF expected_count > 0 AND NOT EXISTS (
      SELECT 1 FROM public.showcase_dataset_import_chunks WHERE import_id = p_import_id AND section = section_name
      HAVING min(chunk_index) = 0 AND max(chunk_index) = count(*) - 1 AND bool_and(row_count > 0)
    ) THEN
      RAISE EXCEPTION 'SHOWCASE_CHUNK_COVERAGE_INVALID' USING ERRCODE = '23514';
    END IF;
    calculated_hash := public.showcase_jcs_sha256(section_rows);
    IF calculated_hash <> expected_hash THEN
      RAISE EXCEPTION 'SHOWCASE_SECTION_CHECKSUM_INVALID' USING ERRCODE = '23514';
    END IF;

    previous_key := NULL;
    FOR row_value IN SELECT value FROM jsonb_array_elements(section_rows)
    LOOP
      IF jsonb_typeof(row_value) <> 'object' THEN
        RAISE EXCEPTION 'SHOWCASE_IDENTITY_ROW_INVALID' USING ERRCODE = '23514';
      END IF;
      IF jsonb_typeof(row_value->'rowSha256') <> 'string' OR (row_value->>'rowSha256') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'SHOWCASE_IDENTITY_ROW_INVALID' USING ERRCODE = '23514';
      END IF;
      IF jsonb_typeof(row_value->'entityKey') <> 'string'
         OR (row_value->>'entityKey') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'SHOWCASE_IDENTITY_ROW_INVALID' USING ERRCODE = '23514';
      END IF;
      IF section_name = 'tanks' THEN
        IF row_value - ARRAY['entityKey','sourceRevision','internalName','volumeLiters','tankType','establishedAt','isActive','rowSha256']::text[] <> '{}'::jsonb
           OR (SELECT count(*) FROM jsonb_object_keys(row_value)) <> 8
           OR NOT public.showcase_ijson_safe_uint_ok(row_value->'sourceRevision')
           OR jsonb_typeof(row_value->'internalName') <> 'string'
           OR NOT public.showcase_ijson_text_ok(row_value->'internalName', 255)
           OR NOT (row_value->'volumeLiters' = 'null'::jsonb
                   OR (jsonb_typeof(row_value->'volumeLiters') = 'string'
                       AND (row_value->>'volumeLiters') ~ '^[1-9][0-9]{0,8}(\.([0-9]{0,2}[1-9]))?$'))
           OR NOT public.showcase_ijson_text_ok(row_value->'tankType', 64)
           OR NOT (row_value->'establishedAt' = 'null'::jsonb
                   OR (jsonb_typeof(row_value->'establishedAt') = 'string'
                       AND (row_value->>'establishedAt') ~ '^\d{4}-\d{2}-\d{2}$'))
           OR jsonb_typeof(row_value->'isActive') <> 'boolean' THEN
          RAISE EXCEPTION 'SHOWCASE_TANK_ROW_SHAPE_INVALID' USING ERRCODE = '23514';
        END IF;
        IF row_value->'establishedAt' <> 'null'::jsonb THEN
          BEGIN
            PERFORM (row_value->>'establishedAt')::date;
          EXCEPTION WHEN data_exception THEN
            RAISE EXCEPTION 'SHOWCASE_TANK_ROW_SHAPE_INVALID' USING ERRCODE = '23514';
          END;
        END IF;
        current_key := row_value->>'entityKey';
      ELSIF section_name = 'specimens' THEN
        IF row_value - ARRAY['entityKey','sourceRevision','currentTankEntityKey','commonName','scientificName','sex','lifeStage','approximateSize','provenance','pedigreeReference','lifecycleState','rowSha256']::text[] <> '{}'::jsonb
           OR (SELECT count(*) FROM jsonb_object_keys(row_value)) <> 12
           OR NOT public.showcase_ijson_safe_uint_ok(row_value->'sourceRevision')
           OR NOT (row_value->'currentTankEntityKey' = 'null'::jsonb
                   OR (jsonb_typeof(row_value->'currentTankEntityKey') = 'string'
                       AND (row_value->>'currentTankEntityKey') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
           OR NOT public.showcase_ijson_text_ok(row_value->'commonName', 120)
           OR NOT public.showcase_ijson_text_ok(row_value->'scientificName', 160)
           OR NOT public.showcase_ijson_text_ok(row_value->'sex', 32)
           OR NOT public.showcase_ijson_text_ok(row_value->'lifeStage', 48)
           OR NOT public.showcase_ijson_text_ok(row_value->'approximateSize', 80)
           OR NOT public.showcase_ijson_text_ok(row_value->'provenance', 255)
           OR NOT public.showcase_ijson_text_ok(row_value->'pedigreeReference', 255)
           OR NOT public.showcase_ijson_text_ok(row_value->'lifecycleState', 48) THEN
          RAISE EXCEPTION 'SHOWCASE_SPECIMEN_ROW_SHAPE_INVALID' USING ERRCODE = '23514';
        END IF;
        current_key := row_value->>'entityKey';
      ELSE
        IF row_value - ARRAY['entityKind','entityKey','aliasKind','value','rowSha256']::text[] <> '{}'::jsonb
           OR (SELECT count(*) FROM jsonb_object_keys(row_value)) <> 5
           OR jsonb_typeof(row_value->'entityKind') <> 'string'
           OR jsonb_typeof(row_value->'aliasKind') <> 'string'
           OR (row_value->>'entityKind', row_value->>'aliasKind') NOT IN (('tank','local_tank'),('specimen','local_specimen'))
           OR jsonb_typeof(row_value->'value') <> 'string'
           OR (row_value->>'value') !~ '^[1-9][0-9]*$'
           OR (row_value->>'value')::numeric > 9007199254740991::numeric THEN
          RAISE EXCEPTION 'SHOWCASE_ALIAS_ROW_SHAPE_INVALID' USING ERRCODE = '23514';
        END IF;
        current_key := (row_value->>'entityKind') || E'\x1f' || (row_value->>'aliasKind') || E'\x1f' || (row_value->>'value');
      END IF;
      -- Strict canonical (code-point) ordering, which also enforces per-section key/tuple uniqueness.
      IF previous_key IS NOT NULL AND current_key COLLATE "C" <= previous_key THEN
        RAISE EXCEPTION 'SHOWCASE_IDENTITY_ROW_ORDER_INVALID' USING ERRCODE = '23514';
      END IF;
      calculated_row_hash := public.showcase_jcs_sha256(row_value - 'rowSha256');
      declared_row_hash := decode(row_value->>'rowSha256', 'hex');
      IF calculated_row_hash <> declared_row_hash THEN
        RAISE EXCEPTION 'SHOWCASE_IDENTITY_ROW_CHECKSUM_INVALID' USING ERRCODE = '23514';
      END IF;
      previous_key := current_key;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(tanks_rows) t
    JOIN jsonb_array_elements(specimens_rows) s ON s->>'entityKey' = t->>'entityKey'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(specimens_rows) s
    WHERE s->>'currentTankEntityKey' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tanks_rows) t WHERE t->>'entityKey' = s->>'currentTankEntityKey')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(aliases_rows) a
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE a->>'entityKind' WHEN 'tank' THEN tanks_rows ELSE specimens_rows END) e
      WHERE e->>'entityKey' = a->>'entityKey'
    )
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_IDENTITY_REFERENCE_INVALID' USING ERRCODE = '23514';
  END IF;

  identity_package := jsonb_build_object(
    'identityPackageVersion', 1, 'schemaVersion', 3,
    'datasetId', import_row.source_dataset_id::text,
    'enrollmentReference', dataset_row.enrollment_evidence_reference,
    'exportedAt', p_manifest->>'exportedAt', 'manifest', p_manifest,
    'identity', jsonb_build_object('aliases', aliases_rows, 'specimens', specimens_rows, 'tanks', tanks_rows)
  );
  calculated_package := public.showcase_jcs_sha256(identity_package);
  IF calculated_package <> p_identity_package_checksum THEN
    RAISE EXCEPTION 'SHOWCASE_IDENTITY_PACKAGE_CHECKSUM_INVALID' USING ERRCODE = '23514';
  END IF;

  IF dataset_row.enrollment_status = 'enrolled' THEN
    UPDATE public.showcase_datasets SET enrollment_status = 'adopted', adopted_at = clock_timestamp(),
      revision = revision + 1 WHERE dataset_id = dataset_row.dataset_id;
    final_state := 'adopted';
  ELSIF dataset_row.enrollment_status = 'adopted' THEN
    final_state := 'adopted';
  ELSE
    final_state := 'adjudicating';
  END IF;
  result := jsonb_build_object(
    'importId', import_row.id, 'datasetId', import_row.source_dataset_id,
    'processingState', final_state, 'eligible', true,
    'adopted', final_state = 'adopted', 'replay', false, 'conflictCount', 0
  );
  -- The owner-unique identity-package index makes a second import of the same finalized identity
  -- fail closed as an operation mismatch rather than a raw uniqueness error.
  BEGIN
    UPDATE public.showcase_dataset_imports SET processing_state = final_state,
      sealed_at = clock_timestamp(), identity_package_checksum = calculated_package,
      final_result = result, revision = revision + 1
    WHERE id = import_row.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
  END;
  RETURN result;
END;
$$;

-- Ungranted helper: materialize a candidate tank entity and row from a verified package tank
-- row, or verify an existing same-owner tank matches the package evidence. Used both for tank
-- references and for a specimen's required tank dependency.
CREATE FUNCTION public.showcase_stage_materialize_tank(p_owner_id uuid, p_tank_row jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key uuid := (p_tank_row->>'entityKey')::uuid;
  v_entity public.showcase_entities%ROWTYPE;
  v_tank public.showcase_tanks%ROWTYPE;
BEGIN
  SELECT * INTO v_entity FROM public.showcase_entities WHERE public_key = v_key FOR UPDATE;
  IF FOUND AND (v_entity.owner_id <> p_owner_id OR v_entity.entity_kind <> 'tank') THEN
    RAISE EXCEPTION 'SHOWCASE_CANDIDATE_ENTITY_UNAVAILABLE' USING ERRCODE = '55000';
  ELSIF NOT FOUND THEN
    INSERT INTO public.showcase_entities (public_key, entity_kind, origin_owner_id, owner_id, identity_state)
    VALUES (v_key, 'tank', p_owner_id, p_owner_id, 'pending');
  END IF;
  SELECT * INTO v_tank FROM public.showcase_tanks WHERE tank_key = v_key FOR UPDATE;
  IF FOUND THEN
    IF v_tank.source_checksum <> decode(p_tank_row->>'rowSha256','hex')
       OR v_tank.source_revision <> (p_tank_row->>'sourceRevision')::bigint THEN
      RAISE EXCEPTION 'SHOWCASE_CANDIDATE_ENTITY_EVIDENCE_CONFLICT' USING ERRCODE = '55000';
    END IF;
  ELSE
    INSERT INTO public.showcase_tanks (
      tank_key, owner_id, internal_name, volume_liters, tank_type,
      established_at, is_active, source_revision, source_checksum
    ) VALUES (
      v_key, p_owner_id, p_tank_row->>'internalName',
      (p_tank_row->>'volumeLiters')::numeric, p_tank_row->>'tankType',
      (p_tank_row->>'establishedAt')::date, (p_tank_row->>'isActive')::boolean,
      (p_tank_row->>'sourceRevision')::bigint, decode(p_tank_row->>'rowSha256','hex')
    );
  END IF;
END;
$$;

CREATE FUNCTION public.showcase_stage_identity_candidates(
  p_owner_id uuid, p_operation_id uuid, p_request_checksum bytea,
  p_import_id uuid, p_candidate_refs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  import_row public.showcase_dataset_imports%ROWTYPE; operation_row public.showcase_identity_operations%ROWTYPE;
  dataset_row public.showcase_datasets%ROWTYPE;
  ref jsonb; previous_ref text; ref_key text; candidate_row jsonb; tank_dep_row jsonb;
  entity_uuid uuid; v_entity_kind text;
  chunk_payload jsonb; v_candidate_checksum bytea; aliases_for_entity jsonb; alias_row jsonb;
  alias_namespace text; existing_entity public.showcase_entities%ROWTYPE;
  existing_tank public.showcase_tanks%ROWTYPE; existing_specimen public.showcase_specimens%ROWTYPE;
  existing_alias public.showcase_entity_aliases%ROWTYPE;
  claim_id uuid; conflict_id uuid; first_conflict uuid; staged_count integer := 0; v_conflict_count integer := 0;
  v_result jsonb; has_conflict boolean; current_tank uuid; processed_keys uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_owner_id IS NULL OR p_operation_id IS NULL OR p_request_checksum IS NULL
     OR octet_length(p_request_checksum) <> 32 OR p_import_id IS NULL
     OR jsonb_typeof(p_candidate_refs) <> 'array'
     OR jsonb_array_length(p_candidate_refs) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'SHOWCASE_CANDIDATE_REQUEST_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  INSERT INTO public.showcase_identity_operations (
    operation_id, owner_id, operation_kind, request_checksum
  ) VALUES (p_operation_id, p_owner_id, 'candidate_stage', p_request_checksum)
  ON CONFLICT (owner_id, operation_id) DO NOTHING;
  SELECT * INTO STRICT operation_row FROM public.showcase_identity_operations
  WHERE owner_id = p_owner_id AND operation_id = p_operation_id FOR UPDATE;
  IF operation_row.request_checksum <> p_request_checksum OR operation_row.operation_kind <> 'candidate_stage' THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF operation_row.status = 'completed' THEN
    RETURN operation_row.result || jsonb_build_object('replay', true);
  ELSIF operation_row.status <> 'processing' THEN
    RAISE EXCEPTION 'SHOWCASE_OPERATION_REJECTED' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO STRICT import_row FROM public.showcase_dataset_imports
  WHERE id = p_import_id AND owner_id = p_owner_id FOR UPDATE;
  IF import_row.source_schema_version <> 3 OR import_row.source_dataset_id IS NULL
     OR import_row.sealed_at IS NULL OR import_row.identity_package_checksum IS NULL
     OR import_row.final_result IS NULL OR import_row.processing_state NOT IN ('adopted','adjudicating') THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_NOT_CANDIDATE_ELIGIBLE' USING ERRCODE = '55000';
  END IF;
  -- Lock and recheck the source dataset: a sealed import must not confer candidate authority
  -- after its dataset has been revoked or is otherwise no longer eligible.
  SELECT * INTO STRICT dataset_row FROM public.showcase_datasets
  WHERE dataset_id = import_row.source_dataset_id AND owner_id = p_owner_id FOR UPDATE;
  IF dataset_row.enrollment_status NOT IN ('enrolled','adopted','staged') OR dataset_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SHOWCASE_IMPORT_NOT_CANDIDATE_ELIGIBLE' USING ERRCODE = '55000';
  END IF;
  PERFORM id FROM public.showcase_dataset_import_chunks
  WHERE import_id = p_import_id ORDER BY section, chunk_index FOR UPDATE;

  previous_ref := NULL;
  FOR ref IN SELECT value FROM jsonb_array_elements(p_candidate_refs)
  LOOP
    IF jsonb_typeof(ref) <> 'object'
       OR ref - ARRAY['section','chunkIndex','rowIndex']::text[] <> '{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(ref)) <> 3
       OR jsonb_typeof(ref->'section') <> 'string'
       OR ref->>'section' NOT IN ('tanks','specimens')
       OR NOT public.showcase_ijson_safe_uint_ok(ref->'chunkIndex')
       OR NOT public.showcase_ijson_safe_uint_ok(ref->'rowIndex')
       OR (ref->>'chunkIndex')::numeric > 19
       OR (ref->>'rowIndex')::numeric > 499 THEN
      RAISE EXCEPTION 'SHOWCASE_CANDIDATE_REFERENCE_INVALID' USING ERRCODE = '22023';
    END IF;
    ref_key := ref->>'section' || ':' || lpad(ref->>'chunkIndex', 10, '0') || ':' || lpad(ref->>'rowIndex', 10, '0');
    IF previous_ref IS NOT NULL AND ref_key <= previous_ref THEN
      RAISE EXCEPTION 'SHOWCASE_CANDIDATE_REFERENCE_ORDER_INVALID' USING ERRCODE = '22023';
    END IF;
    previous_ref := ref_key;
  END LOOP;

  -- Materialize tanks before specimens so same-package assignments satisfy the FK. A specimen
  -- whose currentTankEntityKey targets a package tank not itself referenced is materialized as a
  -- pending dependency; finalize already proved that tank exists in the sealed package.
  FOR ref IN
    SELECT value FROM jsonb_array_elements(p_candidate_refs)
    ORDER BY CASE value->>'section' WHEN 'tanks' THEN 0 ELSE 1 END,
      (value->>'chunkIndex')::integer, (value->>'rowIndex')::integer
  LOOP
    SELECT payload INTO chunk_payload FROM public.showcase_dataset_import_chunks
    WHERE import_id = p_import_id AND section = ref->>'section'
      AND chunk_index = (ref->>'chunkIndex')::integer;
    -- A rowRef naming a nonexistent chunk index is a bad reference (400), not a missing entity (404).
    IF chunk_payload IS NULL OR (ref->>'rowIndex')::integer >= jsonb_array_length(chunk_payload) THEN
      RAISE EXCEPTION 'SHOWCASE_CANDIDATE_REFERENCE_INVALID' USING ERRCODE = '22023';
    END IF;
    candidate_row := chunk_payload->(ref->>'rowIndex')::integer;
    entity_uuid := (candidate_row->>'entityKey')::uuid;
    v_entity_kind := CASE ref->>'section' WHEN 'tanks' THEN 'tank' ELSE 'specimen' END;
    processed_keys := processed_keys || entity_uuid;

    IF v_entity_kind = 'tank' THEN
      PERFORM public.showcase_stage_materialize_tank(p_owner_id, candidate_row);
    ELSE
      current_tank := (candidate_row->>'currentTankEntityKey')::uuid;
      IF current_tank IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.showcase_tanks WHERE tank_key = current_tank
      ) THEN
        SELECT a.element INTO tank_dep_row
        FROM public.showcase_dataset_import_chunks c
        CROSS JOIN LATERAL jsonb_array_elements(c.payload) a(element)
        WHERE c.import_id = p_import_id AND c.section = 'tanks'
          AND a.element->>'entityKey' = current_tank::text
        LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SHOWCASE_IDENTITY_REFERENCE_INVALID' USING ERRCODE = '23514';
        END IF;
        PERFORM public.showcase_stage_materialize_tank(p_owner_id, tank_dep_row);
      END IF;

      SELECT * INTO existing_entity FROM public.showcase_entities WHERE public_key = entity_uuid FOR UPDATE;
      IF FOUND AND (existing_entity.owner_id <> p_owner_id OR existing_entity.entity_kind <> 'specimen') THEN
        RAISE EXCEPTION 'SHOWCASE_CANDIDATE_ENTITY_UNAVAILABLE' USING ERRCODE = '55000';
      ELSIF NOT FOUND THEN
        INSERT INTO public.showcase_entities (public_key, entity_kind, origin_owner_id, owner_id, identity_state)
        VALUES (entity_uuid, 'specimen', p_owner_id, p_owner_id, 'pending');
      END IF;
      SELECT * INTO existing_specimen FROM public.showcase_specimens WHERE specimen_key = entity_uuid FOR UPDATE;
      IF FOUND THEN
        IF existing_specimen.source_checksum <> decode(candidate_row->>'rowSha256','hex')
           OR existing_specimen.source_revision <> (candidate_row->>'sourceRevision')::bigint THEN
          RAISE EXCEPTION 'SHOWCASE_CANDIDATE_ENTITY_EVIDENCE_CONFLICT' USING ERRCODE = '55000';
        END IF;
      ELSE
        INSERT INTO public.showcase_specimens (
          specimen_key, owner_id, current_tank_key, common_name, scientific_name, sex,
          life_stage, approximate_size, provenance, pedigree_reference, lifecycle_state,
          source_revision, source_checksum
        ) VALUES (
          entity_uuid, p_owner_id, current_tank, candidate_row->>'commonName', candidate_row->>'scientificName',
          candidate_row->>'sex', candidate_row->>'lifeStage', candidate_row->>'approximateSize',
          candidate_row->>'provenance', candidate_row->>'pedigreeReference', candidate_row->>'lifecycleState',
          (candidate_row->>'sourceRevision')::bigint, decode(candidate_row->>'rowSha256','hex')
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.showcase_specimen_ownership WHERE specimen_key = entity_uuid AND valid_to IS NULL) THEN
        INSERT INTO public.showcase_specimen_ownership (
          specimen_key, owner_id, valid_from, evidence_kind, evidence_reference, finality_state
        ) VALUES (entity_uuid, p_owner_id, clock_timestamp(), 'server_bound_v3', p_import_id::text, 'initial');
      END IF;
    END IF;
    staged_count := staged_count + 1;
  END LOOP;

  PERFORM set_config('showcase.identity_mutation', 'candidate_stage', true);
  FOR ref IN SELECT value FROM jsonb_array_elements(p_candidate_refs)
  LOOP
    SELECT payload INTO STRICT chunk_payload FROM public.showcase_dataset_import_chunks
    WHERE import_id = p_import_id AND section = ref->>'section'
      AND chunk_index = (ref->>'chunkIndex')::integer;
    candidate_row := chunk_payload->(ref->>'rowIndex')::integer;
    entity_uuid := (candidate_row->>'entityKey')::uuid;
    v_entity_kind := CASE ref->>'section' WHEN 'tanks' THEN 'tank' ELSE 'specimen' END;
    SELECT COALESCE(jsonb_agg(a.element ORDER BY a.element->>'entityKind', a.element->>'aliasKind', a.element->>'value'), '[]'::jsonb)
    INTO aliases_for_entity
    FROM public.showcase_dataset_import_chunks c
    CROSS JOIN LATERAL jsonb_array_elements(c.payload) a(element)
    WHERE c.import_id = p_import_id AND c.section = 'aliases'
      AND a.element->>'entityKind' = v_entity_kind AND a.element->>'entityKey' = entity_uuid::text;
    v_candidate_checksum := public.showcase_jcs_sha256(jsonb_build_object(
      'candidateVersion', 1, 'datasetId', import_row.source_dataset_id::text,
      'entity', candidate_row, 'aliases', aliases_for_entity
    ));
    has_conflict := false;

    FOR alias_row IN SELECT value FROM jsonb_array_elements(aliases_for_entity)
    LOOP
      alias_namespace := CASE v_entity_kind WHEN 'tank' THEN 'local-tank:' ELSE 'local-specimen:' END
        || p_owner_id::text || ':' || import_row.source_dataset_id::text;
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'showcase-alias:' || v_entity_kind || ':' || (alias_row->>'aliasKind') || ':'
          || alias_namespace || ':' || (alias_row->>'value'), 0
      ));
      SELECT * INTO existing_alias FROM public.showcase_entity_aliases ea
      WHERE ea.entity_kind = v_entity_kind AND ea.alias_kind = alias_row->>'aliasKind'
        AND ea.namespace = alias_namespace AND ea.value = alias_row->>'value' FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.showcase_entity_aliases (
          entity_key, entity_kind, owner_scope_id, dataset_id, alias_kind, namespace, value,
          initial_evidence_kind, initial_evidence_reference, initial_evidence_checksum, status
        ) VALUES (
          entity_uuid, v_entity_kind, p_owner_id, import_row.source_dataset_id,
          alias_row->>'aliasKind', alias_namespace, alias_row->>'value',
          'migration', p_import_id::text, v_candidate_checksum, 'active'
        ) RETURNING * INTO existing_alias;
        INSERT INTO public.showcase_alias_events (
          alias_id, event_kind, resulting_status, evidence_kind,
          evidence_reference, evidence_checksum, actor_owner_id
        ) VALUES (
          existing_alias.id, 'activated', 'active', 'migration',
          p_import_id::text, v_candidate_checksum, p_owner_id
        );
      ELSIF existing_alias.entity_key <> entity_uuid OR existing_alias.status <> 'active' THEN
        has_conflict := true;
        SELECT ac.id INTO claim_id FROM public.showcase_alias_claims ac
        WHERE ac.owner_id = p_owner_id AND ac.entity_kind = v_entity_kind
          AND ac.alias_kind = alias_row->>'aliasKind' AND ac.namespace = alias_namespace
          AND ac.value = alias_row->>'value' AND ac.candidate_entity_key = entity_uuid
          AND ac.candidate_checksum = v_candidate_checksum;
        IF claim_id IS NULL THEN
          INSERT INTO public.showcase_alias_claims (
            owner_id, entity_kind, alias_kind, namespace, value, candidate_entity_key,
            candidate_checksum, evidence_kind, evidence_reference
          ) VALUES (
            p_owner_id, v_entity_kind, alias_row->>'aliasKind', alias_namespace, alias_row->>'value', entity_uuid,
            v_candidate_checksum, 'server_bound_v3', p_import_id::text
          ) RETURNING id INTO claim_id;
        END IF;
        SELECT ic.id INTO conflict_id
        FROM public.showcase_identity_conflicts ic
        WHERE ic.owner_id = p_owner_id AND ic.status = 'open' AND EXISTS (
          SELECT 1 FROM public.showcase_identity_conflict_claims icc
          JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
          WHERE icc.conflict_id = ic.id AND ac.entity_kind = v_entity_kind
            AND ac.alias_kind = alias_row->>'aliasKind' AND ac.namespace = alias_namespace
            AND ac.value = alias_row->>'value'
        ) ORDER BY ic.id LIMIT 1 FOR UPDATE;
        IF conflict_id IS NULL THEN
          INSERT INTO public.showcase_identity_conflicts (owner_id, conflict_kind, reason_code)
          VALUES (p_owner_id, 'alias_collision', 'ALIAS_TARGET_CONFLICT') RETURNING id INTO conflict_id;
        END IF;
        INSERT INTO public.showcase_identity_conflict_claims (conflict_id, claim_id)
        VALUES (conflict_id, claim_id) ON CONFLICT DO NOTHING;
        INSERT INTO public.showcase_identity_conflict_entities (conflict_id, entity_key)
        VALUES (conflict_id, entity_uuid) ON CONFLICT DO NOTHING;
        INSERT INTO public.showcase_identity_conflict_entities (conflict_id, entity_key)
        VALUES (conflict_id, existing_alias.entity_key) ON CONFLICT DO NOTHING;
        first_conflict := COALESCE(first_conflict, conflict_id);
      END IF;
    END LOOP;

    UPDATE public.showcase_entities SET identity_state = CASE WHEN has_conflict THEN 'ambiguous' ELSE 'verified' END,
      revision = revision + 1 WHERE public_key = entity_uuid
        AND identity_state IS DISTINCT FROM CASE WHEN has_conflict THEN 'ambiguous' ELSE 'verified' END;
    INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
    VALUES (p_owner_id, entity_uuid, CASE WHEN has_conflict THEN 'conflict_change' ELSE 'identity_change' END);
  END LOOP;

  -- Authoritative import conflict count: distinct open conflicts touching any processed entity.
  SELECT count(DISTINCT ic.id) INTO v_conflict_count
  FROM public.showcase_identity_conflicts ic
  JOIN public.showcase_identity_conflict_entities ice ON ice.conflict_id = ic.id
  WHERE ic.owner_id = p_owner_id AND ic.status = 'open' AND ice.entity_key = ANY(processed_keys);
  UPDATE public.showcase_dataset_imports SET conflict_count = v_conflict_count, revision = revision + 1
    WHERE id = p_import_id AND conflict_count <> v_conflict_count;

  v_result := jsonb_build_object(
    'operationId', p_operation_id, 'importId', p_import_id,
    'stagedCount', staged_count, 'conflictCount', v_conflict_count,
    'firstConflictId', first_conflict, 'status', 'completed', 'replay', false
  );
  UPDATE public.showcase_identity_operations SET status = 'completed', result_conflict_id = first_conflict,
    result = v_result, completed_at = clock_timestamp()
  WHERE owner_id = p_owner_id AND operation_id = p_operation_id;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.showcase_resolve_identity_conflict(
  p_owner_id uuid, p_conflict_id uuid, p_chosen_entity_key uuid, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE conflict_row public.showcase_identity_conflicts%ROWTYPE; existing_resolution public.showcase_identity_resolutions%ROWTYPE;
  checksums jsonb; claim_row public.showcase_alias_claims%ROWTYPE; canonical_alias public.showcase_entity_aliases%ROWTYPE;
  resolution_id uuid; auth_targets uuid[]; alias_targets uuid[]; accepted_claim_id uuid; derived_dataset uuid;
BEGIN
  IF p_owner_id IS NULL OR p_conflict_id IS NULL OR p_reason IS NULL
     OR p_reason <> btrim(p_reason) OR char_length(p_reason) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_REQUEST_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  -- Entity-before-conflict lock order (matches the R1.2 transfer path), then claims.
  PERFORM e.public_key FROM public.showcase_entities e
  WHERE e.public_key IN (
    SELECT entity_key FROM public.showcase_identity_conflict_entities WHERE conflict_id = p_conflict_id
  ) ORDER BY e.public_key FOR UPDATE;
  SELECT * INTO STRICT conflict_row FROM public.showcase_identity_conflicts
  WHERE id = p_conflict_id AND owner_id = p_owner_id FOR UPDATE;
  PERFORM ac.id FROM public.showcase_alias_claims ac
  JOIN public.showcase_identity_conflict_claims icc ON icc.claim_id = ac.id
  WHERE icc.conflict_id = p_conflict_id ORDER BY ac.id FOR UPDATE;

  -- Server-built checksum map over all locked linked claims.
  SELECT COALESCE(jsonb_object_agg(ac.id::text, encode(ac.candidate_checksum,'hex') ORDER BY ac.id::text), '{}'::jsonb)
  INTO checksums FROM public.showcase_identity_conflict_claims icc
  JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
  WHERE icc.conflict_id = p_conflict_id;

  -- Exact replay requires the same actor, chosen entity, reason, and the current checksum map.
  SELECT * INTO existing_resolution FROM public.showcase_identity_resolutions WHERE conflict_id = p_conflict_id;
  IF FOUND THEN
    IF existing_resolution.actor_owner_id = p_owner_id
       AND existing_resolution.chosen_entity_key IS NOT DISTINCT FROM p_chosen_entity_key
       AND existing_resolution.reason = p_reason
       AND existing_resolution.candidate_checksums = checksums THEN
      RETURN jsonb_build_object(
        'resolutionId', existing_resolution.id, 'conflictId', p_conflict_id,
        'chosenEntityKey', existing_resolution.chosen_entity_key,
        'status', conflict_row.status, 'replay', true
      );
    END IF;
    RAISE EXCEPTION 'SHOWCASE_OPERATION_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF conflict_row.status <> 'open' THEN
    RAISE EXCEPTION 'SHOWCASE_CONFLICT_STATE_INVALID' USING ERRCODE = '55000';
  END IF;
  IF p_chosen_entity_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.showcase_identity_conflict_entities
    WHERE conflict_id = p_conflict_id AND entity_key = p_chosen_entity_key
  ) THEN
    RAISE EXCEPTION 'SHOWCASE_RESOLUTION_ENTITY_NOT_LINKED' USING ERRCODE = '23514';
  END IF;

  -- Authority lattice (checked before any mutation, only when the owner actually chooses a target):
  --   * verified chain / signed certificate claims are authoritative in their domain;
  --   * an existing active canonical alias binding is immutable and cannot be retargeted.
  -- Owner choice may only resolve residual same-principal ambiguity with no contradiction.
  -- A null chosen entity is a pure rejection: it activates nothing and bypasses these vetoes.
  IF p_chosen_entity_key IS NOT NULL THEN
    SELECT array_agg(DISTINCT ac.candidate_entity_key) INTO auth_targets
    FROM public.showcase_alias_claims ac
    JOIN public.showcase_identity_conflict_claims icc ON icc.claim_id = ac.id
    WHERE icc.conflict_id = p_conflict_id
      AND ac.evidence_kind IN ('verified_chain','signed_certificate') AND ac.status = 'pending';
    IF array_length(auth_targets, 1) > 1
       OR (array_length(auth_targets, 1) = 1 AND p_chosen_entity_key IS DISTINCT FROM auth_targets[1]) THEN
      RAISE EXCEPTION 'SHOWCASE_AUTHORITATIVE_EVIDENCE_CONFLICT' USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(DISTINCT ea.entity_key) INTO alias_targets
    FROM (
      SELECT DISTINCT ac.entity_kind, ac.alias_kind, ac.namespace, ac.value
      FROM public.showcase_alias_claims ac
      JOIN public.showcase_identity_conflict_claims icc ON icc.claim_id = ac.id
      WHERE icc.conflict_id = p_conflict_id
    ) t
    JOIN public.showcase_entity_aliases ea
      ON ea.entity_kind = t.entity_kind AND ea.alias_kind = t.alias_kind
     AND ea.namespace = t.namespace AND ea.value = t.value AND ea.status = 'active';
    IF array_length(alias_targets, 1) > 1
       OR (array_length(alias_targets, 1) = 1 AND p_chosen_entity_key IS DISTINCT FROM alias_targets[1]) THEN
      RAISE EXCEPTION 'SHOWCASE_AUTHORITATIVE_EVIDENCE_CONFLICT' USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO public.showcase_identity_resolutions (
    conflict_id, actor_owner_id, chosen_entity_key, reason, candidate_checksums
  ) VALUES (p_conflict_id, p_owner_id, p_chosen_entity_key, p_reason, checksums)
  RETURNING id INTO resolution_id;

  -- Accept at most one claim: the lexicographically first server-bound v3 claim for the chosen
  -- entity. All other linked claims are rejected. Chain/certificate claims are never activated
  -- through this owner-only path; they may only veto (handled above).
  IF p_chosen_entity_key IS NOT NULL THEN
    SELECT ac.id INTO accepted_claim_id
    FROM public.showcase_alias_claims ac
    JOIN public.showcase_identity_conflict_claims icc ON icc.claim_id = ac.id
    WHERE icc.conflict_id = p_conflict_id
      AND ac.candidate_entity_key = p_chosen_entity_key
      AND ac.evidence_kind = 'server_bound_v3' AND ac.status = 'pending'
    ORDER BY ac.id LIMIT 1;
  END IF;

  PERFORM set_config('showcase.identity_mutation', 'adjudicate', true);
  FOR claim_row IN
    SELECT ac.* FROM public.showcase_identity_conflict_claims icc
    JOIN public.showcase_alias_claims ac ON ac.id = icc.claim_id
    WHERE icc.conflict_id = p_conflict_id ORDER BY ac.id
  LOOP
    -- Only server-bound v3 claims are decided by owner adjudication. Chain/certificate claims may
    -- only veto (handled above) and are left pending for their own reviewed authority path.
    IF claim_row.evidence_kind = 'server_bound_v3' THEN
      UPDATE public.showcase_alias_claims SET status = CASE
        WHEN claim_row.id = accepted_claim_id THEN 'accepted' ELSE 'rejected' END
      WHERE id = claim_row.id;
    END IF;
    IF claim_row.id = accepted_claim_id THEN
      -- Derive the local-alias dataset scope from the claim namespace and the evidence reference
      -- (the locked import UUID) from the claim itself, preserving owner/dataset provenance.
      derived_dataset := split_part(claim_row.namespace, ':', 3)::uuid;
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'showcase-alias:' || claim_row.entity_kind || ':' || claim_row.alias_kind || ':'
          || claim_row.namespace || ':' || claim_row.value, 0
      ));
      SELECT * INTO canonical_alias FROM public.showcase_entity_aliases ea
      WHERE ea.entity_kind = claim_row.entity_kind AND ea.alias_kind = claim_row.alias_kind
        AND ea.namespace = claim_row.namespace AND ea.value = claim_row.value FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.showcase_entity_aliases (
          entity_key, entity_kind, owner_scope_id, dataset_id, alias_kind, namespace, value,
          initial_evidence_kind, initial_evidence_reference, initial_evidence_checksum, status
        ) VALUES (
          p_chosen_entity_key, claim_row.entity_kind, p_owner_id, derived_dataset,
          claim_row.alias_kind, claim_row.namespace, claim_row.value,
          'owner_adjudication', claim_row.evidence_reference, claim_row.candidate_checksum, 'active'
        ) RETURNING * INTO canonical_alias;
        INSERT INTO public.showcase_alias_events (
          alias_id, event_kind, resulting_status, evidence_kind,
          evidence_reference, evidence_checksum, actor_owner_id
        ) VALUES (
          canonical_alias.id, 'activated', 'active', 'owner_adjudication',
          claim_row.evidence_reference, claim_row.candidate_checksum, p_owner_id
        );
      ELSIF canonical_alias.entity_key <> p_chosen_entity_key OR canonical_alias.status <> 'active' THEN
        RAISE EXCEPTION 'SHOWCASE_ALIAS_UNAVAILABLE' USING ERRCODE = '23505';
      END IF;
    END IF;
  END LOOP;
  UPDATE public.showcase_identity_conflicts SET status = CASE WHEN p_chosen_entity_key IS NULL THEN 'rejected' ELSE 'resolved' END,
    resolved_at = clock_timestamp() WHERE id = p_conflict_id;
  UPDATE public.showcase_entities e SET identity_state = CASE
      WHEN e.public_key = p_chosen_entity_key AND NOT public.showcase_entity_has_open_conflict(e.public_key) THEN 'verified'
      WHEN public.showcase_entity_has_open_conflict(e.public_key) THEN 'ambiguous' ELSE 'pending' END,
    revision = revision + 1
  WHERE e.public_key IN (
    SELECT entity_key FROM public.showcase_identity_conflict_entities WHERE conflict_id = p_conflict_id
  );
  INSERT INTO public.showcase_projection_invalidations (owner_id, entity_key, reason)
  SELECT p_owner_id, entity_key, 'conflict_change'
  FROM public.showcase_identity_conflict_entities WHERE conflict_id = p_conflict_id;
  RETURN jsonb_build_object(
    'resolutionId', resolution_id, 'conflictId', p_conflict_id,
    'chosenEntityKey', p_chosen_entity_key,
    'status', CASE WHEN p_chosen_entity_key IS NULL THEN 'rejected' ELSE 'resolved' END,
    'replay', false
  );
END;
$$;

CREATE FUNCTION public.showcase_resolve_owner_legacy_qr(p_owner_id uuid, p_legacy_value text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE resolved_key uuid; match_count integer; derived_namespace text;
BEGIN
  IF p_owner_id IS NULL OR p_legacy_value !~ '^[1-9][0-9]*$'
     OR p_legacy_value::numeric > 9007199254740991::numeric THEN
    RETURN jsonb_build_object('resolved', false, 'recovery', true);
  END IF;
  derived_namespace := 'legacy-qr:v1:' || p_owner_id::text;
  -- array_agg(... ORDER BY) rather than min(uuid), which has no aggregate. Resolve only when
  -- exactly one active lifetime alias points to a verified, current, conflict-free same-owner tank.
  SELECT count(*), (array_agg(a.entity_key ORDER BY a.entity_key))[1] INTO match_count, resolved_key
  FROM public.showcase_entity_aliases a
  JOIN public.showcase_entities e ON e.public_key = a.entity_key AND e.entity_kind = 'tank'
  JOIN public.showcase_tanks t ON t.tank_key = a.entity_key AND t.owner_id = p_owner_id
  WHERE a.entity_kind = 'tank' AND a.alias_kind = 'legacy_qr'
    AND a.namespace = derived_namespace AND a.value = p_legacy_value
    AND a.owner_scope_id = p_owner_id AND a.dataset_id IS NULL AND a.status = 'active'
    AND e.owner_id = p_owner_id AND e.identity_state = 'verified' AND t.is_active
    AND NOT public.showcase_entity_has_open_conflict(a.entity_key);
  IF match_count <> 1 THEN RETURN jsonb_build_object('resolved', false, 'recovery', true); END IF;
  RETURN jsonb_build_object(
    'resolved', true, 'tankId', 'tank_' || resolved_key::text,
    'ownerPath', '/app/room/tanks/tank_' || resolved_key::text
  );
END;
$$;

CREATE FUNCTION public.showcase_bind_owner_legacy_qr(
  p_owner_id uuid, p_dataset_id uuid, p_legacy_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE derived_namespace text; local_namespace text; candidate_key uuid; candidate_count integer;
  existing_alias public.showcase_entity_aliases%ROWTYPE; new_alias_id uuid;
BEGIN
  IF p_owner_id IS NULL OR p_dataset_id IS NULL OR p_legacy_value !~ '^[1-9][0-9]*$'
     OR p_legacy_value::numeric > 9007199254740991::numeric THEN
    RAISE EXCEPTION 'SHOWCASE_QR_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('showcase-identity-owner:' || p_owner_id::text, 0));
  derived_namespace := 'legacy-qr:v1:' || p_owner_id::text;
  local_namespace := 'local-tank:' || p_owner_id::text || ':' || p_dataset_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'showcase-alias:tank:legacy_qr:' || derived_namespace || ':' || p_legacy_value, 0
  ));
  PERFORM dataset_id FROM public.showcase_datasets
  WHERE dataset_id = p_dataset_id AND owner_id = p_owner_id
    AND enrollment_status IN ('enrolled','adopted') AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_QR_NOT_RESOLVED' USING ERRCODE = '55000'; END IF;
  -- Discover the single eligible local-tank candidate (array_agg, not min(uuid)).
  SELECT count(*), (array_agg(a.entity_key ORDER BY a.entity_key))[1] INTO candidate_count, candidate_key
  FROM public.showcase_entity_aliases a
  JOIN public.showcase_entities e ON e.public_key = a.entity_key AND e.owner_id = p_owner_id
  JOIN public.showcase_tanks t ON t.tank_key = a.entity_key AND t.owner_id = p_owner_id
  WHERE a.entity_kind = 'tank' AND a.alias_kind = 'local_tank'
    AND a.namespace = local_namespace AND a.value = p_legacy_value
    AND a.owner_scope_id = p_owner_id AND a.dataset_id = p_dataset_id AND a.status = 'active'
    AND e.identity_state = 'verified' AND t.is_active
    AND NOT public.showcase_entity_has_open_conflict(a.entity_key);
  IF candidate_count <> 1 THEN RAISE EXCEPTION 'SHOWCASE_QR_NOT_RESOLVED' USING ERRCODE = '55000'; END IF;
  -- Lock the candidate entity/tank/local-alias rows and recheck eligibility under lock before
  -- binding the lifetime alias, so a concurrent state change cannot slip past discovery.
  PERFORM 1 FROM public.showcase_entity_aliases a
  JOIN public.showcase_entities e ON e.public_key = a.entity_key AND e.owner_id = p_owner_id
  JOIN public.showcase_tanks t ON t.tank_key = a.entity_key AND t.owner_id = p_owner_id
  WHERE a.entity_key = candidate_key AND a.entity_kind = 'tank' AND a.alias_kind = 'local_tank'
    AND a.namespace = local_namespace AND a.value = p_legacy_value
    AND a.owner_scope_id = p_owner_id AND a.dataset_id = p_dataset_id AND a.status = 'active'
    AND e.identity_state = 'verified' AND t.is_active
    AND NOT public.showcase_entity_has_open_conflict(a.entity_key)
  FOR UPDATE OF a, e, t;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHOWCASE_QR_NOT_RESOLVED' USING ERRCODE = '55000'; END IF;
  SELECT * INTO existing_alias FROM public.showcase_entity_aliases
  WHERE entity_kind = 'tank' AND alias_kind = 'legacy_qr'
    AND namespace = derived_namespace AND value = p_legacy_value FOR UPDATE;
  IF FOUND THEN
    IF existing_alias.entity_key = candidate_key AND existing_alias.status = 'active' THEN
      RETURN jsonb_build_object('resolved', true, 'tankId', 'tank_' || candidate_key::text, 'replay', true);
    END IF;
    RAISE EXCEPTION 'SHOWCASE_ALIAS_UNAVAILABLE' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.showcase_entity_aliases (
    entity_key, entity_kind, owner_scope_id, dataset_id, alias_kind, namespace, value,
    initial_evidence_kind, initial_evidence_reference, status
  ) VALUES (
    candidate_key, 'tank', p_owner_id, NULL, 'legacy_qr', derived_namespace, p_legacy_value,
    'owner_adjudication', 'legacy-qr-bind:v1', 'active'
  ) RETURNING id INTO new_alias_id;
  INSERT INTO public.showcase_alias_events (
    alias_id, event_kind, resulting_status, evidence_kind, evidence_reference, actor_owner_id
  ) VALUES (new_alias_id, 'activated', 'active', 'owner_adjudication', 'legacy-qr-bind:v1', p_owner_id);
  RETURN jsonb_build_object('resolved', true, 'tankId', 'tank_' || candidate_key::text, 'replay', false);
END;
$$;

-- Immediate least privilege. Final convergent grants are in 143000.
ALTER TABLE public.showcase_dataset_import_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_dataset_import_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_identity_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_identity_operations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.showcase_dataset_import_chunks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.showcase_identity_operations FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.showcase_jcs_estr(text) OWNER TO postgres;
ALTER FUNCTION public.showcase_jcs_canonicalize(jsonb,integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_jcs_sha256(jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_ijson_text_ok(jsonb,integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_ijson_safe_uint_ok(jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_stage_materialize_tank(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_guard_operation_change() OWNER TO postgres;
ALTER FUNCTION public.showcase_issue_wallet_link_nonce(uuid,bigint,text,text,text,text,bytea) OWNER TO postgres;
ALTER FUNCTION public.showcase_consume_wallet_link_nonce(uuid,uuid,bytea,bigint,text,text,text,text,text,timestamptz,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_identity_state(uuid,uuid,integer,uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_owner_identity_conflict_candidates(uuid,uuid,uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.showcase_enroll_dataset(uuid,uuid,integer,bytea) OWNER TO postgres;
ALTER FUNCTION public.showcase_start_dataset_import(uuid,uuid,bytea,uuid,text,integer,bytea,bytea) OWNER TO postgres;
ALTER FUNCTION public.showcase_stage_dataset_import_chunk(uuid,uuid,text,integer,integer,bytea,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_finalize_dataset_import(uuid,uuid,bigint,jsonb,bytea) OWNER TO postgres;
ALTER FUNCTION public.showcase_stage_identity_candidates(uuid,uuid,bytea,uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.showcase_resolve_identity_conflict(uuid,uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_resolve_owner_legacy_qr(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.showcase_bind_owner_legacy_qr(uuid,uuid,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.showcase_jcs_estr(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_jcs_canonicalize(jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_jcs_sha256(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_ijson_text_ok(jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_ijson_safe_uint_ok(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_stage_materialize_tank(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_guard_operation_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_issue_wallet_link_nonce(uuid,bigint,text,text,text,text,bytea) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_consume_wallet_link_nonce(uuid,uuid,bytea,bigint,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_owner_identity_state(uuid,uuid,integer,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_owner_identity_conflict_candidates(uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_enroll_dataset(uuid,uuid,integer,bytea) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_start_dataset_import(uuid,uuid,bytea,uuid,text,integer,bytea,bytea) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_stage_dataset_import_chunk(uuid,uuid,text,integer,integer,bytea,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_finalize_dataset_import(uuid,uuid,bigint,jsonb,bytea) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_stage_identity_candidates(uuid,uuid,bytea,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_resolve_identity_conflict(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_resolve_owner_legacy_qr(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.showcase_bind_owner_legacy_qr(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
