-- ═══════════════════════════════════════════════════════════════════════════
-- Wire up the AI edge functions that nothing called
--
-- content-moderation and tide-narration were deployed (and, since e6cb8b7,
-- work on Vertex and accept only service-role callers), but no trigger, cron
-- job or app code ever called them. This connects them.
--
-- 1. content-moderation runs on every new Reef post and comment, through
--    pg_net so a slow model never delays the insert. It FLAGS for the curator
--    queue, and only hides on its own when the model is highly confident.
-- 2. A curator dismissing an auto flag now un-hides what the auto check hid.
--    Without this a wrongly hidden post stayed hidden after "Dismiss".
-- 3. tide-narration posts a short update into each live tide's chat every
--    15 minutes, but only when something happened in those 15 minutes.
--
-- Recaps for tides that end on their own are built by tide-lifecycle.
--
-- Every call goes through the same Vault secrets the existing cron jobs use
-- (20260709100000_fix_pg_net_vault_settings.sql). A failure to queue the call
-- is a WARNING, never an error: moderation must not be able to block a post.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Moderation flags remember whether the auto check hid the content ────
ALTER TABLE public.moderation_flags ADD COLUMN IF NOT EXISTS auto_hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.moderation_flags.auto_hidden IS
  'True when content-moderation hid the content itself (high confidence). Dismissing such a flag un-hides it.';

-- ── 2. New posts and comments go to content-moderation ─────────────────────
CREATE OR REPLACE FUNCTION public.queue_content_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url  TEXT;
  v_key  TEXT;
  v_type TEXT;
  v_text TEXT;
  v_media JSONB := '[]'::jsonb;
BEGIN
  IF TG_TABLE_NAME = 'currents' THEN
    v_type  := 'current';
    v_text  := concat_ws(E'\n', NEW.title, NEW.body);
    v_media := CASE WHEN jsonb_typeof(NEW.media_urls) = 'array' THEN NEW.media_urls ELSE '[]'::jsonb END;
  ELSE
    v_type := 'comment';
    v_text := NEW.body;
  END IF;

  -- Nothing to look at.
  IF coalesce(length(trim(v_text)), 0) = 0 AND jsonb_array_length(v_media) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/content-moderation',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object(
          'type', v_type,
          'id', NEW.id,
          'text', left(coalesce(v_text, ''), 4000),
          'image_urls', v_media,
          'author_wallet', NEW.author_wallet
        ),
        timeout_milliseconds := 30000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'queue_content_moderation: could not queue % %: %', v_type, NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_content_moderation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_moderate_new_current ON public.currents;
CREATE TRIGGER trg_moderate_new_current
  AFTER INSERT ON public.currents
  FOR EACH ROW EXECUTE FUNCTION public.queue_content_moderation();

DROP TRIGGER IF EXISTS trg_moderate_new_comment ON public.comments;
CREATE TRIGGER trg_moderate_new_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.queue_content_moderation();

-- ── 3. Dismissing an auto flag un-hides what the auto check hid ────────────
-- Same function as 20260818120000_reef_trust_authority.sql, with one change in
-- the 'dismiss' branch. It only un-hides when no other flag on the same
-- content was actioned with 'hide', so a curator's own decision stands.
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

  IF p_action = 'dismiss' THEN
    IF flag_row.auto_hidden AND flag_row.target_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM moderation_flags other
       WHERE other.id <> flag_row.id
         AND other.target_type = flag_row.target_type
         AND other.target_id = flag_row.target_id
         AND other.action_taken = 'hide'
    ) THEN
      IF flag_row.target_type = 'current' THEN
        UPDATE currents SET is_hidden = false WHERE id = flag_row.target_id;
      ELSIF flag_row.target_type = 'comment' THEN
        UPDATE comments SET is_hidden = false WHERE id = flag_row.target_id;
      END IF;
    END IF;
  ELSIF p_action = 'hide' THEN
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

-- ── 4. Live tide narration every 15 minutes, only when something happened ──
DO $$
DECLARE
  jid INT;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'tide-narration' LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'tide-narration',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/tide-narration',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object('tide_id', t.id, 'mode', 'narrate')
  )
  FROM tides t
  WHERE t.status = 'live'
    AND (
      EXISTS (SELECT 1 FROM tide_chat c
               WHERE c.tide_id = t.id AND NOT c.is_system_message
                 AND c.created_at > now() - interval '15 minutes')
      OR EXISTS (SELECT 1 FROM tide_attendees a
                  WHERE a.tide_id = t.id AND a.checked_in_at > now() - interval '15 minutes')
    )
  $$
);
