# frontend/ops

Operational scripts for the species curation flow. **Tracked in git**, unlike
`frontend/scripts/`, which `.gitignore` excludes as local-only tooling (image
generation, cutouts, and similar).

The split is deliberate: these are needed to *run* the feature, not to develop it,
so they have to survive a fresh clone. Without the first two, the flow simply
cannot complete.

They live inside `frontend/` rather than at the repo root because they import
`@supabase/supabase-js` and **ethers v5** — both of which resolve from
`frontend/node_modules`. The repo root has ethers **v6** and no supabase-js, so the
same files at `/scripts/` would fail to resolve or, worse, silently pick up the
wrong ethers API. Run everything from the `frontend/` directory.

See `docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md` for the design these support.

## The two you will actually need

### `backfill-species-id-map.mjs`

Populates `species_id_map` with the `specCode` → on-chain `speciesId` relation.

`POST /api/species?action=promote` **refuses to publish** while this map is behind
the chain, because an incomplete map cannot rule out a duplicate catalog entry.
So nothing can ever be published until this has run.

Read-only with respect to the blockchain — it sends no transactions — and
idempotent. Re-run it after any `scripts/seed-species-catalog.js` batch, since that
one *does* transact and moves `nextSpeciesId`.

```
node ops/backfill-species-id-map.mjs --dry-run --report   # inspect, write nothing
node ops/backfill-species-id-map.mjs                      # write species_id_map
```

### `author-species-profile.mjs`

Authors the rich care profile a species needs *before* it can be published.

Required for any suggestion whose `fishbase_match` is `none` — a species absent
from `fishbase_master.json`. Publishing one without a profile produces a card with
no photo, ecology, diet, or personality, and that cannot be patched afterwards by
writing to Dexie `db.species` (both of its writers `clear()` and refill from the
bundled JSON file). Hence the Supabase `species_profiles` overlay, which
`useSpeciesData` merges over the reference catalog on load.

```
node ops/author-species-profile.mjs --list                        # what needs a profile
node ops/author-species-profile.mjs --suggestion <uuid> --template
# fill in the TODOs, then:
node ops/author-species-profile.mjs --file <path> --publish
node ops/author-species-profile.mjs --drafts                      # unpublished profiles
node ops/author-species-profile.mjs --publish-code <specCode>     # publish a draft
```

It refuses to publish while `TODO` placeholders remain, because a half-filled
profile is exactly the empty card the overlay exists to prevent.

## Verification harnesses

Closer to tests than to tooling. Both exit non-zero on failure.

- **`verify-curation-routes.mjs`** — invokes the real `api/species.js` handler with
  mock req/res, so it needs no server (and sidesteps the `vercel dev` recursion
  this project hits, since the `dev` script *is* `vercel dev`). Asserts that
  `suggest`/`vote`/`promote` reject both unauthenticated and forged-bearer
  requests, that `GET` on `promote` is 405, and that curation responses use the
  restricted CORS allowlist while the public species API keeps `*`.

- **`verify-curation-contract.mjs`** — asserts the field contract from the
  `species_suggestion_queue` view, through `?action=queue`, to the exact property
  names `BreedersCouncil.jsx` reads. Worth having because a rename anywhere in
  that chain surfaces as an `undefined` in the UI rather than an error: the vote
  tally would render blank and the "needs a founder's approval" line would quietly
  lie. Runs against production and cleans up after itself; it never promotes, so it
  makes no on-chain write.

```
node ops/verify-curation-routes.mjs
node ops/verify-curation-contract.mjs
```

## Environment

All four read `frontend/.env` when present. `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` are required for everything that touches Supabase;
`backfill` also uses `RPC_URL` and `MANAGER_ADDRESS`.

Note that none of these can publish to the chain. Publication is founder-gated and
happens only through the promote endpoint, which holds the curator key server-side.
