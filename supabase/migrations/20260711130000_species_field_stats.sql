-- ============================================================================
-- Species Field Stats — Real keeper data aggregation
--
-- Adds:
--   1. aquadex_spawns — cloud sync target for the local-first `spawns` Dexie
--      table (spawn events keyed by species + timestamp). Without this table,
--      spawn activity only ever exists on the breeder's own device and can
--      never be aggregated across users.
--   2. get_species_field_stats(text) — a SECURITY DEFINER RPC that aggregates
--      real water-parameter readings (from aquadex_tanks, joined through
--      aquadex_specimens) and spawn counts (from aquadex_spawns) for a given
--      scientific name, WITHOUT exposing any individual user's raw rows.
--      Fields fall back to NULL when the contributing sample is below a
--      minimum threshold, so a stat can never be traced back to one keeper.
--
-- Privacy / accuracy note: a tank can house multiple species at once, so a
-- water-parameter reading from a mixed-species tank is attributed to every
-- species currently housed there. This answers "what conditions do keepers
-- of this species tend to run," not "this species' own private reading" —
-- and is disclosed as such in the UI copy.
-- ============================================================================

-- ── 1. aquadex_spawns ────────────────────────────────────────────────────────

create table if not exists public.aquadex_spawns (
  spawn_id        text        primary key,          -- Dexie spawnId (timestamp string)
  owner_address   text        not null,              -- wallet address, lowercase
  species_id      integer     not null default 0,    -- on-chain speciesId (sequential, NOT FishBase specCode)
  scientific_name text        not null default '',
  common_name     text        not null default '',
  tank_id         text        not null default '0',
  offspring_count integer     not null default 0,
  event_timestamp bigint      not null default 0,     -- unix epoch seconds
  updated_at      timestamptz not null default now(),
  data            jsonb       not null                -- full Dexie spawn object
);

create index if not exists aquadex_spawns_owner_idx
  on public.aquadex_spawns (owner_address);

create index if not exists aquadex_spawns_species_idx
  on public.aquadex_spawns (lower(scientific_name));

create index if not exists aquadex_spawns_timestamp_idx
  on public.aquadex_spawns (event_timestamp desc);

alter table public.aquadex_spawns enable row level security;

-- Anon (header-based) policies — matches the pattern in
-- 20260619_tighten_cloud_sync_rls.sql for tanks/specimens/action_logs.
create policy "spawns_select_own"
  on public.aquadex_spawns for select
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "spawns_insert_own"
  on public.aquadex_spawns for insert
  to anon
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "spawns_update_own"
  on public.aquadex_spawns for update
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  )
  with check (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

create policy "spawns_delete_own"
  on public.aquadex_spawns for delete
  to anon
  using (
    owner_address = lower(current_setting('request.headers', true)::json->>'x-wallet-address')
  );

-- Authenticated (JWT bridge) policies — matches 20260624110000_jwt_bridge_rls_upgrade.sql.
create policy "spawns_select_own_jwt"
  on public.aquadex_spawns for select
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "spawns_insert_own_jwt"
  on public.aquadex_spawns for insert
  to authenticated
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "spawns_update_own_jwt"
  on public.aquadex_spawns for update
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  )
  with check (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

create policy "spawns_delete_own_jwt"
  on public.aquadex_spawns for delete
  to authenticated
  using (
    owner_address = lower(auth.jwt()->>'wallet_address')
  );

-- ── 2. get_species_field_stats(text) ─────────────────────────────────────────
-- SECURITY DEFINER: executes with the privileges of the function owner,
-- bypassing RLS on aquadex_tanks / aquadex_specimens / aquadex_spawns so it
-- can aggregate across ALL users. It only ever returns aggregate numbers
-- (medians, counts, averages) — never a raw per-user row — so granting anon
-- execute access does not leak any individual's private data.
create or replace function public.get_species_field_stats(p_scientific_name text)
returns table (
  median_temp_c       numeric,
  median_ph           numeric,
  tank_sample_size    integer,
  spawns_30d          integer,
  spawns_total        integer,
  avg_offspring_count numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  min_sample constant integer := 3; -- never surface a stat built from fewer than this many keepers
begin
  return query
  with matching_specimens as (
    -- Specimens of the target species that are currently assigned to a tank.
    select id, current_tank_id
    from public.aquadex_specimens
    where lower(data->>'scientificName') = lower(p_scientific_name)
      and current_tank_id is not null
      and current_tank_id <> '0'
  ),
  tank_logs as (
    -- Flatten each qualifying tank's jsonb `logs` array into individual readings.
    select
      t.id as tank_id,
      (log_entry->>'tempCelsiusX10')::numeric / 10.0 as temp_c,
      (log_entry->>'phX10')::numeric / 10.0 as ph
    from public.aquadex_tanks t
    join matching_specimens ms on ms.current_tank_id = t.id
    cross join lateral jsonb_array_elements(coalesce(t.data->'logs', '[]'::jsonb)) as log_entry
    where t.active = true
  ),
  tank_agg as (
    select
      count(distinct tank_id) as sample_size,
      percentile_cont(0.5) within group (order by temp_c) as median_temp,
      percentile_cont(0.5) within group (order by ph) as median_ph
    from tank_logs
    where temp_c is not null and ph is not null
  ),
  spawn_agg as (
    select
      count(*) filter (
        where event_timestamp >= extract(epoch from now() - interval '30 days')
      ) as spawns_last_30d,
      count(*) as spawns_all_time,
      avg(offspring_count) as avg_offspring
    from public.aquadex_spawns
    where lower(scientific_name) = lower(p_scientific_name)
  )
  select
    case when tank_agg.sample_size >= min_sample then round(tank_agg.median_temp, 1) else null end,
    case when tank_agg.sample_size >= min_sample then round(tank_agg.median_ph, 2) else null end,
    tank_agg.sample_size::integer,
    coalesce(spawn_agg.spawns_last_30d, 0)::integer,
    coalesce(spawn_agg.spawns_all_time, 0)::integer,
    case when spawn_agg.spawns_all_time >= min_sample then round(spawn_agg.avg_offspring, 0) else null end
  from tank_agg, spawn_agg;
end;
$$;

-- Aggregates only — safe to expose to anon + authenticated roles.
grant execute on function public.get_species_field_stats(text) to anon, authenticated;
