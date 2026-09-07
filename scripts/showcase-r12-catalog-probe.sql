-- Read-only final-state probe for Fish Room R1.2. Run manually against the intended
-- Supabase project after human deployment approval; do not pipe migrations into sb-query.ps1.
BEGIN TRANSACTION READ ONLY;

-- Every base relation must report row_security=true and force_row_security=true.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind,
  c.relrowsecurity AS row_security,
  c.relforcerowsecurity AS force_row_security,
  pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'showcase\_%' ESCAPE '\'
ORDER BY c.relkind, c.relname;

-- This should return no base-table privileges for PUBLIC/anon/authenticated/service_role.
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name LIKE 'showcase\_%' ESCAPE '\'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- No Fish Room browser policies should exist.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'showcase\_%' ESCAPE '\'
ORDER BY tablename, policyname;

-- Review owners, SECURITY DEFINER posture, pinned search_path, and ACLs for every helper/RPC.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  p.proacl AS acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'showcase\_%' ESCAPE '\'
ORDER BY p.proname, identity_arguments;

-- No view/materialized-view alternate public surface may exist.
SELECT n.nspname AS schema_name, c.relname AS view_name, c.relkind, c.relacl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
  AND c.relname LIKE 'showcase\_%' ESCAPE '\'
ORDER BY c.relname;

-- R1.0 section 8.4 keeps both buckets absent until the runtime/worker gate is lifted.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('showcase-media-source-v1', 'showcase-media-derivatives-v1')
ORDER BY id;

-- No storage.objects policy may target or authorize the reserved showcase buckets.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (
    COALESCE(qual, '') ILIKE '%showcase-media-%'
    OR COALESCE(with_check, '') ILIKE '%showcase-media-%'
  )
ORDER BY policyname;

ROLLBACK;
