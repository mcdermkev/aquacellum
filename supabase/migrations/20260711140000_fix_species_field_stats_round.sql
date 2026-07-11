-- ============================================================================
-- FIX: get_species_field_stats — round(double precision, integer) does not exist
--
-- percentile_cont() returns double precision, but Postgres only defines
-- round(numeric, integer) — not a double-precision overload. Every call to
-- this RPC was failing with:
--   42883: function round(double precision, integer) does not exist
-- (confirmed by a direct REST call against the live function immediately
-- after 20260711130000_species_field_stats.sql was deployed).
--
-- FIX: cast the percentile_cont() results to numeric before rounding.
-- Idempotent: CREATE OR REPLACE FUNCTION is always safe to re-run.
-- ============================================================================

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
    select id, current_tank_id
    from public.aquadex_specimens
    where lower(data->>'scientificName') = lower(p_scientific_name)
      and current_tank_id is not null
      and current_tank_id <> '0'
  ),
  tank_logs as (
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
      percentile_cont(0.5) within group (order by temp_c)::numeric as median_temp,
      percentile_cont(0.5) within group (order by ph)::numeric as median_ph
    from tank_logs
    where temp_c is not null and ph is not null
  ),
  spawn_agg as (
    select
      count(*) filter (
        where event_timestamp >= extract(epoch from now() - interval '30 days')
      ) as spawns_last_30d,
      count(*) as spawns_all_time,
      avg(offspring_count)::numeric as avg_offspring
    from public.aquadex_spawns
    where lower(scientific_name) = lower(p_scientific_name)
  )
  select
    case when tank_agg.sample_size >= min_sample then round(tank_agg.median_temp::numeric, 1) else null end,
    case when tank_agg.sample_size >= min_sample then round(tank_agg.median_ph::numeric, 2) else null end,
    tank_agg.sample_size::integer,
    coalesce(spawn_agg.spawns_last_30d, 0)::integer,
    coalesce(spawn_agg.spawns_all_time, 0)::integer,
    case when spawn_agg.spawns_all_time >= min_sample then round(spawn_agg.avg_offspring::numeric, 0) else null end
  from tank_agg, spawn_agg;
end;
$$;

grant execute on function public.get_species_field_stats(text) to anon, authenticated;
