-- ═══════════════════════════════════════════════════════════════════════════
-- species_suggestion_queue: report whether an authored care profile exists
--
-- THE BUG THIS FIXES. `species_suggestions.fishbase_match` records what was true
-- at SUBMIT time and never changes. The council UI used it directly to decide
-- whether publishing was blocked:
--
--     needsProfile = item.fishbase_match === 'none'
--
-- So a species outside fishbase_master.json stayed un-publishable FOREVER, even
-- after a curator authored and published its care profile — the Publish button
-- would never re-enable, with no indication why. The promote endpoint would have
-- accepted it; only the UI was stuck. That is the dead-end at the very last step
-- of the one path a genuinely new species has to take.
--
-- A new file rather than an edit to 20260816120000, which is already applied:
-- the filename is the identity of an applied migration, so editing it would make
-- the repo disagree with the record of what ran. Same reasoning as §6.6.
--
-- `has_published_profile` is computed live, so publishing a profile immediately
-- unblocks the suggestion with no backfill and no status transition to forget.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW species_suggestion_queue
WITH (security_invoker = true) AS
SELECT
  s.*,
  COALESCE(t.approve_votes, 0)        AS approve_votes,
  COALESCE(t.reject_votes, 0)         AS reject_votes,
  COALESCE(t.founder_approved, false) AS founder_approved,
  species_required_approvals()        AS required_approvals,
  GREATEST(species_required_approvals() - COALESCE(t.approve_votes, 0), 0)
                                      AS approvals_remaining,
  -- Matched on lowercased scientific_name, the same key the promotion endpoint
  -- uses to resolve the payload (ilike on scientific_name), so the button state
  -- and the server's decision cannot disagree.
  EXISTS (
    SELECT 1 FROM species_profiles p
     WHERE lower(p.scientific_name) = lower(s.scientific_name)
       AND p.published
  )                                   AS has_published_profile,
  -- The single question the UI should ask. True when this species cannot be
  -- published yet because there is nowhere for its card content to come from:
  -- absent from the reference catalog AND no authored profile.
  (
    s.fishbase_match = 'none'
    AND NOT EXISTS (
      SELECT 1 FROM species_profiles p
       WHERE lower(p.scientific_name) = lower(s.scientific_name)
         AND p.published
    )
  )                                   AS needs_care_profile
FROM species_suggestions s
LEFT JOIN (
  SELECT v.suggestion_id,
         count(*) FILTER (WHERE v.vote = 'approve' AND species_has_voting_role(v.voter_wallet)) AS approve_votes,
         count(*) FILTER (WHERE v.vote = 'reject'  AND species_has_voting_role(v.voter_wallet)) AS reject_votes,
         bool_or(v.vote = 'approve' AND species_is_founder(v.voter_wallet))                     AS founder_approved
    FROM species_suggestion_votes v
   GROUP BY v.suggestion_id
) t ON t.suggestion_id = s.id;

COMMENT ON VIEW species_suggestion_queue IS
  'Curation queue with live vote tallies. needs_care_profile is the flag the UI should gate the Publish button on - fishbase_match alone is a submit-time snapshot and never clears once a profile is authored.';
