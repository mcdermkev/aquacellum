-- ============================================================================
-- user_xp_profiles — capture the EXISTING schema in the repo
--
-- Part of the §9.5 schema audit (docs/BREEDER_STATE_MODEL.md).
--
-- This table already exists in the live project — cross-device XP restore is a
-- shipped, working feature (`syncXpProfileToCloud` / `pullXpProfileFromCloud` in
-- frontend/src/services/cloudSync.js). It was simply never captured as a
-- migration, so the repo had no record of the schema that production depends on.
-- Columns below are transcribed from the schema block documented above
-- `syncXpProfileToCloud`, which is the authoritative description the client
-- writes against.
--
-- WHY THIS MATTERS BEYOND TIDINESS: `total_xp` drives `current_tier`, which drives
-- every EARNED entitlement (services/entitlements.js) — including whether a
-- breeder can use batch grow-out. An undocumented schema behind an authorization
-- input is worth having on paper.
--
-- ⚠️ DELIBERATELY DDL-ONLY — NO POLICY CHANGES.
-- `CREATE TABLE IF NOT EXISTS` is a no-op against the live table, so applying
-- this is safe. This migration intentionally does NOT create, drop, or alter any
-- RLS policy: the live policies on this table have not been inspected, and
-- guessing at them could either lock out XP sync (breaking tier progression for
-- every user) or silently widen access. Bringing this table's policies in line
-- with the dual-mode convention used by the other cloud-sync tables
-- (20260624110000_jwt_bridge_rls_upgrade.sql) requires first reading the live
-- policy set — tracked as §9.20.
-- ============================================================================

create table if not exists public.user_xp_profiles (
  wallet_address    text        primary key,
  total_xp          integer     not null default 0,
  current_tier      text        not null default 'Shallow',
  streak_days       integer     default 0,
  last_active_date  text,
  monthly_xp        integer     default 0,
  updated_at        timestamptz default now()
);

-- The only access pattern the client uses is a point lookup by wallet, which the
-- primary key already covers. No additional index needed.

-- ============================================================================
-- Done. No behavior change — this records what production already has.
-- ============================================================================
