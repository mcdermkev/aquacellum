-- ============================================================================
-- profiles: stop exposing email and other private columns to every visitor
-- ============================================================================
-- "Public profiles are readable" is USING (true) for {public}, and anon and
-- authenticated held table-level SELECT, so any visitor with the public anon key
-- could read every row's email, notification_preferences, reward_credits, ban
-- flags and so on (`set role anon; select email from profiles` returned all 5).
--
-- Rows stay public (the policy is unchanged). Columns become an allowlist:
--
--   PUBLIC (anon + authenticated; every column some public surface reads):
--     wallet_address, display_name, avatar_url, bio, tank_count, species_count,
--     xp_total, companion_tier, created_at, updated_at, accepting_mentees,
--     depth_score, depth_tier, zone_hash, total_xp, current_tier
--   (zone_hash is already public through the zone_leaderboard view.)
--
--   PRIVATE (owner via my_profile_private(), server via service_role):
--     email, notification_preferences, privacy_settings, reward_credits,
--     monthly_xp, streak_days, last_active_date, zone_assigned_at,
--     zone_transfer_cooldown, muted_until, is_banned, banned_at,
--     poseidon_summary, onboarding_complete, deletion_requested_at,
--     account_deleted_at, and any column added later (new columns are private
--     unless explicitly granted).
--
-- Column privileges cannot vary per row, so the signed-in user's own private
-- fields come from my_profile_private(): SECURITY DEFINER, identity from the
-- signed JWT claim (public.current_wallet()), returns that one row as jsonb.
--
-- Also: a guard trigger so browser roles cannot write server-owned columns on
-- their own row (ban/mute flags, reward credits, server XP/tier, depth score,
-- streaks, AI summary, mentorship flag). The owner UPDATE policy had no column
-- restriction, so a user could unban themselves or set reward_credits. The
-- columns the app writes from the browser (display_name, avatar_url, bio, email,
-- notification_preferences, tank_count, species_count, xp_total,
-- companion_tier, zone_hash, zone_assigned_at, zone_transfer_cooldown,
-- updated_at) are unaffected.
--
-- Unaffected: service_role (all api/* and Edge Functions), SECURITY DEFINER
-- functions and security_invoker=false views (aquadex_listings_public,
-- public_leaderboard, weekly_contributors, zone_leaderboard, auction_lots_public)
-- which read profiles as their owner.
--
-- REQUIRES the matching client change (explicit column lists instead of
-- select("*") in reefApi/gdprService, private reads via my_profile_private()).
-- A select=* on profiles from the browser fails with 42501 after this.
--
-- REVERSIBILITY (restores the old exposure; only if something breaks):
--   grant select on public.profiles to anon, authenticated;
--   drop trigger if exists profiles_guard_server_columns on public.profiles;
-- ============================================================================

begin;

-- ── 1. Column allowlist for browser roles ───────────────────────────────────
revoke select on table public.profiles from anon, authenticated;

grant select (
  wallet_address, display_name, avatar_url, bio,
  tank_count, species_count, xp_total, companion_tier,
  created_at, updated_at, accepting_mentees,
  depth_score, depth_tier, zone_hash, total_xp, current_tier
) on table public.profiles to anon, authenticated;

-- ── 2. Owner-only read of the full row ──────────────────────────────────────
create or replace function public.my_profile_private()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(p)
    from public.profiles p
   where public.current_wallet() is not null
     and lower(p.wallet_address) = public.current_wallet()
   order by (p.wallet_address = public.current_wallet()) desc
   limit 1;
$$;

comment on function public.my_profile_private() is
  'The caller''s own profiles row (all columns) as jsonb, identified by the signed JWT wallet_address claim. NULL when signed out or no row. Browser roles cannot read private profile columns any other way.';

revoke all on function public.my_profile_private() from public, anon, authenticated;
grant execute on function public.my_profile_private() to authenticated, service_role;

-- ── 3. Browser roles cannot write server-owned columns ──────────────────────
create or replace function public.profiles_guard_server_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_banned, false) or new.banned_at is not null or new.muted_until is not null
       or coalesce(new.reward_credits, 0) <> 0 or coalesce(new.total_xp, 0) <> 0
       or coalesce(new.monthly_xp, 0) <> 0 or coalesce(new.depth_score, 0) <> 0
       or coalesce(new.streak_days, 0) <> 0 or new.poseidon_summary is not null
       or coalesce(new.accepting_mentees, false) then
      raise exception 'server-managed profile fields cannot be set from the browser'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.is_banned        is distinct from old.is_banned
  or new.banned_at        is distinct from old.banned_at
  or new.muted_until      is distinct from old.muted_until
  or new.reward_credits   is distinct from old.reward_credits
  or new.total_xp         is distinct from old.total_xp
  or new.monthly_xp       is distinct from old.monthly_xp
  or new.current_tier     is distinct from old.current_tier
  or new.depth_score      is distinct from old.depth_score
  or new.depth_tier       is distinct from old.depth_tier
  or new.streak_days      is distinct from old.streak_days
  or new.last_active_date is distinct from old.last_active_date
  or new.poseidon_summary is distinct from old.poseidon_summary
  or new.accepting_mentees is distinct from old.accepting_mentees then
    raise exception 'server-managed profile fields cannot be changed from the browser'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_server_columns on public.profiles;
create trigger profiles_guard_server_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_server_columns();

-- ── 4. Self-check ───────────────────────────────────────────────────────────
do $$
declare
  c text;
begin
  foreach c in array array['email', 'notification_preferences', 'privacy_settings',
    'reward_credits', 'is_banned', 'banned_at', 'muted_until', 'streak_days',
    'last_active_date', 'monthly_xp', 'poseidon_summary', 'zone_transfer_cooldown']
  loop
    if has_column_privilege('anon', 'public.profiles', c, 'select')
       or has_column_privilege('authenticated', 'public.profiles', c, 'select') then
      raise exception 'browser roles can still read profiles.%', c;
    end if;
  end loop;
  if not has_column_privilege('anon', 'public.profiles', 'display_name', 'select') then
    raise exception 'anon lost profiles.display_name';
  end if;
  if has_function_privilege('anon', 'public.my_profile_private()', 'execute') then
    raise exception 'anon can execute my_profile_private';
  end if;
end;
$$;

commit;
