-- ═══════════════════════════════════════════════════════════════════════════
-- Write tides.recap_content when a tide ends
--
-- TidePage has a Recap tab, fully built, gated on `isEnded && tide.recap_content`.
-- No code anywhere ever wrote recap_content, so that condition was never true and
-- the tab could not appear for any tide that had ever existed. useEndTide posted a
-- closing chat line and flipped status; the recap it implies was never produced.
--
-- ── ONLY TRUE NUMBERS ───────────────────────────────────────────────────────
--
-- The renderer draws three stats, each guarded with `!= null`, which is the hook
-- to use honestly: a stat that cannot be known is OMITTED rather than written as
-- zero. "0 Trades" on a busy swap meet is worse than no trades figure at all,
-- because it reads as a fact.
--
--   total_attendees  always known — count of RSVP rows.
--   xp_awarded       real, not notional: 100 per attendee whose check-in XP was
--                    actually claimed (tide_attendees.xp_awarded), not per
--                    attendee who merely turned up.
--   total_trades     ONLY for auctions, where a settled lot is a real completed
--                    trade. Nothing in the schema records a swap-meet handshake,
--                    so for every other type this key is left out entirely.
--
-- The summary is generated from those same facts. It is deliberately plain: an
-- enthusiastic recap of an event nobody attended reads badly.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION build_tide_recap(target_tide UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t             tides;
  attendees     INTEGER;
  checked_in    INTEGER;
  xp_total      INTEGER;
  lots_sold     INTEGER;
  chat_messages INTEGER;
  stats         jsonb;
  summary       TEXT;
BEGIN
  SELECT * INTO t FROM tides WHERE id = target_tide;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'Tide does not exist.';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE a.checked_in_at IS NOT NULL),
         100 * count(*) FILTER (WHERE a.xp_awarded)
    INTO attendees, checked_in, xp_total
    FROM tide_attendees a
   WHERE a.tide_id = target_tide;

  SELECT count(*) INTO chat_messages
    FROM tide_chat c
   WHERE c.tide_id = target_tide AND NOT c.is_system_message;

  stats := jsonb_build_object('total_attendees', coalesce(attendees, 0));

  -- Only claim XP that was actually claimed.
  IF coalesce(xp_total, 0) > 0 THEN
    stats := stats || jsonb_build_object('xp_awarded', xp_total);
  END IF;

  -- Trades are only a real, recorded thing for auctions.
  IF t.tide_type = 'auction' THEN
    SELECT count(*) INTO lots_sold
      FROM auction_settlements s
     WHERE s.tide_id = target_tide
       AND s.status IN ('paid', 'transferred');
    stats := stats || jsonb_build_object('total_trades', coalesce(lots_sold, 0));
  END IF;

  -- ── Summary ─────────────────────────────────────────────────────────────
  IF coalesce(attendees, 0) = 0 THEN
    summary := 'This tide ended without any RSVPs.';
  ELSE
    summary := format(
      '%s %s RSVP''d to %s.',
      attendees,
      CASE WHEN attendees = 1 THEN 'keeper' ELSE 'keepers' END,
      t.title
    );

    IF t.tide_type = 'expo' AND coalesce(checked_in, 0) > 0 THEN
      summary := summary || format(
        ' %s checked in on site.',
        checked_in
      );
    END IF;

    IF t.tide_type = 'auction' AND coalesce(lots_sold, 0) > 0 THEN
      summary := summary || format(
        ' %s %s sold.',
        lots_sold,
        CASE WHEN lots_sold = 1 THEN 'lot' ELSE 'lots' END
      );
    END IF;

    IF coalesce(chat_messages, 0) > 0 THEN
      summary := summary || format(
        ' %s %s shared during the event.',
        chat_messages,
        CASE WHEN chat_messages = 1 THEN 'message was' ELSE 'messages were' END
      );
    END IF;
  END IF;

  UPDATE tides
     SET recap_content = jsonb_build_object(
           'summary', summary,
           'stats', stats,
           'generated_at', to_jsonb(now())
         )
   WHERE id = target_tide;

  RETURN jsonb_build_object('summary', summary, 'stats', stats);
END;
$$;

COMMENT ON FUNCTION build_tide_recap(UUID) IS
  'Generates tides.recap_content from what actually happened. Omits any stat that cannot be known rather than writing zero — the Recap tab guards each stat with != null, so an unknown figure should be absent, not reported as 0.';

-- Backfill ended tides that never got one, so the Recap tab is not empty for the
-- events that already happened.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM tides
     WHERE status = 'ended' AND recap_content IS NULL
  LOOP
    PERFORM build_tide_recap(r.id);
  END LOOP;
END $$;
