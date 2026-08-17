-- ═══════════════════════════════════════════════════════════════════════════
-- School challenges: the entire lifecycle after "create"
--
-- What shipped: createChallenge() wrote a row, and that was the end of it.
-- `status` was set once at insert and never changed, `updateChallenge()` existed
-- but no caller ever invoked it, and `leaderboard` was an empty jsonb column
-- nothing wrote. There was no join, no submission, no scoring, no voting and no
-- reward. ChallengesTab filters on status === 'completed', so that tab was
-- permanently empty by construction.
--
-- 0 challenges exist in production, so this is a clean slate.
--
-- ── HOW EACH TYPE IS SCORED, AND WHY ─────────────────────────────────────────
--
-- The four types the UI offers do NOT all admit the same scoring, so this does
-- not pretend otherwise. What the database can actually prove:
--
--   breeding_sprint  AUTO from aquadex_spawns. owner_address, species_id and
--                    event_timestamp are all recorded, so "who bred the most of
--                    the target species during the window" is a straight count.
--
--   care_streak      AUTO from aquadex_action_logs (291 rows in production, real
--                    Feed / Water Change / ParameterLog events). The score is the
--                    longest run of consecutive days containing a care action.
--
--   photo_contest    SUBMISSION + MEMBER VOTE. No stored data can rank "best tank
--                    photo". Pretending to auto-score this would just be picking
--                    an arbitrary winner.
--
--   growout_race     SUBMISSION. "Grow fry to a target size fastest" depends on a
--                    size nothing in the schema records. The entrant declares the
--                    figure with a photo and the host confirms it, which is honest
--                    about being human-judged rather than dressing it up.
--
-- ── STATUS IS DERIVED, NOT STORED ────────────────────────────────────────────
--
-- Deliberately NOT adding a cron to flip status on a schedule. Tides already
-- demonstrates that failure: nothing reconciles tides.status against end_time, so
-- a tide can sit LIVE forever after it has finished. A stored status that nothing
-- advances is a lie waiting to happen.
--
-- Instead the phase is a pure function of (cancelled_at, start_time, end_time,
-- finalized_at) and is computed on read — always correct, no scheduler. The only
-- state transitions actually persisted are the two a human causes: cancelling and
-- finalizing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Lifecycle columns ──────────────────────────────────────────────────────
ALTER TABLE school_challenges
  ADD COLUMN IF NOT EXISTS finalized_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by  TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

ALTER TABLE school_challenges DROP CONSTRAINT IF EXISTS school_challenges_window_ordered;
ALTER TABLE school_challenges ADD CONSTRAINT school_challenges_window_ordered
  CHECK (end_time > start_time);

ALTER TABLE school_challenges DROP CONSTRAINT IF EXISTS school_challenges_finalize_coherent;
ALTER TABLE school_challenges ADD CONSTRAINT school_challenges_finalize_coherent
  CHECK ((finalized_at IS NULL) = (finalized_by IS NULL));

-- ── Participants ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_challenge_participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id   UUID NOT NULL REFERENCES school_challenges(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Written by finalize_school_challenge(). NULL until then.
  score          NUMERIC,
  rank           INTEGER,
  scored_at      TIMESTAMPTZ,

  -- Reward XP is applied on the client, so the claim has to be atomic here or a
  -- refresh pays out again. Same pattern as tide_attendees.xp_awarded.
  xp_claimed_at  TIMESTAMPTZ,

  CONSTRAINT scp_one_entry_per_member UNIQUE (challenge_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_scp_challenge_rank
  ON school_challenge_participants (challenge_id, rank NULLS LAST);

-- ── Submissions (photo_contest, growout_race) ──────────────────────────────
CREATE TABLE IF NOT EXISTS school_challenge_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id   UUID NOT NULL REFERENCES school_challenges(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,

  body           TEXT,
  image_url      TEXT,
  -- growout_race: the declared figure (e.g. fry length in mm, or count).
  declared_value NUMERIC,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at      TIMESTAMPTZ,
  is_deleted     BOOLEAN NOT NULL DEFAULT false,

  -- One entry each. Without this a photo contest becomes "whoever uploads the
  -- most photos", which is not the contest.
  CONSTRAINT scs_one_entry_per_member UNIQUE (challenge_id, wallet_address),
  -- An entry has to actually contain something.
  CONSTRAINT scs_has_content CHECK (
    coalesce(btrim(body), '') <> '' OR image_url IS NOT NULL OR declared_value IS NOT NULL
  ),
  CONSTRAINT scs_declared_value_sane CHECK (declared_value IS NULL OR declared_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_scs_challenge
  ON school_challenge_submissions (challenge_id, created_at DESC)
  WHERE is_deleted = false;

-- ── Votes (photo_contest) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_challenge_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  UUID NOT NULL REFERENCES school_challenges(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES school_challenge_submissions(id) ON DELETE CASCADE,
  voter_wallet  TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One vote per member per challenge. This is the whole integrity of a vote.
  CONSTRAINT scv_one_vote_per_member UNIQUE (challenge_id, voter_wallet)
);

CREATE INDEX IF NOT EXISTS idx_scv_submission ON school_challenge_votes (submission_id);

-- ── The derived phase ──────────────────────────────────────────────────────
-- Mirrored by resolveChallengePhase() in frontend/src/utils/challenges.js. Keep
-- the two in step; the client uses it for rendering, this one guards writes.
CREATE OR REPLACE FUNCTION school_challenge_phase(c school_challenges)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN c.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN c.finalized_at IS NOT NULL THEN 'completed'
    WHEN now() < c.start_time       THEN 'upcoming'
    WHEN now() <= c.end_time        THEN 'active'
    ELSE 'scoring'   -- over, awaiting the host finalizing results
  END;
$$;

-- ── Write guards ───────────────────────────────────────────────────────────
--
-- These are triggers rather than client checks because they are the rules that
-- decide who wins something. A vote for your own photo, or an entry slipped in
-- after the deadline, has to be impossible rather than discouraged.

CREATE OR REPLACE FUNCTION enforce_challenge_participation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ch school_challenges; phase TEXT;
BEGIN
  SELECT * INTO ch FROM school_challenges WHERE id = NEW.challenge_id;
  IF ch.id IS NULL THEN
    RAISE EXCEPTION 'Challenge does not exist.';
  END IF;

  phase := school_challenge_phase(ch);

  IF phase = 'cancelled' THEN
    RAISE EXCEPTION 'This challenge was cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  IF phase = 'completed' THEN
    RAISE EXCEPTION 'This challenge is already finished.' USING ERRCODE = 'check_violation';
  END IF;

  -- Joining is only meaningful before the window closes; you cannot enter a
  -- contest that has already finished and expect to be scored for it.
  IF TG_TABLE_NAME = 'school_challenge_participants' AND phase = 'scoring' THEN
    RAISE EXCEPTION 'Entries closed when the challenge ended.' USING ERRCODE = 'check_violation';
  END IF;

  -- Submissions must land inside the window too.
  IF TG_TABLE_NAME = 'school_challenge_submissions' AND phase <> 'active' THEN
    RAISE EXCEPTION 'Submissions are only open while the challenge is running.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scp_window ON school_challenge_participants;
CREATE TRIGGER trg_scp_window BEFORE INSERT ON school_challenge_participants
  FOR EACH ROW EXECUTE FUNCTION enforce_challenge_participation();

DROP TRIGGER IF EXISTS trg_scs_window ON school_challenge_submissions;
CREATE TRIGGER trg_scs_window BEFORE INSERT ON school_challenge_submissions
  FOR EACH ROW EXECUTE FUNCTION enforce_challenge_participation();

CREATE OR REPLACE FUNCTION enforce_challenge_vote()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ch school_challenges; sub school_challenge_submissions;
BEGIN
  SELECT * INTO ch  FROM school_challenges            WHERE id = NEW.challenge_id;
  SELECT * INTO sub FROM school_challenge_submissions WHERE id = NEW.submission_id;

  IF ch.id IS NULL OR sub.id IS NULL THEN
    RAISE EXCEPTION 'Cannot vote: challenge or entry does not exist.';
  END IF;

  -- The vote must belong to the same challenge as the entry, or you could vote
  -- once per challenge while pointing every vote at one popular photo elsewhere.
  IF sub.challenge_id <> NEW.challenge_id THEN
    RAISE EXCEPTION 'That entry belongs to a different challenge.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF sub.is_deleted THEN
    RAISE EXCEPTION 'That entry was withdrawn.' USING ERRCODE = 'check_violation';
  END IF;

  -- No voting for yourself.
  IF lower(sub.wallet_address) = lower(NEW.voter_wallet) THEN
    RAISE EXCEPTION 'You cannot vote for your own entry.' USING ERRCODE = 'check_violation';
  END IF;

  -- Voting is open once the contest is running and closes when results are locked.
  IF school_challenge_phase(ch) NOT IN ('active', 'scoring') THEN
    RAISE EXCEPTION 'Voting is closed for this challenge.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scv_rules ON school_challenge_votes;
CREATE TRIGGER trg_scv_rules BEFORE INSERT ON school_challenge_votes
  FOR EACH ROW EXECUTE FUNCTION enforce_challenge_vote();

-- ── Scoring ────────────────────────────────────────────────────────────────
--
-- One function, run by the host when the window closes. Writes each
-- participant's score and rank, mirrors the result into leaderboard jsonb (which
-- ChallengeCard already reads), and stamps finalized_at.
--
-- Idempotent: finalizing an already-finalized challenge is refused rather than
-- silently rescoring, because rank changes after the fact would invalidate an XP
-- reward someone has already claimed.
CREATE OR REPLACE FUNCTION finalize_school_challenge(target_challenge UUID, actor_wallet TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ch      school_challenges;
  is_lead BOOLEAN;
  board   jsonb;
BEGIN
  SELECT * INTO ch FROM school_challenges WHERE id = target_challenge;
  IF ch.id IS NULL THEN
    RAISE EXCEPTION 'Challenge does not exist.';
  END IF;

  IF ch.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'This challenge has already been finalized.' USING ERRCODE = 'check_violation';
  END IF;
  IF ch.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This challenge was cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  IF now() <= ch.end_time THEN
    RAISE EXCEPTION 'The challenge is still running — it ends %.', ch.end_time
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only an elder or founder of the owning school may lock in results.
  SELECT EXISTS (
    SELECT 1 FROM school_members m
     WHERE m.school_id = ch.school_id
       AND m.role IN ('founder', 'elder')
       AND lower(m.wallet_address) = lower(actor_wallet)
  ) INTO is_lead;

  IF NOT is_lead THEN
    RAISE EXCEPTION 'Only a founder or elder can finalize a challenge.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Score every participant according to the type ───────────────────────
  IF ch.challenge_type = 'breeding_sprint' THEN
    -- Spawns of the target species recorded inside the window. An empty
    -- target_species means any species counts.
    UPDATE school_challenge_participants p
       SET score = (
             SELECT count(*)
               FROM aquadex_spawns s
              WHERE lower(s.owner_address) = lower(p.wallet_address)
                AND s.event_timestamp >= ch.start_time
                AND s.event_timestamp <= ch.end_time
                AND (
                  ch.target_species IS NULL
                  OR jsonb_array_length(ch.target_species) = 0
                  OR EXISTS (
                       SELECT 1 FROM jsonb_array_elements_text(ch.target_species) AS ts
                        WHERE lower(coalesce(s.scientific_name, '')) = lower(ts)
                           OR lower(coalesce(s.common_name, ''))     = lower(ts)
                     )
                )
           ),
           scored_at = now()
     WHERE p.challenge_id = target_challenge;

  ELSIF ch.challenge_type = 'care_streak' THEN
    -- Longest run of consecutive days containing at least one care action.
    -- The classic gaps-and-islands shape: subtracting a dense row_number from the
    -- day turns each unbroken run into a constant, so runs can be grouped.
    -- aquadex_action_logs.timestamp is an epoch BIGINT; values above 1e11 are
    -- milliseconds, which is what the client writes.
    UPDATE school_challenge_participants p
       SET score = coalesce((
             SELECT max(run_length) FROM (
               SELECT count(*) AS run_length
                 FROM (
                   SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp
                     FROM (
                       SELECT DISTINCT
                         (to_timestamp(CASE WHEN l.timestamp > 100000000000
                                            THEN l.timestamp / 1000.0
                                            ELSE l.timestamp END) AT TIME ZONE 'UTC')::date AS d
                         FROM aquadex_action_logs l
                        WHERE lower(l.owner_address) = lower(p.wallet_address)
                          AND to_timestamp(CASE WHEN l.timestamp > 100000000000
                                                THEN l.timestamp / 1000.0
                                                ELSE l.timestamp END)
                              BETWEEN ch.start_time AND ch.end_time
                     ) days
                 ) grouped
                GROUP BY grp
             ) runs
           ), 0),
           scored_at = now()
     WHERE p.challenge_id = target_challenge;

  ELSIF ch.challenge_type = 'photo_contest' THEN
    -- Votes received on that member's entry.
    UPDATE school_challenge_participants p
       SET score = (
             SELECT count(v.id)
               FROM school_challenge_submissions s
               LEFT JOIN school_challenge_votes v ON v.submission_id = s.id
              WHERE s.challenge_id = target_challenge
                AND s.is_deleted = false
                AND lower(s.wallet_address) = lower(p.wallet_address)
           ),
           scored_at = now()
     WHERE p.challenge_id = target_challenge;

  ELSE
    -- growout_race and anything added later: the declared figure from the entry.
    UPDATE school_challenge_participants p
       SET score = coalesce((
             SELECT max(s.declared_value)
               FROM school_challenge_submissions s
              WHERE s.challenge_id = target_challenge
                AND s.is_deleted = false
                AND lower(s.wallet_address) = lower(p.wallet_address)
           ), 0),
           scored_at = now()
     WHERE p.challenge_id = target_challenge;
  END IF;

  -- ── Rank ────────────────────────────────────────────────────────────────
  -- rank(), not row_number(): equal scores must tie rather than being separated
  -- by an arbitrary tiebreak. Earlier join breaks display order only.
  WITH ranked AS (
    SELECT id, rank() OVER (ORDER BY coalesce(score, 0) DESC, joined_at ASC) AS r
      FROM school_challenge_participants
     WHERE challenge_id = target_challenge
  )
  UPDATE school_challenge_participants p
     SET rank = ranked.r
    FROM ranked
   WHERE p.id = ranked.id;

  -- ── Mirror into the leaderboard column ChallengeCard already reads ──────
  SELECT coalesce(jsonb_agg(entry ORDER BY (entry->>'rank')::int), '[]'::jsonb)
    INTO board
    FROM (
      SELECT jsonb_build_object(
               'wallet_address', p.wallet_address,
               'display_name',   pr.display_name,
               'avatar_url',     pr.avatar_url,
               'score',          coalesce(p.score, 0),
               'rank',           p.rank
             ) AS entry
        FROM school_challenge_participants p
        LEFT JOIN profiles pr ON pr.wallet_address = p.wallet_address
       WHERE p.challenge_id = target_challenge
    ) rows;

  UPDATE school_challenges
     SET leaderboard  = board,
         finalized_at = now(),
         finalized_by = actor_wallet,
         status       = 'completed'
   WHERE id = target_challenge;

  RETURN board;
END;
$$;

COMMENT ON FUNCTION finalize_school_challenge(UUID, TEXT) IS
  'Scores and closes a school challenge. Auto-scores breeding_sprint from aquadex_spawns and care_streak from aquadex_action_logs; photo_contest counts votes; everything else uses the declared submission value. Elder/founder only, refuses to run twice, and ties share a rank.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Strict only. No dev_* USING(true) bypass — see 20260817150000_school_posts.sql.
ALTER TABLE school_challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_challenge_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_challenge_votes        ENABLE ROW LEVEL SECURITY;

-- The school a challenge belongs to.
CREATE OR REPLACE FUNCTION challenge_school(target_challenge UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM school_challenges WHERE id = target_challenge;
$$;

DROP POLICY IF EXISTS "Members read participants" ON school_challenge_participants;
CREATE POLICY "Members read participants" ON school_challenge_participants
  FOR SELECT USING (is_school_member(challenge_school(challenge_id)));

DROP POLICY IF EXISTS "Members join as themselves" ON school_challenge_participants;
CREATE POLICY "Members join as themselves" ON school_challenge_participants
  FOR INSERT WITH CHECK (
    is_school_member(challenge_school(challenge_id))
    AND lower(wallet_address) = lower(
          (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
        )
  );

DROP POLICY IF EXISTS "Members withdraw themselves" ON school_challenge_participants;
CREATE POLICY "Members withdraw themselves" ON school_challenge_participants
  FOR DELETE USING (
    lower(wallet_address) = lower(
      (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
    )
  );

DROP POLICY IF EXISTS "Members read submissions" ON school_challenge_submissions;
CREATE POLICY "Members read submissions" ON school_challenge_submissions
  FOR SELECT USING (is_school_member(challenge_school(challenge_id)));

DROP POLICY IF EXISTS "Members submit as themselves" ON school_challenge_submissions;
CREATE POLICY "Members submit as themselves" ON school_challenge_submissions
  FOR INSERT WITH CHECK (
    is_school_member(challenge_school(challenge_id))
    AND lower(wallet_address) = lower(
          (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
        )
  );

DROP POLICY IF EXISTS "Authors and admins update submissions" ON school_challenge_submissions;
CREATE POLICY "Authors and admins update submissions" ON school_challenge_submissions
  FOR UPDATE USING (
    is_school_admin(challenge_school(challenge_id))
    OR lower(wallet_address) = lower(
         (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
       )
  );

DROP POLICY IF EXISTS "Members read votes" ON school_challenge_votes;
CREATE POLICY "Members read votes" ON school_challenge_votes
  FOR SELECT USING (is_school_member(challenge_school(challenge_id)));

DROP POLICY IF EXISTS "Members vote as themselves" ON school_challenge_votes;
CREATE POLICY "Members vote as themselves" ON school_challenge_votes
  FOR INSERT WITH CHECK (
    is_school_member(challenge_school(challenge_id))
    AND lower(voter_wallet) = lower(
          (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
        )
  );

DROP POLICY IF EXISTS "Members retract own vote" ON school_challenge_votes;
CREATE POLICY "Members retract own vote" ON school_challenge_votes
  FOR DELETE USING (
    lower(voter_wallet) = lower(
      (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
    )
  );
