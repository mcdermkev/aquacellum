-- ═══════════════════════════════════════════════════════════════════════════
-- Bound school_challenges.reward_xp
--
-- reward_xp is set by whoever creates the challenge and was unbounded. It no
-- longer determines the XP award — that is fixed by the platform
-- (CHALLENGE_COMPLETED 50, CHALLENGE_WON 150 in utils/xp.js and
-- api/validate-xp.js) precisely because host-controlled input must never decide a
-- reward amount. Otherwise any founder could create a challenge worth 999999,
-- enter it alone, and mint XP indefinitely.
--
-- The column survives as the host's STATED prize for display, so it still gets a
-- sane range: an unbounded integer here would render as a headline promise the
-- app has no intention of paying.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE school_challenges SET reward_xp = 100
 WHERE reward_xp IS NULL OR reward_xp < 0 OR reward_xp > 1000;

ALTER TABLE school_challenges DROP CONSTRAINT IF EXISTS school_challenges_reward_xp_bounded;
ALTER TABLE school_challenges ADD CONSTRAINT school_challenges_reward_xp_bounded
  CHECK (reward_xp IS NULL OR (reward_xp >= 0 AND reward_xp <= 1000));

COMMENT ON COLUMN school_challenges.reward_xp IS
  'The host''s stated prize, for display only. Actual XP is fixed by the platform (50 completed / 150 won) and claimed atomically via school_challenge_participants.xp_claimed_at — a host-settable amount would be an unlimited XP mint.';
