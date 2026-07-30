-- ============================================================================
-- Grow-out checkpoint type amendment: 'promoted'
-- (docs/BREEDER_STATE_MODEL.md §9.16, docs/BREEDER_TOOLS_T2_PROMOTION_SPEC.md)
--
-- WHY THIS IS A SEPARATE FILE: 20260729_spawn_growout_sync.sql is already
-- applied in production. Editing an applied migration means the file no longer
-- describes any database that exists, so the `type` CHECK is amended here
-- additively instead. Both files together are the current constraint — see the
-- type-coverage test in frontend/src/__tests__/growoutCloudSync.test.js, which
-- reads BOTH.
--
-- WHAT 'promoted' MEANS: the breeder pulled N keepers out of a grow-out cohort
-- and issued each one an individual birth certificate. Cohorts are counts and
-- individually tracked fish are certificates (§4.2); this is the transition
-- between those two representations, and it was the missing half of that model.
--
-- IT IS A DEPARTURE FROM THE COHORT, and that is an accounting invariant, not a
-- display choice: a fish is counted either as a cohort head or as a certificate,
-- never both and never neither. `utils/growoutFunnel.js` therefore subtracts
-- `promoted` from `alive`. A cohort of 15 that promotes 3 reads as 12 alive plus
-- 3 certificates. Without the subtraction it would read as 15 alive plus 3
-- certificates — 18 fish that do not exist — and it would surface as inflated
-- achievement and Founders totals rather than as an error.
--
-- IT IS NOT A SURVIVAL FAILURE. `survivalRate` reads `loss` only. A promoted fry
-- is the success case.
--
-- IT IS NOT A SALE AND CARRIES NO MONEY. Same guardrail as the parent
-- migration's note on `sold`: this table holds husbandry observations only.
-- Nothing here is inventory, ownership, or an order.
--
-- ITS COUNT MIRRORS REAL ROWS. services/cohortPromotion.js mints first, counts
-- the certificates that actually succeeded, and only then writes this checkpoint
-- with that number — never the number requested. So `count` here is always
-- backed by that many `specimens` records.
-- ============================================================================

-- The original constraint was declared inline on the column, so Postgres
-- auto-named it `aquadex_spawn_growout_type_check`. Drop both that name and the
-- explicit name below, so this migration is idempotent and so re-running it
-- after a future amendment is harmless.
ALTER TABLE aquadex_spawn_growout
  DROP CONSTRAINT IF EXISTS aquadex_spawn_growout_type_check;

ALTER TABLE aquadex_spawn_growout
  DROP CONSTRAINT IF EXISTS chk_growout_type;

-- Named on purpose: the next amendment doesn't have to guess what Postgres
-- called it.
ALTER TABLE aquadex_spawn_growout
  ADD CONSTRAINT chk_growout_type CHECK (type IN (
    'fry_count', 'cull', 'sold', 'loss', 'moved', 'note', 'narration', 'promoted'
  ));

-- ============================================================================
-- Done. No table, index, policy, or trigger is touched — only the type
-- vocabulary widens. Existing rows all satisfy the new constraint, so this
-- applies without a backfill.
-- ============================================================================
