-- ============================================================================
-- public_leaderboard — display-safe XP standings for the public /leaderboard page
-- ============================================================================
-- frontend/leaderboard.html used to render a hard-coded list of invented users.
-- It now reads this view and shows an honest empty state until it exists.
--
-- WHY A VIEW AND NOT profiles: `profiles` is a wide table (email, wallet_address,
-- notification_preferences, ban flags, reward_credits ...). The public page must
-- only ever be able to see four things, so this view is the allowlist:
--
--   rank          position by total_xp (ties share a rank)
--   display_name  the name the keeper chose in Settings
--   current_tier  Shallow / Coastal / Pelagic / Abyssal / Hadal
--   total_xp      profiles.total_xp (maintained from server-side xp_events)
--
-- No wallet address, email, avatar, zone or timestamps. Anyone who wants to be
-- linked from here can be added later as an explicit, opt-in column.
--
-- WHO IS LISTED: total_xp > 0, a non-blank display name, not banned, and not
-- opted out via privacy_settings.activity = 'private' (the key already exists on
-- every row with default 'public'; nothing in the app writes 'private' yet, so
-- this is a forward guard, not a feature). Top 100 only.
--
-- security_invoker = false is deliberate (same pattern as aquadex_listings_public):
-- the view reads profiles as its owner so anon never needs a grant on profiles.
--
-- REVERSIBILITY: `drop view if exists public.public_leaderboard;` The page falls
-- back to its empty state.
-- ============================================================================

begin;

create or replace view public.public_leaderboard
with (security_invoker = false) as
select
  rank() over (order by p.total_xp desc)::integer as rank,
  btrim(p.display_name)                         as display_name,
  coalesce(p.current_tier, 'Shallow')           as current_tier,
  p.total_xp::integer                           as total_xp
from public.profiles p
where coalesce(p.total_xp, 0) > 0
  and nullif(btrim(p.display_name), '') is not null
  and coalesce(p.is_banned, false) = false
  and coalesce(p.privacy_settings ->> 'activity', 'public') <> 'private'
order by p.total_xp desc
limit 100;

comment on view public.public_leaderboard is
  'Display-safe XP standings for the public leaderboard page (frontend/leaderboard.html). Allowlist: rank, display_name, current_tier, total_xp. No wallet, email or other profile fields.';

-- Supabase default privileges hand new relations ALL to anon/authenticated.
-- Strip that, then grant read only.
revoke all on public.public_leaderboard from public, anon, authenticated;
grant select on public.public_leaderboard to anon, authenticated;

commit;

-- ── VERIFY (after apply, as anon) ───────────────────────────────────────────
--   set role anon;
--   select * from public.public_leaderboard limit 5;   -- four columns only
--   select has_table_privilege('anon', 'public.public_leaderboard', 'INSERT'); -- false
--   reset role;
