-- ═══════════════════════════════════════════════════════════════════════════
-- school_posts — schools get their own feed
--
-- The Feed tab was a placeholder reading "School feed coming soon", and it was
-- also the DEFAULT tab, so opening any school landed on an empty state. The
-- placeholder promised "member Currents tagged to tracked species will appear
-- here", but schools are getting their own posts instead: a Current belongs to a
-- keeper's tank, and a school post belongs to the school. Reusing Currents would
-- have meant a feed nobody could post to deliberately.
--
-- POSTS ARE NOT CHAT. school_chat already exists and covers conversation —
-- fast, ephemeral, ordered by recency. Posts are the durable layer: announcements,
-- spawn reports, questions worth keeping. That's why posts get pinning and
-- reactions and chat doesn't, and why a post has an edited_at.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS school_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  author_wallet TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,

  body          TEXT NOT NULL,
  image_url     TEXT,

  -- Elders and founders can pin a post to the top of the feed. Nullable
  -- timestamp rather than a boolean so ties break deterministically and you can
  -- see WHEN it was pinned.
  pinned_at     TIMESTAMPTZ,
  pinned_by     TEXT REFERENCES profiles(wallet_address) ON DELETE SET NULL,

  -- Soft delete, matching school_chat.is_deleted. Moderation should be reversible
  -- and auditable; a hard DELETE loses the evidence of what was removed.
  is_deleted    BOOLEAN NOT NULL DEFAULT false,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ,

  -- An empty post is not a post. Length cap keeps the feed readable and matches
  -- the composer's maxLength.
  CONSTRAINT school_posts_body_present CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  -- pinned_by and pinned_at travel together or not at all.
  CONSTRAINT school_posts_pin_coherent CHECK ((pinned_at IS NULL) = (pinned_by IS NULL))
);

-- The feed's actual query: this school, not deleted, pinned first then newest.
CREATE INDEX IF NOT EXISTS idx_school_posts_feed
  ON school_posts (school_id, pinned_at DESC NULLS LAST, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_school_posts_author
  ON school_posts (author_wallet, created_at DESC);

-- ── Reactions ──────────────────────────────────────────────────────────────
-- One reaction per member per post. The UNIQUE constraint is the whole point:
-- without it "like" becomes a counter anyone can inflate by clicking repeatedly.
CREATE TABLE IF NOT EXISTS school_post_reactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID NOT NULL REFERENCES school_posts(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  emoji          TEXT NOT NULL DEFAULT '🌊',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT school_post_reactions_one_per_member UNIQUE (post_id, wallet_address),
  -- Keep it to a known set so the column can't become a free-text field.
  CONSTRAINT school_post_reactions_emoji_known
    CHECK (emoji IN ('🌊', '🐟', '🔥', '👏', '🧬', '❤️'))
);

CREATE INDEX IF NOT EXISTS idx_school_post_reactions_post
  ON school_post_reactions (post_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Deliberately NO `dev_*` USING(true) bypass policy on these two tables.
--
-- 17 existing tables carry one (43 policies), and because RLS policies for the
-- same command are OR'd together, a single USING(true) defeats every strict
-- policy beside it. They date from before /api/mint-session existed; the client
-- now attaches a real Supabase-compatible JWT carrying wallet_address, so the
-- strict form below is enforceable. The anon key ships inside the browser bundle,
-- so a USING(true) policy is world-writable in practice.
ALTER TABLE school_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_post_reactions ENABLE ROW LEVEL SECURITY;

-- Helper: is the caller a member of this school?
CREATE OR REPLACE FUNCTION is_school_member(target_school UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM school_members m
     WHERE m.school_id = target_school
       AND lower(m.wallet_address) = lower(
             (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
           )
  );
$$;

-- Helper: is the caller an elder or founder of this school?
CREATE OR REPLACE FUNCTION is_school_admin(target_school UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM school_members m
     WHERE m.school_id = target_school
       AND m.role IN ('founder', 'elder')
       AND lower(m.wallet_address) = lower(
             (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
           )
  );
$$;

-- Read: members see their school's feed. Deleted posts are filtered by the
-- client query, not hidden here, so moderators can still audit them.
DROP POLICY IF EXISTS "School members read posts" ON school_posts;
CREATE POLICY "School members read posts" ON school_posts
  FOR SELECT USING (is_school_member(school_id));

-- Write: members post as themselves. Both halves matter — membership alone would
-- let a member forge another member's authorship.
DROP POLICY IF EXISTS "School members write posts" ON school_posts;
CREATE POLICY "School members write posts" ON school_posts
  FOR INSERT WITH CHECK (
    is_school_member(school_id)
    AND lower(author_wallet) = lower(
          (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
        )
  );

-- Edit / soft-delete / pin: the author, or an elder/founder moderating.
DROP POLICY IF EXISTS "Authors and admins update posts" ON school_posts;
CREATE POLICY "Authors and admins update posts" ON school_posts
  FOR UPDATE USING (
    is_school_admin(school_id)
    OR lower(author_wallet) = lower(
         (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
       )
  );

-- Reactions: members react as themselves, and can remove their own.
DROP POLICY IF EXISTS "School members read reactions" ON school_post_reactions;
CREATE POLICY "School members read reactions" ON school_post_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM school_posts p
             WHERE p.id = post_id AND is_school_member(p.school_id))
  );

DROP POLICY IF EXISTS "School members add own reaction" ON school_post_reactions;
CREATE POLICY "School members add own reaction" ON school_post_reactions
  FOR INSERT WITH CHECK (
    lower(wallet_address) = lower(
      (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
    )
    AND EXISTS (SELECT 1 FROM school_posts p
                 WHERE p.id = post_id AND is_school_member(p.school_id))
  );

DROP POLICY IF EXISTS "Members remove own reaction" ON school_post_reactions;
CREATE POLICY "Members remove own reaction" ON school_post_reactions
  FOR DELETE USING (
    lower(wallet_address) = lower(
      (current_setting('request.jwt.claims', true)::json ->> 'wallet_address')
    )
  );

COMMENT ON TABLE school_posts IS
  'Durable school feed posts. Distinct from school_chat (ephemeral conversation): posts support pinning, reactions and editing. Added 2026-08-17 to replace the "School feed coming soon" placeholder that was also the default tab.';
