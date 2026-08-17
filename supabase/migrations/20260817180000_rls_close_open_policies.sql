-- ═══════════════════════════════════════════════════════════════════════════
-- RLS phase 1: remove every USING(true) policy and give the exposed tables
-- real ones
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- 43 policies named dev_* carried USING(true) / WITH CHECK(true) across 17
-- tables. RLS policies for the same command are OR'd, so one USING(true) beside
-- a strict policy silently defeats it — the strict policy might as well not
-- exist. On `messages` it was worse: the NON-dev policies ("Users read
-- messages", "Allow sending messages", "Allow message updates") were also
-- unconditionally true, so removing only the dev_* ones would have changed
-- nothing.
--
-- The anon key ships inside the browser bundle, so "no policy restriction" means
-- world-readable and world-writable by anyone who opens devtools.
--
-- ── MEASURED, NOT ASSUMED ───────────────────────────────────────────────────
--
-- frontend/scripts/verify-rls.mjs probes live PostgREST with three identities
-- (anon-only, a minted JWT, and a forged x-wallet-address header). Before this
-- migration, with NO identity whatsoever:
--
--   messages           15 rows   ← private direct messages
--   tides               5 rows
--   tide_attendees      4 rows
--   tide_chat           2 rows
--   species_insights    5 rows
--
-- The same script confirmed the JWT bridge genuinely enforces: aquadex_specimens
-- returned 38 rows for a minted JWT and 0 for anon. That is what makes writing
-- JWT-based policies here safe rather than a guess — the mechanism is proven to
-- work against production before being depended on.
--
-- ── SCOPE OF THIS MIGRATION ─────────────────────────────────────────────────
--
-- Closes the "no credential at all" hole. It deliberately leaves the 30
-- header-based policies in place: those are separately spoofable and are removed
-- in the next migration, so that this one cannot cause a lockout on its own.
-- Public read stays public where that is the actual product intent (the events
-- calendar, community insights) — the fix there is locking down WRITES.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Drop every unconditional policy ─────────────────────────────────────
DO $$
DECLARE r record; dropped int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (
         policyname LIKE 'dev_%'
         -- Non-dev policies that are also unconditional. `qual` is the USING
         -- clause and `with_check` the WITH CHECK clause; a policy with 'true'
         -- in the relevant slot and nothing in the other grants everything.
         OR (coalesce(qual::text, 'true') = 'true' AND coalesce(with_check::text, 'true') = 'true')
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'Dropped % unconditional policies', dropped;
END $$;

-- ── 2. Helper: the caller's wallet, from the JWT only ──────────────────────
--
-- Reads auth.jwt() and nothing else. Deliberately does NOT consult
-- x-wallet-address: verify-rls.mjs showed a forged header returning exactly the
-- same 38 specimen rows as a real JWT, so a header is a claim, not a credential.
CREATE OR REPLACE FUNCTION current_wallet()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT lower(nullif(auth.jwt() ->> 'wallet_address', ''));
$$;

COMMENT ON FUNCTION current_wallet() IS
  'The authenticated wallet from the minted Supabase JWT, lowercased. JWT only — the x-wallet-address header is client-supplied and forgeable.';

-- ── 3. messages — private conversations ────────────────────────────────────
--
-- The most serious finding: all six policies were unconditionally true, so every
-- direct message in the product was readable and writable by anyone.
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants read their messages" ON messages;
CREATE POLICY "Participants read their messages" ON messages
  FOR SELECT USING (
    current_wallet() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id = messages.conversation_id
         AND current_wallet() IN (lower(c.participant_a), lower(c.participant_b))
    )
  );

-- Send as yourself, and only into a conversation you are part of. Both halves
-- matter: membership alone would let either party forge the other's authorship.
DROP POLICY IF EXISTS "Participants send as themselves" ON messages;
CREATE POLICY "Participants send as themselves" ON messages
  FOR INSERT WITH CHECK (
    lower(sender_wallet) = current_wallet()
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id = conversation_id
         AND current_wallet() IN (lower(c.participant_a), lower(c.participant_b))
    )
  );

-- Updates exist to mark messages read, which is the RECIPIENT's action.
DROP POLICY IF EXISTS "Participants update their messages" ON messages;
CREATE POLICY "Participants update their messages" ON messages
  FOR UPDATE USING (
    current_wallet() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id = messages.conversation_id
         AND current_wallet() IN (lower(c.participant_a), lower(c.participant_b))
    )
  );

-- ── 4. conversations ───────────────────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants read their conversations" ON conversations;
CREATE POLICY "Participants read their conversations" ON conversations
  FOR SELECT USING (
    current_wallet() IN (lower(participant_a), lower(participant_b))
  );

DROP POLICY IF EXISTS "Users open conversations they are in" ON conversations;
CREATE POLICY "Users open conversations they are in" ON conversations
  FOR INSERT WITH CHECK (
    current_wallet() IN (lower(participant_a), lower(participant_b))
  );

DROP POLICY IF EXISTS "Participants update their conversations" ON conversations;
CREATE POLICY "Participants update their conversations" ON conversations
  FOR UPDATE USING (
    current_wallet() IN (lower(participant_a), lower(participant_b))
  );

-- ── 5. tides — public to browse, host-only to change ───────────────────────
--
-- Public SELECT is kept on purpose: the events calendar is a discovery surface
-- and works for logged-out visitors. The hole was that ANYONE could edit or
-- cancel someone else's event.
ALTER TABLE tides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can browse tides" ON tides;
CREATE POLICY "Anyone can browse tides" ON tides FOR SELECT USING (true);

DROP POLICY IF EXISTS "Hosts create their own tides" ON tides;
CREATE POLICY "Hosts create their own tides" ON tides
  FOR INSERT WITH CHECK (lower(host_wallet) = current_wallet());

DROP POLICY IF EXISTS "Only the host edits a tide" ON tides;
CREATE POLICY "Only the host edits a tide" ON tides
  FOR UPDATE USING (lower(host_wallet) = current_wallet());

DROP POLICY IF EXISTS "Only the host deletes a tide" ON tides;
CREATE POLICY "Only the host deletes a tide" ON tides
  FOR DELETE USING (lower(host_wallet) = current_wallet());

-- ── 6. tide_attendees — RSVP lists ─────────────────────────────────────────
--
-- Attendee lists stay readable to signed-in users (the tide page shows who is
-- coming), but not to the anonymous internet: for an Expo these rows pair a real
-- physical location and time with a list of people who will be there.
ALTER TABLE tide_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users read attendees" ON tide_attendees;
CREATE POLICY "Signed-in users read attendees" ON tide_attendees
  FOR SELECT USING (current_wallet() IS NOT NULL);

DROP POLICY IF EXISTS "Members RSVP as themselves" ON tide_attendees;
CREATE POLICY "Members RSVP as themselves" ON tide_attendees
  FOR INSERT WITH CHECK (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Attendees update their own RSVP" ON tide_attendees;
CREATE POLICY "Attendees update their own RSVP" ON tide_attendees
  FOR UPDATE USING (lower(wallet_address) = current_wallet());

DROP POLICY IF EXISTS "Attendees cancel their own RSVP" ON tide_attendees;
CREATE POLICY "Attendees cancel their own RSVP" ON tide_attendees
  FOR DELETE USING (lower(wallet_address) = current_wallet());

-- ── 7. tide_chat — attendees only ──────────────────────────────────────────
ALTER TABLE tide_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Attendees read tide chat" ON tide_chat;
CREATE POLICY "Attendees read tide chat" ON tide_chat
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tide_attendees a
       WHERE a.tide_id = tide_chat.tide_id
         AND lower(a.wallet_address) = current_wallet()
    )
    -- The host can always read their own event's chat, RSVP or not.
    OR EXISTS (
      SELECT 1 FROM tides t
       WHERE t.id = tide_chat.tide_id AND lower(t.host_wallet) = current_wallet()
    )
  );

DROP POLICY IF EXISTS "Attendees post to tide chat" ON tide_chat;
CREATE POLICY "Attendees post to tide chat" ON tide_chat
  FOR INSERT WITH CHECK (
    lower(author_wallet) = current_wallet()
    AND (
      EXISTS (
        SELECT 1 FROM tide_attendees a
         WHERE a.tide_id = tide_id AND lower(a.wallet_address) = current_wallet()
      )
      OR EXISTS (
        SELECT 1 FROM tides t WHERE t.id = tide_id AND lower(t.host_wallet) = current_wallet()
      )
    )
  );

-- The host moderates their own event's chat.
DROP POLICY IF EXISTS "Hosts moderate tide chat" ON tide_chat;
CREATE POLICY "Hosts moderate tide chat" ON tide_chat
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM tides t
       WHERE t.id = tide_chat.tide_id AND lower(t.host_wallet) = current_wallet()
    )
  );

-- ── 8. species_insights — public library, own edits ────────────────────────
ALTER TABLE species_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads insights" ON species_insights;
CREATE POLICY "Anyone reads insights" ON species_insights FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authors publish their own insights" ON species_insights;
CREATE POLICY "Authors publish their own insights" ON species_insights
  FOR INSERT WITH CHECK (lower(author_wallet) = current_wallet());

DROP POLICY IF EXISTS "Authors edit their own insights" ON species_insights;
CREATE POLICY "Authors edit their own insights" ON species_insights
  FOR UPDATE USING (lower(author_wallet) = current_wallet());

-- ── 9. school_invites — invitee and school leadership ──────────────────────
ALTER TABLE school_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Invitee and leaders read invites" ON school_invites;
CREATE POLICY "Invitee and leaders read invites" ON school_invites
  FOR SELECT USING (
    lower(invited_wallet) = current_wallet()
    OR lower(invited_by) = current_wallet()
    OR is_school_admin(school_id)
  );

DROP POLICY IF EXISTS "Members invite others" ON school_invites;
CREATE POLICY "Members invite others" ON school_invites
  FOR INSERT WITH CHECK (
    lower(invited_by) = current_wallet() AND is_school_member(school_id)
  );

-- The invitee accepts or declines; leadership can revoke.
DROP POLICY IF EXISTS "Invitee responds to invite" ON school_invites;
CREATE POLICY "Invitee responds to invite" ON school_invites
  FOR UPDATE USING (
    lower(invited_wallet) = current_wallet() OR is_school_admin(school_id)
  );

DROP POLICY IF EXISTS "Inviter or leaders cancel invites" ON school_invites;
CREATE POLICY "Inviter or leaders cancel invites" ON school_invites
  FOR DELETE USING (
    lower(invited_by) = current_wallet() OR is_school_admin(school_id)
  );

-- ── 10. morph_submissions — submitter reads own, reviewers read all ────────
ALTER TABLE morph_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submitters read their own submissions" ON morph_submissions;
CREATE POLICY "Submitters read their own submissions" ON morph_submissions
  FOR SELECT USING (
    lower(submitter_wallet) = current_wallet()
    OR lower(coalesce(reviewer_wallet, '')) = current_wallet()
    -- Approved morphs are public reference data.
    OR status = 'approved'
  );

DROP POLICY IF EXISTS "Submit morphs as yourself" ON morph_submissions;
CREATE POLICY "Submit morphs as yourself" ON morph_submissions
  FOR INSERT WITH CHECK (lower(submitter_wallet) = current_wallet());

DROP POLICY IF EXISTS "Submitters edit their pending submissions" ON morph_submissions;
CREATE POLICY "Submitters edit their pending submissions" ON morph_submissions
  FOR UPDATE USING (
    lower(submitter_wallet) = current_wallet() AND status = 'pending'
  );
