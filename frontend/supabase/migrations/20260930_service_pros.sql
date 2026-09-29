-- Service pros: tank maintenance for clients — 2026-09-30.
-- AQUASHELLA_FEEDBACK.md §5.4, docs/SERVICE_PROS_SPEC.md. No money path.
-- The client share link is an authorization boundary (Tier A).
-- ============================================================================
-- A pro (any signed-in wallet) keeps clients → sites → tanks, and logs service
-- visits on those tanks. A client can be given a read-only history link.
--
-- These are NOT the pro's own husbandry tanks (Dexie + aquadex_tanks, local
-- first). Client tanks belong to the business, live only on the server, and
-- never touch the pro's own stats, XP or the on-chain queue.
--
-- Ownership: every row carries pro_wallet, and the composite foreign keys make
-- a child row's pro_wallet (and client) match its parent's, so a pro can never
-- hang a tank or visit off someone else's client, even with a forged id.
--
-- Everything is server-only (service role). api/_lib/servicePros.js takes the
-- wallet from the verified session and filters every query by it.
--
-- The share token is stored in the clear (unlike booth invites) so the pro can
-- copy the link again later. It's 24 random bytes, readable only by the
-- service role, and can be turned off or replaced at any time.
-- ============================================================================

begin;

create table if not exists public.service_clients (
  id            uuid primary key default gen_random_uuid(),
  pro_wallet    text not null check (pro_wallet ~ '^0x[0-9a-f]{40}$'),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  contact_name  text check (contact_name is null or char_length(contact_name) <= 120),
  phone         text check (phone is null or char_length(phone) <= 40),
  email         text check (email is null or char_length(email) <= 200),
  notes         text check (notes is null or char_length(notes) <= 2000),
  share_token   text unique check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{32}$'),
  share_enabled boolean not null default false,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, pro_wallet)
);
create index if not exists idx_service_clients_pro on public.service_clients (pro_wallet, archived_at, name);

create table if not exists public.service_sites (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null,
  pro_wallet    text not null,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  address       text check (address is null or char_length(address) <= 300),
  -- Gate codes, key boxes, "ask for Maria". Never shown to the client link.
  access_notes  text check (access_notes is null or char_length(access_notes) <= 1000),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (id, client_id, pro_wallet),
  foreign key (client_id, pro_wallet) references public.service_clients (id, pro_wallet) on delete cascade
);
create index if not exists idx_service_sites_client on public.service_sites (client_id);

create table if not exists public.service_tanks (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null,
  client_id        uuid not null,
  pro_wallet       text not null,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  kind             text not null default 'freshwater'
                   check (kind in ('freshwater', 'planted', 'brackish', 'saltwater', 'reef', 'pond', 'other')),
  volume_liters    numeric(8, 1) check (volume_liters is null or (volume_liters > 0 and volume_liters <= 100000)),
  livestock        text check (livestock is null or char_length(livestock) <= 2000),
  equipment        text check (equipment is null or char_length(equipment) <= 2000),
  visit_every_days integer check (visit_every_days is null or visit_every_days between 1 and 365),
  last_visit_at    timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, client_id, pro_wallet),
  foreign key (site_id, client_id, pro_wallet) references public.service_sites (id, client_id, pro_wallet) on delete cascade
);
create index if not exists idx_service_tanks_client on public.service_tanks (client_id);
create index if not exists idx_service_tanks_pro on public.service_tanks (pro_wallet) where archived_at is null;

create table if not exists public.service_visits (
  id                   uuid primary key default gen_random_uuid(),
  tank_id              uuid not null,
  client_id            uuid not null,
  pro_wallet           text not null,
  visited_at           timestamptz not null,
  logged_by            text not null,
  tasks                text[] not null default '{}'
                       check (tasks <@ array['water_change', 'glass_clean', 'gravel_vac', 'filter_clean', 'algae_scrub',
                                             'plant_trim', 'top_off', 'dose', 'feed', 'equipment_check',
                                             'livestock_check', 'other']::text[]),
  water_change_percent integer check (water_change_percent is null or water_change_percent between 1 and 100),
  readings             jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(readings) = 'object' and pg_column_size(readings) <= 2048),
  client_note          text check (client_note is null or char_length(client_note) <= 2000),
  -- Pro only. Never shown to the client link.
  private_note         text check (private_note is null or char_length(private_note) <= 2000),
  created_at           timestamptz not null default now(),
  foreign key (tank_id, client_id, pro_wallet) references public.service_tanks (id, client_id, pro_wallet) on delete cascade
);
create index if not exists idx_service_visits_tank on public.service_visits (tank_id, visited_at desc);
create index if not exists idx_service_visits_client on public.service_visits (client_id, visited_at desc);

-- A tank's last visit follows its visits (logged, back-dated, or deleted).
create or replace function public.service_tank_touch_last_visit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tank uuid := coalesce(new.tank_id, old.tank_id);
begin
  update public.service_tanks t
     set last_visit_at = (select max(v.visited_at) from public.service_visits v where v.tank_id = v_tank),
         updated_at = now()
   where t.id = v_tank;
  return null;
end;
$$;
drop trigger if exists trg_service_visits_last_visit on public.service_visits;
create trigger trg_service_visits_last_visit
  after insert or update of visited_at or delete on public.service_visits
  for each row execute function public.service_tank_touch_last_visit();
revoke all on function public.service_tank_touch_last_visit() from public, anon, authenticated;

-- ── Server only ───────────────────────────────────────────────────────────
alter table public.service_clients enable row level security;
alter table public.service_sites   enable row level security;
alter table public.service_tanks   enable row level security;
alter table public.service_visits  enable row level security;
drop policy if exists "service_clients service role" on public.service_clients;
drop policy if exists "service_sites service role"   on public.service_sites;
drop policy if exists "service_tanks service role"   on public.service_tanks;
drop policy if exists "service_visits service role"  on public.service_visits;
create policy "service_clients service role" on public.service_clients for all using (auth.role() = 'service_role');
create policy "service_sites service role"   on public.service_sites   for all using (auth.role() = 'service_role');
create policy "service_tanks service role"   on public.service_tanks   for all using (auth.role() = 'service_role');
create policy "service_visits service role"  on public.service_visits  for all using (auth.role() = 'service_role');
revoke all on public.service_clients, public.service_sites, public.service_tanks, public.service_visits from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['service_clients', 'service_sites', 'service_tanks', 'service_visits'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') then
      raise exception 'browser roles can read %', t;
    end if;
  end loop;
end;
$$;

commit;
