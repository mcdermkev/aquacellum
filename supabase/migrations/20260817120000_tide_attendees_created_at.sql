-- ═══════════════════════════════════════════════════════════════════════════
-- tide_attendees.created_at — the column two queries have always ordered by
--
-- THE BUG. 009_tides_tables.sql created tide_attendees with these columns and no
-- more:
--
--   id, tide_id, wallet_address, rsvp_status, bringing_species,
--   checked_in_at, xp_awarded
--
-- But services/tidesApi.js has always ordered by `created_at`, in two places:
--
--   getTideAttendees()  .order("created_at", { ascending: false })
--   getMyTides()        .order("created_at", { ascending: false })
--
-- PostgREST answers that with a hard 42703 (`column ... does not exist`), and
-- useTides.js does `select: (res) => res.data` — throwing the error away — so the
-- component received a clean empty array and rendered its empty state.
--
-- The result, verified against production before writing this: four genuine RSVP
-- rows existed across three tides, and every single one displayed as
-- "Attendees (0) — No RSVPs yet. Be the first!". `getMyRsvp` does not order, so
-- the SAME table simultaneously reported "✓ Checked In" to the person whose row
-- it was. That contradiction is what made the whole feature read as fake.
--
-- getMyTides being broken had a second effect: `tide.my_rsvp` was always
-- undefined, so TideCalendar could never render "✓ Going" and always showed its
-- (also non-functional) "RSVP" button instead.
--
-- WHY ADD THE COLUMN RATHER THAN DROP THE ORDER BY. "Who RSVP'd first" is real
-- information — it drives the attendee list order and "My Tides" recency — and
-- the id is a v4 UUID, so it carries no chronology to sort on instead.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tide_attendees
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill existing rows with the best evidence available rather than stamping
-- them all with "now", which would order genuine history randomly. A checked-in
-- attendee has a real timestamp; anyone else falls back to their tide's start,
-- which is at least the right era. COALESCE order matters here.
UPDATE tide_attendees a
   SET created_at = COALESCE(a.checked_in_at, t.start_time, now())
  FROM tides t
 WHERE t.id = a.tide_id
   AND a.created_at IS NOT NULL
   -- Only touch rows that just received the DEFAULT in this migration, i.e. rows
   -- created before the column existed. A fresh install has none of these.
   AND a.created_at >= now() - interval '5 minutes';

-- The ordering index the two queries actually want.
CREATE INDEX IF NOT EXISTS idx_tide_attendees_tide_created
  ON tide_attendees (tide_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tide_attendees_wallet_created
  ON tide_attendees (wallet_address, created_at DESC);

COMMENT ON COLUMN tide_attendees.created_at IS
  'When the RSVP was first made. Added 2026-08-17: tidesApi.getTideAttendees and getMyTides had always ordered by this column, which did not exist, so both silently returned empty and the attendee list read as zero for every tide.';
