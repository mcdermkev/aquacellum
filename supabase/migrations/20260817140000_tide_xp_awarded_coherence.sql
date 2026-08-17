-- ═══════════════════════════════════════════════════════════════════════════
-- tide_attendees.xp_awarded — repair incoherent rows and keep them honest
--
-- Nothing ever read or wrote this column, so it drifted in both directions.
-- Production had, simultaneously:
--
--   "Jersey meet"  checked_in_at SET,  xp_awarded FALSE  -- showed up, paid nothing
--   "new auction"  checked_in_at NULL, xp_awarded TRUE   -- never came, marked paid
--
-- The second one is now actively harmful. Check-in claims its XP with a
-- conditional UPDATE filtered on `xp_awarded = false` (that filter is what makes
-- the claim idempotent against double-taps), so a row pre-marked TRUE would
-- silently deny that keeper the 100 XP on a genuine first check-in.
--
-- xp_awarded can only ever mean "the check-in reward for this tide has been
-- paid", and check-in XP requires checking in. A row with no checked_in_at
-- therefore cannot have been paid, so reset it and add a CHECK so the two columns
-- can never contradict each other again.
--
-- Rows in the OTHER direction (checked in, never paid) are deliberately left
-- alone: back-paying XP for historical check-ins would be inventing ledger
-- entries, and the flag being false means they can simply claim it next time.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE tide_attendees
   SET xp_awarded = false
 WHERE xp_awarded = true
   AND checked_in_at IS NULL;

ALTER TABLE tide_attendees DROP CONSTRAINT IF EXISTS tide_attendees_xp_requires_checkin;
ALTER TABLE tide_attendees ADD CONSTRAINT tide_attendees_xp_requires_checkin
  CHECK (NOT (xp_awarded AND checked_in_at IS NULL));

COMMENT ON COLUMN tide_attendees.xp_awarded IS
  'True once the one-time check-in XP has been paid for this tide. Claimed atomically via UPDATE ... WHERE xp_awarded = false so a retry or second device cannot double-pay. Constrained to require checked_in_at.';
