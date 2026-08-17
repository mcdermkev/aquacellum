-- ═══════════════════════════════════════════════════════════════════════════
-- Species suggestions, founder approval, and the promotion overlay
-- See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md
--
-- Replaces the per-browser Dexie queue ('AquadexCurationDB' in
-- hooks/useSuggestSpecies.js), where a suggestion existed only in the browser
-- it was typed into and the second founder could never see it.
--
-- THE INVARIANT THIS FILE EXISTS TO ENFORCE:
--
--   approved  ⟺  approve_votes >= species_required_approvals()
--                 AND at least one approve vote is from an active 'founder'
--
-- species_required_approvals() is 1 today, so one founder lands a species.
-- Setting it to 2 delivers the checks-and-balances model with no other edit:
-- a curator + a founder approves, a curator alone never can, because the
-- founder clause is independent of the count.
--
-- Enforced in a SECURITY DEFINER trigger below — never in the client and never
-- in the API layer. Same posture as 20260808_keeper_roles.sql, where user_roles
-- has no client write path at all.
--
-- WALLET CASING: profiles.wallet_address is not reliably lowercase (see
-- 20260630120000_normalize_wallet_casing.sql and services/schoolsApi.js's
-- resolveProfileWallet dance). Every predicate here compares with lower() and
-- these tables store lowercased wallets, deliberately without an FK to profiles
-- so a casing mismatch cannot silently reject a legitimate vote.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Tunables and role predicates
-- ─────────────────────────────────────────────────────────────────────────────

-- The total approve-vote count required. Change this ONE function to move from
-- "one founder decides" to "any approver plus a founder". Nothing else changes.
CREATE OR REPLACE FUNCTION species_required_approvals()
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$ SELECT 1 $$;

COMMENT ON FUNCTION species_required_approvals() IS
  'Approve votes needed to approve a species suggestion. 1 today; set to 2 to require an approver plus a founder. The founder clause in species_recompute_suggestion_status is separate and always applies.';

-- Roles that may vote at all. 'curator' is listed now so the later "unlock the
-- ability to approve" path needs no schema change — granting the role is enough.
-- Deliberately NOT tier- or XP-derived: authority is conferred, not earned
-- (the existing rule in services/entitlements.js).
CREATE OR REPLACE FUNCTION species_voting_roles()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['founder', 'curator']::TEXT[] $$;

CREATE OR REPLACE FUNCTION species_has_voting_role(p_wallet TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE lower(wallet_address) = lower(p_wallet)
      AND role = ANY (species_voting_roles())
      AND active
  );
$$;

CREATE OR REPLACE FUNCTION species_is_founder(p_wallet TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE lower(wallet_address) = lower(p_wallet)
      AND role = 'founder'
      AND active
  );
$$;

-- NOTE: there is deliberately no species_caller_wallet() helper reading
-- auth.jwt()->>'wallet_address'. Nothing in this file resolves identity from the
-- Supabase JWT, because that claim is currently spoofable (§4, spec §8). Every
-- authenticated action is verified against a Privy token in api/species.js and
-- the wallet is passed in explicitly.

-- Local spec_code allocation for species that are not in fishbase_master.json.
-- Starts above the legacy hand-assigned 7xxxx-9xxxx band already in that file.
CREATE SEQUENCE IF NOT EXISTS species_local_spec_code_seq START WITH 100000;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The shared suggestion queue
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS species_suggestions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by       TEXT NOT NULL,                 -- lowercased wallet
  scientific_name    TEXT NOT NULL,
  common_name        TEXT NOT NULL,
  care_level         SMALLINT     NOT NULL DEFAULT 1 CHECK (care_level BETWEEN 0 AND 3),
  min_temp_c         NUMERIC(4,1) NOT NULL CHECK (min_temp_c >= 0  AND min_temp_c <= 45),
  max_temp_c         NUMERIC(4,1) NOT NULL CHECK (max_temp_c >= 0  AND max_temp_c <= 45),
  min_ph             NUMERIC(3,1) NOT NULL CHECK (min_ph     >= 0  AND min_ph     <= 14),
  max_ph             NUMERIC(3,1) NOT NULL CHECK (max_ph     >= 0  AND max_ph     <= 14),
  proof_url          TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',

  -- Curation state. Driven ONLY by votes (§3 of the spec) and promotion.
  -- 'promoted' and 'rejected' are terminal and never recomputed.
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'promoted')),

  -- Advisory AI taxonomy check. Kept in its own column because the old single
  -- `curatorStatus` string conflated two independent lifecycles, which is how
  -- 'Pending Verification' ended up being filtered for but never written.
  -- NEVER gates approval.
  ai_status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (ai_status IN ('pending', 'verified', 'rejected', 'skipped')),
  ai_notes           TEXT NOT NULL DEFAULT '',

  -- Set server-side at submit time; the API function has the JSON file bundled.
  --   'onchain'   already in the live catalog -> rejected as a duplicate
  --   'json_only' in the JSON but not on-chain -> rich data exists, promote directly
  --   'none'      not in the JSON -> needs an authored species_profiles row first
  fishbase_match     TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (fishbase_match IN ('unknown', 'none', 'json_only', 'onchain')),
  spec_code          INTEGER,

  onchain_species_id INTEGER,
  promotion_tx_hash  TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ,
  promoted_at        TIMESTAMPTZ,

  CONSTRAINT species_suggestions_temp_order CHECK (min_temp_c < max_temp_c),
  CONSTRAINT species_suggestions_ph_order   CHECK (min_ph     < max_ph)
);

-- Dedupe: one live suggestion per scientific name. Rejected rows are excluded so
-- a bad first submission does not permanently poison the name.
CREATE UNIQUE INDEX IF NOT EXISTS species_suggestions_live_name_uniq
  ON species_suggestions (lower(scientific_name))
  WHERE status <> 'rejected';

CREATE INDEX IF NOT EXISTS species_suggestions_status_idx
  ON species_suggestions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS species_suggestions_submitter_idx
  ON species_suggestions (submitted_by, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Votes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS species_suggestion_votes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES species_suggestions(id) ON DELETE CASCADE,
  voter_wallet  TEXT NOT NULL,                      -- lowercased wallet
  vote          TEXT NOT NULL CHECK (vote IN ('approve', 'reject')),
  -- Snapshot of the role the vote was cast under, for the audit trail. The
  -- invariant re-checks the LIVE role rather than trusting this, so revoking a
  -- role correctly un-approves anything that depended on it.
  voter_role    TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (suggestion_id, voter_wallet)
);

CREATE INDEX IF NOT EXISTS species_suggestion_votes_suggestion_idx
  ON species_suggestion_votes (suggestion_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE INVARIANT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION species_recompute_suggestion_status(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current          TEXT;
  v_approvals        INTEGER;
  v_founder_approved BOOLEAN;
  v_founder_rejected BOOLEAN;
BEGIN
  SELECT status INTO v_current FROM species_suggestions WHERE id = p_id;
  IF v_current IS NULL THEN
    RETURN;
  END IF;

  -- Terminal states. A promoted species is already on-chain; a rejected one
  -- needs a fresh suggestion rather than a vote reversal.
  IF v_current IN ('promoted', 'rejected') THEN
    RETURN;
  END IF;

  -- Note every clause re-reads user_roles LIVE. A vote cast by someone whose
  -- founder role was later revoked stops counting as a founder vote.
  SELECT count(*) FILTER (WHERE v.vote = 'approve')
    INTO v_approvals
    FROM species_suggestion_votes v
   WHERE v.suggestion_id = p_id
     AND species_has_voting_role(v.voter_wallet);

  SELECT EXISTS (
           SELECT 1 FROM species_suggestion_votes v
            WHERE v.suggestion_id = p_id
              AND v.vote = 'approve'
              AND species_is_founder(v.voter_wallet)
         ),
         EXISTS (
           SELECT 1 FROM species_suggestion_votes v
            WHERE v.suggestion_id = p_id
              AND v.vote = 'reject'
              AND species_is_founder(v.voter_wallet)
         )
    INTO v_founder_approved, v_founder_rejected;

  -- Only a founder's reject rejects. A curator's reject withholds their approval
  -- but does not veto — otherwise the founder requirement would be one-sided,
  -- giving a non-founder more unilateral power to kill than to pass.
  IF v_founder_rejected THEN
    UPDATE species_suggestions
       SET status = 'rejected', decided_at = now()
     WHERE id = p_id;

  ELSIF v_approvals >= species_required_approvals() AND v_founder_approved THEN
    UPDATE species_suggestions
       SET status = 'approved', decided_at = now()
     WHERE id = p_id;

  ELSE
    UPDATE species_suggestions
       SET status = 'pending', decided_at = NULL
     WHERE id = p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION species_tg_votes_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM species_recompute_suggestion_status(
    COALESCE(NEW.suggestion_id, OLD.suggestion_id)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_species_votes_recompute ON species_suggestion_votes;
CREATE TRIGGER trg_species_votes_recompute
  AFTER INSERT OR UPDATE OR DELETE ON species_suggestion_votes
  FOR EACH ROW EXECUTE FUNCTION species_tg_votes_recompute();

-- Belt and braces beyond the column default: a crafted insert cannot arrive
-- pre-approved or pre-promoted, even if an RLS policy is later loosened.
CREATE OR REPLACE FUNCTION species_tg_suggestions_force_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status             := 'pending';
  NEW.onchain_species_id := NULL;
  NEW.promotion_tx_hash  := NULL;
  NEW.promoted_at        := NULL;
  NEW.decided_at         := NULL;
  NEW.submitted_by       := lower(NEW.submitted_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_species_suggestions_force_pending ON species_suggestions;
CREATE TRIGGER trg_species_suggestions_force_pending
  BEFORE INSERT ON species_suggestions
  FOR EACH ROW EXECUTE FUNCTION species_tg_suggestions_force_pending();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vote entry point
--
--    The ONLY write path into species_suggestion_votes. There is deliberately no
--    INSERT policy on that table, so a direct insert is denied by RLS and every
--    vote passes through the role check below.
--
--    WHY THIS TAKES THE WALLET AS A PARAMETER instead of reading the JWT:
--    api/mint-session.js currently mints the Supabase session with
--      (tokenWallet || bodyWallet)
--    so when a Privy token carries no wallet_address claim, a CLIENT-SUPPLIED
--    wallet is used unverified. Resolving the voter from auth.jwt() would let a
--    caller holding any valid Privy token cast a vote as a founder's wallet and
--    flip a suggestion to 'approved'. A real founder might then promote it,
--    trusting a label an attacker set.
--
--    So this is granted to service_role ONLY and is called from
--    POST /api/species?action=vote, which verifies the Privy token directly and
--    requires a non-null token wallet claim. Grant it to `authenticated` only
--    after mint-session drops the bodyWallet fallback.
--    See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md §8.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cast_species_vote_as(
  p_wallet        TEXT,
  p_suggestion_id UUID,
  p_vote          TEXT,
  p_note          TEXT DEFAULT ''
)
RETURNS species_suggestions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet TEXT;
  v_role   TEXT;
  v_status TEXT;
  v_row    species_suggestions;
BEGIN
  IF p_vote NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid vote %; expected approve or reject', p_vote
      USING ERRCODE = '22023';
  END IF;

  v_wallet := lower(nullif(trim(p_wallet), ''));
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Prefer 'founder' when the caller holds several roles, so the audit snapshot
  -- names the role that actually carried the decision.
  SELECT role INTO v_role
    FROM user_roles
   WHERE lower(wallet_address) = v_wallet
     AND role = ANY (species_voting_roles())
     AND active
   ORDER BY (role = 'founder') DESC
   LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Wallet % holds no species curation role', v_wallet
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM species_suggestions WHERE id = p_suggestion_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Suggestion % not found', p_suggestion_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status IN ('promoted', 'rejected') THEN
    RAISE EXCEPTION 'Suggestion % is already % and cannot be voted on', p_suggestion_id, v_status
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO species_suggestion_votes (suggestion_id, voter_wallet, vote, voter_role, note)
  VALUES (p_suggestion_id, v_wallet, p_vote, v_role, COALESCE(p_note, ''))
  ON CONFLICT (suggestion_id, voter_wallet)
  DO UPDATE SET vote       = EXCLUDED.vote,
                voter_role = EXCLUDED.voter_role,
                note       = EXCLUDED.note,
                created_at = now();

  -- The AFTER trigger has already recomputed status by this point.
  SELECT * INTO v_row FROM species_suggestions WHERE id = p_suggestion_id;
  RETURN v_row;
END;
$$;

-- service_role only. NOT `authenticated` — see the header comment above.
REVOKE ALL ON FUNCTION cast_species_vote_as(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION cast_species_vote_as(TEXT, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION cast_species_vote_as(TEXT, UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION cast_species_vote_as(TEXT, UUID, TEXT, TEXT) IS
  'Cast a curation vote as p_wallet. The caller MUST have already verified that wallet (api/species.js action=vote does this with a Privy token). Granted to service_role only because the Supabase JWT wallet_address claim is not currently trustworthy - see docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md 8.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. species_profiles — the rich-card overlay
--
--    Needed because Dexie db.species cannot hold anything: both writers
--    (hooks/useSpeciesData.js:44, hooks/useCatalogHydration.js:71) call clear()
--    then refill from fishbase_master.json, so an injected row is wiped on the
--    next catalog load. A species promoted on-chain but absent from the JSON
--    would otherwise render a card with no photo, ecology, diet, or personality.
--
--    `profile` holds the SAME shape as a fishbase_master.json record, so the
--    client merge is a plain overlay rather than a second rendering path.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS species_profiles (
  spec_code       INTEGER PRIMARY KEY DEFAULT nextval('species_local_spec_code_seq'),
  scientific_name TEXT NOT NULL,
  common_name     TEXT NOT NULL,
  profile         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          TEXT NOT NULL DEFAULT 'suggestion'
                    CHECK (source IN ('suggestion', 'manual', 'import')),
  suggestion_id   UUID REFERENCES species_suggestions(id) ON DELETE SET NULL,
  -- Unpublished rows are drafts: authored but not yet shown on a card.
  published       BOOLEAN NOT NULL DEFAULT false,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS species_profiles_name_uniq
  ON species_profiles (lower(scientific_name));

CREATE INDEX IF NOT EXISTS species_profiles_published_idx
  ON species_profiles (published) WHERE published;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. species_id_map — the explicit specCode <-> on-chain speciesId relation
--
--    Two different numbers are both called "speciesId" in this codebase:
--    FishBase specCode (fishbase_master.json, Dexie species, species_insights)
--    and the sequential on-chain id (db.specimens.speciesId,
--    aquadex_specimens.species_id, aquadex_spawns.species_id).
--
--    They line up today ONLY positionally: on-chain id N == json[N-1], verified
--    across all 283 seeded entries with zero drift. Nothing persisted that, so
--    the first out-of-order insert would silently break every card link. This
--    table makes the relation explicit.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS species_id_map (
  spec_code          INTEGER NOT NULL,
  contract_address   TEXT    NOT NULL,
  onchain_species_id INTEGER NOT NULL CHECK (onchain_species_id > 0),
  scientific_name    TEXT,
  source             TEXT NOT NULL DEFAULT 'promotion'
                       CHECK (source IN ('promotion', 'backfill', 'seed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (spec_code, contract_address),
  UNIQUE (contract_address, onchain_species_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Convenience view for the council queue, so the UI does not hand-roll the
--    tally and cannot disagree with the invariant about what is still needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW species_suggestion_queue
WITH (security_invoker = true) AS
SELECT
  s.*,
  COALESCE(t.approve_votes, 0)      AS approve_votes,
  COALESCE(t.reject_votes, 0)       AS reject_votes,
  COALESCE(t.founder_approved, false) AS founder_approved,
  species_required_approvals()      AS required_approvals,
  GREATEST(species_required_approvals() - COALESCE(t.approve_votes, 0), 0)
                                    AS approvals_remaining
FROM species_suggestions s
LEFT JOIN (
  SELECT v.suggestion_id,
         count(*) FILTER (WHERE v.vote = 'approve' AND species_has_voting_role(v.voter_wallet)) AS approve_votes,
         count(*) FILTER (WHERE v.vote = 'reject'  AND species_has_voting_role(v.voter_wallet)) AS reject_votes,
         bool_or(v.vote = 'approve' AND species_is_founder(v.voter_wallet))                     AS founder_approved
    FROM species_suggestion_votes v
   GROUP BY v.suggestion_id
) t ON t.suggestion_id = s.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS
--
--    Reads are public: the queue and its votes are meant to be auditable, and a
--    "Founder approved this" badge should render for anyone.
--
--    EVERY table here is read-only to clients. All four write paths run through
--    api/species.js with the service key, because each one needs something the
--    client cannot be trusted to do:
--      suggestions — needs the fishbase_master.json cross-check (which sets
--                    fishbase_match and spec_code) and the per-wallet rate limit.
--                    A direct client insert would leave fishbase_match='unknown'
--                    and skip the duplicate detection entirely.
--      votes       — needs a Privy-verified voter, not the spoofable Supabase
--                    JWT claim (see §4 above).
--      profiles /
--      id_map      — written only by the promotion path, which spends the
--                    curator key.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE species_suggestions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_suggestion_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_id_map           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS species_suggestions_public_read ON species_suggestions;
CREATE POLICY species_suggestions_public_read
  ON species_suggestions FOR SELECT TO anon, authenticated
  USING (true);

-- Deliberately NO insert policy: a direct client insert would bypass the
-- fishbase cross-check and the rate limit. POST /api/species?action=suggest is
-- the only way in. Dropped explicitly in case an earlier revision created it.
DROP POLICY IF EXISTS species_suggestions_insert_own ON species_suggestions;

DROP POLICY IF EXISTS species_suggestion_votes_public_read ON species_suggestion_votes;
CREATE POLICY species_suggestion_votes_public_read
  ON species_suggestion_votes FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS species_profiles_public_read ON species_profiles;
CREATE POLICY species_profiles_public_read
  ON species_profiles FOR SELECT TO anon, authenticated
  USING (published);

DROP POLICY IF EXISTS species_id_map_public_read ON species_id_map;
CREATE POLICY species_id_map_public_read
  ON species_id_map FOR SELECT TO anon, authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Verification queries (run manually after applying)
--
--   -- Clients can read but never write any of the four tables:
--   SELECT tablename, cmd, policyname FROM pg_policies
--    WHERE tablename LIKE 'species_%' ORDER BY 1, 2;
--     -> exactly four rows, all cmd='SELECT'. No INSERT/UPDATE/DELETE anywhere.
--
--   -- The vote function is not reachable by a logged-in client:
--   SELECT has_function_privilege('authenticated',
--            'cast_species_vote_as(text,uuid,text,text)', 'EXECUTE');
--     -> false
--
--   -- The invariant holds for a curator-only approval (should stay 'pending'):
--   --   grant 'curator' to a test wallet, then
--   --   SELECT cast_species_vote_as('<wallet>', '<id>', 'approve');
--   --   SELECT status, approve_votes, founder_approved
--   --     FROM species_suggestion_queue WHERE id = '<id>';
--   --   expect status='pending', founder_approved=false
--
--   -- Threshold change is a one-liner:
--   --   CREATE OR REPLACE FUNCTION species_required_approvals()
--   --   RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;
-- ─────────────────────────────────────────────────────────────────────────────
