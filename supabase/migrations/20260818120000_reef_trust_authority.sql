-- ============================================================================
-- Reef trust authority: separate Depth reputation, constrained mentorship,
-- and atomic moderation actions.
--
-- Browser clients may submit reports through their existing own-row INSERT
-- policy, but mentorship transitions and moderation decisions now go through
-- Privy-authenticated service endpoints. The RPCs below are service_role-only;
-- reviewer identity and keeper-role authorization are checked by the API.
-- ============================================================================

-- ── 1. Depth Score uses its original verified-contribution ladder ───────────
-- Depth awards are intentionally much smaller than XP awards. Keep this ladder
-- separate from the XP/companion ladder and repair the promotion comparison,
-- which previously selected the tier only after overwriting it.
CREATE OR REPLACE FUNCTION update_depth_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_score INTEGER;
  new_tier TEXT;
  old_score INTEGER;
  old_tier TEXT;
BEGIN
  SELECT COALESCE(depth_score, 0), COALESCE(depth_tier, 'Shallow')
    INTO old_score, old_tier
    FROM profiles
    WHERE wallet_address = NEW.wallet_address
    FOR UPDATE;

  SELECT COALESCE(SUM(delta), 0)
    INTO new_score
    FROM depth_score_events
    WHERE wallet_address = NEW.wallet_address;

  IF new_score >= 5000 THEN new_tier := 'Hadal';
  ELSIF new_score >= 1500 THEN new_tier := 'Abyssal';
  ELSIF new_score >= 500 THEN new_tier := 'Pelagic';
  ELSIF new_score >= 100 THEN new_tier := 'Coastal';
  ELSE new_tier := 'Shallow';
  END IF;

  UPDATE profiles
     SET depth_score = new_score, depth_tier = new_tier
   WHERE wallet_address = NEW.wallet_address;

  IF old_tier IS DISTINCT FROM new_tier THEN
    PERFORM dispatch_notification(
      NEW.wallet_address,
      'milestone',
      CASE WHEN new_score > old_score THEN 'Depth reputation increased' ELSE 'Depth reputation adjusted' END,
      CASE
        WHEN new_score > old_score THEN 'Verified contributions moved you to the ' || new_tier || ' Depth tier.'
        ELSE 'A confirmed moderation action adjusted your Depth tier to ' || new_tier || '.'
      END,
      '🌊',
      'profile',
      NEW.wallet_address
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger-originated ledger writes are privileged only when their source write
-- is server-authoritative. Expert Audits now use the signed Reef endpoint, and
-- moderation uses the service-only RPC below. Insight counters remain directly
-- editable by authors, so their old replayable Depth trigger is disabled until
-- voting itself has a verified server path.
DROP POLICY IF EXISTS "Auditors create audits" ON expert_audits;
DROP POLICY IF EXISTS "dev_expert_audits_insert" ON expert_audits;
DROP TRIGGER IF EXISTS trigger_depth_on_insight_vote ON species_insights;

ALTER FUNCTION depth_on_audit() SECURITY DEFINER;
ALTER FUNCTION depth_on_audit() SET search_path TO public, pg_temp;
ALTER FUNCTION depth_on_moderation() SECURITY DEFINER;
ALTER FUNCTION depth_on_moderation() SET search_path TO public, pg_temp;

-- ── 2. Mentorship is server-authoritative ───────────────────────────────────
-- 20260817180000 already removes unconditional dev_* policies. Remove the old
-- generic party policies too: they let a mentee activate their own request and
-- let either party choose any status. The service endpoint now enforces exact
-- request/accept/decline/end transitions and reuses ended rows for re-requests.
DROP POLICY IF EXISTS "Parties can read mentorships" ON mentorships;
DROP POLICY IF EXISTS "Mentees request mentorship" ON mentorships;
DROP POLICY IF EXISTS "Either party can update mentorship" ON mentorships;
DROP POLICY IF EXISTS "dev_mentorships_select" ON mentorships;
DROP POLICY IF EXISTS "dev_mentorships_insert" ON mentorships;
DROP POLICY IF EXISTS "dev_mentorships_update" ON mentorships;

CREATE OR REPLACE FUNCTION transition_mentorship(
  p_mentorship_id UUID,
  p_action TEXT,
  p_actor_wallet TEXT
)
RETURNS mentorships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pairing mentorships%ROWTYPE;
  actor_wallet TEXT := lower(p_actor_wallet);
BEGIN
  IF p_action NOT IN ('accept', 'decline', 'end') THEN
    RAISE EXCEPTION 'Unsupported mentorship transition';
  END IF;

  SELECT * INTO pairing
    FROM mentorships
    WHERE id = p_mentorship_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mentorship not found'; END IF;

  IF p_action IN ('accept', 'decline') THEN
    IF pairing.status <> 'pending' OR lower(pairing.mentor_wallet) <> actor_wallet THEN
      RAISE EXCEPTION 'Only the named mentor may resolve a pending request';
    END IF;
    IF p_action = 'accept' AND NOT EXISTS (
      SELECT 1 FROM user_roles
       WHERE lower(wallet_address) = actor_wallet
         AND active = true
         AND role IN ('founder', 'steward')
    ) THEN
      RAISE EXCEPTION 'Active founder or steward authority is required to accept';
    END IF;
    UPDATE mentorships
       SET status = CASE WHEN p_action = 'accept' THEN 'active' ELSE 'ended' END
     WHERE id = p_mentorship_id
     RETURNING * INTO pairing;
  ELSE
    IF pairing.status <> 'active'
       OR actor_wallet NOT IN (lower(pairing.mentor_wallet), lower(pairing.mentee_wallet)) THEN
      RAISE EXCEPTION 'Only an active mentorship party may end the pairing';
    END IF;
    UPDATE mentorships SET status = 'ended' WHERE id = p_mentorship_id RETURNING * INTO pairing;
  END IF;

  RETURN pairing;
END;
$$;

REVOKE ALL ON FUNCTION transition_mentorship(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION transition_mentorship(UUID, TEXT, TEXT) TO service_role;

-- ── 3. Atomic community moderation ─────────────────────────────────────────
-- Report creation also uses the signed server endpoint, which verifies that the
-- target exists and derives the reporter wallet from a fresh wallet proof.
DROP POLICY IF EXISTS "Users can report content" ON moderation_flags;

CREATE OR REPLACE FUNCTION moderate_reef_flag(
  p_flag_id UUID,
  p_action TEXT,
  p_reviewer_wallet TEXT
)
RETURNS moderation_flags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  flag_row moderation_flags%ROWTYPE;
  resolved_target_wallet TEXT;
BEGIN
  IF p_action NOT IN ('dismiss', 'hide', 'warn', 'mute_24h', 'mute_7d', 'ban') THEN
    RAISE EXCEPTION 'Unsupported moderation action';
  END IF;

  SELECT * INTO flag_row
    FROM moderation_flags
    WHERE id = p_flag_id AND status = 'pending'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending moderation flag not found';
  END IF;

  resolved_target_wallet := lower(flag_row.target_wallet);
  IF resolved_target_wallet IS NULL AND flag_row.target_id IS NOT NULL THEN
    IF flag_row.target_type = 'current' THEN
      SELECT lower(author_wallet) INTO resolved_target_wallet FROM currents WHERE id = flag_row.target_id;
    ELSIF flag_row.target_type = 'comment' THEN
      SELECT lower(author_wallet) INTO resolved_target_wallet FROM comments WHERE id = flag_row.target_id;
    ELSIF flag_row.target_type = 'insight' THEN
      SELECT lower(author_wallet) INTO resolved_target_wallet FROM species_insights WHERE id = flag_row.target_id;
    END IF;
  END IF;

  IF p_action = 'hide' THEN
    IF flag_row.target_type = 'current' AND flag_row.target_id IS NOT NULL THEN
      UPDATE currents SET is_hidden = true WHERE id = flag_row.target_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Flagged current no longer exists'; END IF;
    ELSIF flag_row.target_type = 'comment' AND flag_row.target_id IS NOT NULL THEN
      UPDATE comments SET is_hidden = true WHERE id = flag_row.target_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Flagged comment no longer exists'; END IF;
    ELSE
      RAISE EXCEPTION 'This content type cannot be hidden';
    END IF;
  ELSIF p_action = 'warn' THEN
    IF resolved_target_wallet IS NULL OR NOT EXISTS (
      SELECT 1 FROM profiles WHERE lower(wallet_address) = resolved_target_wallet
    ) THEN RAISE EXCEPTION 'Flag has no existing target user'; END IF;
    PERFORM dispatch_notification(
      resolved_target_wallet,
      'social',
      'Community moderation warning',
      'A moderator reviewed reported content on your account. Please review the community guidelines.',
      '⚠️',
      'profile',
      resolved_target_wallet
    );
  ELSIF p_action IN ('mute_24h', 'mute_7d') THEN
    IF resolved_target_wallet IS NULL THEN RAISE EXCEPTION 'Flag has no target user'; END IF;
    UPDATE profiles
       SET muted_until = now() + CASE WHEN p_action = 'mute_24h' THEN interval '24 hours' ELSE interval '7 days' END
     WHERE lower(wallet_address) = resolved_target_wallet;
    IF NOT FOUND THEN RAISE EXCEPTION 'Flagged profile no longer exists'; END IF;
  ELSIF p_action = 'ban' THEN
    IF resolved_target_wallet IS NULL THEN RAISE EXCEPTION 'Flag has no target user'; END IF;
    UPDATE profiles
       SET is_banned = true, banned_at = now()
     WHERE lower(wallet_address) = resolved_target_wallet;
    IF NOT FOUND THEN RAISE EXCEPTION 'Flagged profile no longer exists'; END IF;
  END IF;

  UPDATE moderation_flags
     SET status = CASE WHEN p_action = 'dismiss' THEN 'dismissed' ELSE 'actioned' END,
         target_wallet = COALESCE(target_wallet, resolved_target_wallet),
         reviewer_wallet = lower(p_reviewer_wallet),
         action_taken = p_action,
         reviewed_at = now()
   WHERE id = p_flag_id
   RETURNING * INTO flag_row;

  RETURN flag_row;
END;
$$;

REVOKE ALL ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) TO service_role;

-- ── 4. Atomic review-report moderation ─────────────────────────────────────
CREATE OR REPLACE FUNCTION moderate_review_report(
  p_report_id UUID,
  p_action TEXT,
  p_reviewer_wallet TEXT
)
RETURNS review_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  report_row review_reports%ROWTYPE;
BEGIN
  IF p_action NOT IN ('hide', 'dismiss') THEN
    RAISE EXCEPTION 'Unsupported review moderation action';
  END IF;

  SELECT * INTO report_row
    FROM review_reports
    WHERE id = p_report_id AND status = 'pending'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending review report not found';
  END IF;

  IF p_action = 'hide' THEN
    UPDATE marketplace_reviews SET status = 'hidden' WHERE id = report_row.review_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reported review not found'; END IF;
  END IF;

  UPDATE review_reports
     SET status = CASE WHEN p_action = 'hide' THEN 'actioned' ELSE 'dismissed' END,
         reviewer_wallet = lower(p_reviewer_wallet),
         reviewed_at = now()
   WHERE id = p_report_id
   RETURNING * INTO report_row;

  RETURN report_row;
END;
$$;

REVOKE ALL ON FUNCTION moderate_review_report(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION moderate_review_report(UUID, TEXT, TEXT) TO service_role;
