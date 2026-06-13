-- ============================================================================
-- AquaDex Cloud Sync Tables
-- Run this in the Supabase SQL Editor (or as a migration file).
--
-- Architecture:
--   - All data is stored as a JSON blob in the `data` column (jsonb).
--   - owner_address is the wallet address (lowercase) used as the user key.
--   - No RLS JWT bridge required — queries filter by owner_address explicitly.
--   - Tables use text primary keys to match the local Dexie timestamp IDs.
-- ============================================================================

-- ── Tanks ────────────────────────────────────────────────────────────────────
create table if not exists public.aquadex_tanks (
  id             text        primary key,         -- Dexie tank id (timestamp string)
  owner_address  text        not null,            -- wallet address, lowercase
  name           text        not null default '',
  active         boolean     not null default true,
  updated_at     timestamptz not null default now(),
  data           jsonb       not null             -- full Dexie tank object
);

create index if not exists aquadex_tanks_owner_idx
  on public.aquadex_tanks (owner_address);

create index if not exists aquadex_tanks_active_idx
  on public.aquadex_tanks (owner_address, active);

-- ── Specimens ────────────────────────────────────────────────────────────────
create table if not exists public.aquadex_specimens (
  id              text        primary key,        -- Dexie specimen id (timestamp string)
  owner_address   text        not null,
  current_tank_id text        not null default '0',
  species_id      integer     not null default 0,
  status          integer     not null default 0, -- 0=active, 1=sold, 2=deceased
  updated_at      timestamptz not null default now(),
  data            jsonb       not null            -- full Dexie specimen object
);

create index if not exists aquadex_specimens_owner_idx
  on public.aquadex_specimens (owner_address);

create index if not exists aquadex_specimens_tank_idx
  on public.aquadex_specimens (current_tank_id);

-- ── Action Logs ──────────────────────────────────────────────────────────────
create table if not exists public.aquadex_action_logs (
  local_id      text        primary key,          -- Dexie auto-increment id as text
  owner_address text        not null,
  tank_id       text        not null default '',
  action_type   text        not null default '',
  timestamp     bigint      not null default 0,   -- unix epoch seconds
  data          jsonb       not null              -- full Dexie actionLog object
);

create index if not exists aquadex_action_logs_owner_idx
  on public.aquadex_action_logs (owner_address);

create index if not exists aquadex_action_logs_timestamp_idx
  on public.aquadex_action_logs (owner_address, timestamp desc);

-- ── Row Level Security (permissive anon reads/writes scoped by address) ──────
-- We use anon key + explicit owner_address filtering in app code for now.
-- Enable RLS to allow anon key to access these tables:

alter table public.aquadex_tanks        enable row level security;
alter table public.aquadex_specimens    enable row level security;
alter table public.aquadex_action_logs  enable row level security;

-- Allow anon key full access (filtering is done client-side by owner_address).
-- Tighten this to JWT claims once the auth bridge is deployed.
create policy "anon full access tanks"
  on public.aquadex_tanks for all
  to anon using (true) with check (true);

create policy "anon full access specimens"
  on public.aquadex_specimens for all
  to anon using (true) with check (true);

create policy "anon full access action_logs"
  on public.aquadex_action_logs for all
  to anon using (true) with check (true);
