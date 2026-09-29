-- Shared rate limiter for the AI endpoints — 2026-10-03.
-- ============================================================================
-- api/ai.js limited Poseidon chat with an in-memory Map (_lib/rateLimiter.js),
-- which is per warm Vercel instance and resets on cold start. The effective cap
-- was roughly N instances x 30/hour and rose under load.
--
-- This adds one fixed-window counter shared by every instance:
--   * public.ai_rate_limits: one row per (key, window_start). The key is a
--     server-side hash (HMAC-SHA256) of the caller's IP or verified account,
--     so no raw IP or wallet is stored.
--   * public.ai_rate_hit(p_key, p_window_seconds, p_max): atomic upsert that
--     increments the current window and reports whether the call is allowed.
--
-- Server only. RLS is on with no policies, and execute is revoked from anon and
-- authenticated; only service_role (the API) calls it. The API falls back to the
-- in-memory limiter when this function does not exist yet, so deploying the code
-- before this migration is safe.
-- ============================================================================

begin;

create table if not exists public.ai_rate_limits (
  key          text        not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (key, window_start)
);

-- For the occasional sweep of expired windows.
create index if not exists ai_rate_limits_window_start_idx
  on public.ai_rate_limits (window_start);

alter table public.ai_rate_limits enable row level security;
revoke all on table public.ai_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_rate_limits to service_role;

-- Returns {allowed, hits, limit, resetIn} where resetIn is seconds until the
-- current window ends. Over-limit calls still count (hits keeps rising) so a
-- caller hammering the endpoint stays blocked for the rest of the window.
create or replace function public.ai_rate_hit(p_key text, p_window_seconds integer, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := now();
  v_window timestamptz;
  v_hits   integer;
begin
  if p_key is null or char_length(p_key) = 0 or char_length(p_key) > 200 then
    raise exception 'invalid key' using errcode = 'invalid_parameter_value';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid window' using errcode = 'invalid_parameter_value';
  end if;
  if p_max is null or p_max < 1 or p_max > 100000 then
    raise exception 'invalid max' using errcode = 'invalid_parameter_value';
  end if;

  -- Align to fixed windows since the epoch, so every instance agrees on the bucket.
  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.ai_rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Cheap housekeeping: roughly 1 call in 200 sweeps windows older than 2 days.
  if random() < 0.005 then
    delete from public.ai_rate_limits where window_start < v_now - interval '2 days';
  end if;

  return jsonb_build_object(
    'allowed', v_hits <= p_max,
    'hits',    v_hits,
    'limit',   p_max,
    'resetIn', greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer)
  );
end;
$$;

revoke all on function public.ai_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_rate_hit(text, integer, integer) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.ai_rate_hit(text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_rate_hit(text, integer, integer)', 'execute') then
    raise exception 'browser roles can execute ai_rate_hit';
  end if;
  if not has_function_privilege('service_role', 'public.ai_rate_hit(text, integer, integer)', 'execute') then
    raise exception 'service_role cannot execute ai_rate_hit';
  end if;
  if has_table_privilege('anon', 'public.ai_rate_limits', 'select')
     or has_table_privilege('authenticated', 'public.ai_rate_limits', 'select') then
    raise exception 'browser roles can read ai_rate_limits';
  end if;
end;
$$;

commit;
