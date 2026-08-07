-- ============================================================================
-- Migration: Authoritative monthly XP read function
--
-- Reward distributions are "proportional to XP earned that month"
-- (GAMIFICATION_SPEC §6). The authoritative, anti-gamed source of that number is
-- the xp_events ledger: only /api/validate-xp (service role) can insert rows, so
-- it excludes the unvalidated optimistic XP that a client awards locally. This
-- mirrors get_server_xp_total() from 20260624120000_xp_server_authority.sql.
--
-- WHY THIS REPLACES A CLIENT COUNTER. The client used to keep its own
-- userProfile.monthlyXp counter, increment it on every award, and merge it into
-- user_xp_profiles.monthly_xp with a "highest wins" rule. That counter never
-- reset, so it could only ever grow and would clobber any server-side monthly
-- reset. Deriving the figure from xp_events at read time removes that whole class
-- of drift: the month boundary is computed in SQL, not maintained by hand.
--
-- SECURITY. LANGUAGE sql (SECURITY INVOKER) respects RLS. xp_events already has
-- per-wallet SELECT policies (20260624120000 §5), so a user calling this for
-- their own wallet sums their own rows, and passing any other wallet sums the
-- rows they can see (none) and returns 0. The future distribution engine calls it
-- as the service role, which bypasses RLS and sees the full totals.
--
-- Uses idx_xp_events_monthly (wallet_address, created_at) from 011_zone_leaderboard.
--
-- DORMANT: nothing in the product calls this yet. It is the read half of the
-- rewards plumbing, built ahead of activation.
--
-- Run this in the Supabase SQL Editor (hand-applied — see supabase/migration-order.json).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_monthly_xp(p_wallet TEXT)
RETURNS INTEGER AS $$
  SELECT COALESCE(SUM(final_points), 0)::INTEGER
  FROM xp_events
  WHERE wallet_address = p_wallet
    AND created_at >= date_trunc('month', now());
$$ LANGUAGE sql STABLE;
