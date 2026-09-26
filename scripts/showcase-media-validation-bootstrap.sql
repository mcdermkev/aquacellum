\set ON_ERROR_STOP on
\echo 'Bootstrapping disposable showcase-media PostgreSQL validation database'

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS dblink;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$roles$;

-- Minimal Supabase Storage catalog needed by the migration and policy probes.
-- This exists only in the disposable PostgreSQL container; no browser policies are added.
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION postgres;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);

-- The R1.4 showcase projection resolves the existing marketplace listing table.
-- Only columns referenced by the additive showcase migrations are represented here.
CREATE TABLE public.aquadex_listings (
  id text NOT NULL,
  is_batch boolean NOT NULL DEFAULT false,
  seller_address text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id, is_batch)
);

REVOKE ALL ON SCHEMA storage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM PUBLIC, anon, authenticated;

\echo 'Disposable validation bootstrap complete'
