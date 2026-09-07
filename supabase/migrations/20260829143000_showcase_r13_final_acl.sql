-- Fish Room R1.3A Tier A final convergent RLS/ACL boundary.
-- Additive and convergent: re-asserts ENABLE/FORCE RLS and base-table privilege revocation across
-- every showcase base relation (including the two R1.3 tables), revokes EXECUTE on every showcase_*
-- function from PUBLIC/anon/authenticated/service_role, then grants EXECUTE only to service_role for
-- the exact allowlist of 25 server RPCs (the 4 inherited R1.2 RPCs plus the 21 new R1.3 RPCs).
-- Every helper/trigger/guard function remains ungranted. No browser role or base-table grant exists.

BEGIN;

-- Convergent final-state RLS/ACL lockdown across every showcase base relation.
DO $showcase_r13_final_rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'showcase_owner_principals', 'showcase_owner_wallets', 'showcase_wallet_link_nonces',
    'showcase_datasets', 'showcase_dataset_imports', 'showcase_dataset_import_chunks',
    'showcase_identity_operations', 'showcase_entities', 'showcase_tanks', 'showcase_specimens',
    'showcase_transfer_evidence', 'showcase_specimen_ownership', 'showcase_entity_aliases',
    'showcase_alias_events', 'showcase_alias_claims', 'showcase_identity_conflicts',
    'showcase_identity_conflict_claims', 'showcase_identity_conflict_entities',
    'showcase_identity_resolutions', 'showcase_projection_invalidations', 'showcase_rooms',
    'showcase_room_tanks', 'showcase_specimen_settings', 'showcase_specimen_setting_history',
    'showcase_media_assets', 'showcase_media_asset_versions', 'showcase_media_attachments',
    'showcase_room_slug_history', 'showcase_tank_slug_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
  END LOOP;
END;
$showcase_r13_final_rls$;

-- Remove every default function execute grant across the entire showcase_* surface.
DO $showcase_r13_final_function_acl$
DECLARE
  function_signature text;
BEGIN
  FOR function_signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      function_signature
    );
  END LOOP;
END;
$showcase_r13_final_function_acl$;

-- Exact service RPC allowlist: 4 inherited R1.2 RPCs.
GRANT EXECUTE ON FUNCTION public.showcase_resolve_owner_principal(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_link_owner_wallet(uuid, bigint, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_transfer_specimen(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_public_room(text, text) TO service_role;

-- 21 new R1.3 RPCs: nonce/wallet proof.
GRANT EXECUTE ON FUNCTION public.showcase_issue_wallet_link_nonce(uuid,bigint,text,text,text,text,bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_consume_wallet_link_nonce(uuid,uuid,bytea,bigint,text,text,text,text,text,timestamptz,timestamptz) TO service_role;

-- Owner identity and datasets.
GRANT EXECUTE ON FUNCTION public.showcase_owner_identity_state(uuid,uuid,integer,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_owner_identity_conflict_candidates(uuid,uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_enroll_dataset(uuid,uuid,integer,bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_start_dataset_import(uuid,uuid,bytea,uuid,text,integer,bytea,bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_stage_dataset_import_chunk(uuid,uuid,text,integer,integer,bytea,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_finalize_dataset_import(uuid,uuid,bigint,jsonb,bytea) TO service_role;

-- Candidate staging and adjudication.
GRANT EXECUTE ON FUNCTION public.showcase_stage_identity_candidates(uuid,uuid,bytea,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_resolve_identity_conflict(uuid,uuid,uuid,text) TO service_role;

-- Legacy QR.
GRANT EXECUTE ON FUNCTION public.showcase_resolve_owner_legacy_qr(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_bind_owner_legacy_qr(uuid,uuid,text) TO service_role;

-- Owner Room and publication.
GRANT EXECUTE ON FUNCTION public.showcase_owner_room(uuid,uuid,integer,uuid,integer,text,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_create_owner_room(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_update_owner_room(uuid,uuid,bigint,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_reset_owner_room(uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_put_room_tank(uuid,uuid,uuid,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_remove_room_tank(uuid,uuid,uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_put_specimen_settings(uuid,uuid,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_owner_publication_preview(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.showcase_set_owner_room_visibility(uuid,uuid,bigint,text) TO service_role;

COMMIT;
