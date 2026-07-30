# Changelog

All notable changes to AquaDex are documented here.

---

## [0.10.10] — 2026-07-30

### 🔐 Pedigree Attestation: Reusing the Trust Root, Not the Credential

Lands T3 §2.4 ([`BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md`](docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md)). Still nothing issues a document, so app behaviour is unchanged.

The question was how a breeder attests a pedigree hash in an app that hides wallets from users. The answer was to reuse the wallet proof that already exists: Privy has authenticated the user, `/api/mint-session` already verifies that Privy token. New endpoint `/api/attest-pedigree` does the same verification and signs a statement. **No new user-facing step**, which is what made reuse the right call.

#### ⚠️ Why it could not reuse the *token*
The one-line version of this is to drop the JWT `mint-session` returns into the document. **That token is a live session credential** — `role: "authenticated"` plus `wallet_address`, signed with `SUPABASE_JWT_SECRET`. Anyone holding it can act as that wallet against Supabase until it expires.

And pedigree documents are *meant to be published*: §4.3 puts them in a **public** Supabase Storage bucket at a deterministic, guessable path. So the shortcut would publish a working credential for the breeder's wallet at a URL anyone can construct.

The attestation is a separate artifact: its own key (never `SUPABASE_JWT_SECRET`), no `role` or `aud`, **ES256 rather than HS256** (symmetric would mean only *we* could verify, so the buyer paying the premium couldn't check it at all), no `exp` (a provenance record is a claim about a past moment, not an authorization), and a `purpose` claim bound to this use.

Enforced mechanically rather than by comment: `assertNotCredential` throws on `role`, `aud`, `access_token`, `token_type`, or a mismatched purpose, and `pedigreeTrustLevel` degrades a credential-shaped attestation to `unattested` rather than crashing a lineage chart.

#### 🪜 The trust ladder gained a rung
`attested` previously meant "has a signature", and its copy read *"Anyone can check it without trusting Aquadex."* **That would be false for a platform attestation.** So `platformAttested` now sits between `unattested` and `attested`, and its copy says whose word it is: *"Aquadex confirms the breeder was signed in when this was recorded. That is our word, not the breeder's signature."*

An anchor does **not** promote a platform attestation to `anchored` — anchoring our own statement makes it permanent, not independent. And the level **fails downward** at every ambiguity: unknown method, missing signature, or an attestation covering a *different* document's hash all read as `unattested`. That last one is the cheapest possible forgery — take any real attestation and staple it on — and `attachAttestation` refuses it outright.

#### 🐛 Known gap this creates
**The public key isn't published yet (§9.29).** ES256 was chosen so anyone can verify without a shared secret, but with no published key that verification is currently possible only for us — the exact situation the asymmetric choice exists to avoid. Needs key generation, env vars, a public read endpoint, and a rotation story (`kid` is already in every signature header).

#### 🧱 Internal
- 15 new tests. Three of the endpoint's source guards failed on the first run **because the endpoint's own comments explain why it doesn't use `SUPABASE_JWT_SECRET`, `HS256`, or a `role` claim** — trap 6.3 in the handoff, walked into by the session that wrote it down. Guards now strip comments.
- Two copy assertions also failed by banning words that honest copy legitimately names while denying them ("not the breeder's signature"). Recorded as trap 6.9: **assert positively on what copy must say, not on the absence of a word.**

#### Modified Files
| File | Change |
|------|--------|
| `frontend/api/attest-pedigree.js` | **New.** Privy-rooted, purpose-bound, ES256, non-expiring platform attestation |
| `frontend/src/services/pedigreeDocument.js` | `ATTESTATION_METHOD`, `ATTESTATION_PURPOSE`, `assertNotCredential`, `attachAttestation`; five-rung trust ladder; `platformAttested` copy |
| `frontend/src/__tests__/pedigreeDocument.test.js` | +15 tests incl. the credential guard and endpoint contract |
| `docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md` | §2.4 resolved |
| `docs/BREEDER_STATE_MODEL.md` | §9.29 added; §12.3 records where attestation landed |

---

## [0.10.9] — 2026-07-30

### 🧾 The Portable Pedigree: a Lineage Claim That Can Leave the Device

Lands the core of [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.25, specified in [`BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md`](docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md). **Nothing issues a document yet** — no behaviour has changed. That is deliberate: shipping an unattested document to users would teach them the badge means nothing (T3 §2.4).

#### 🧩 The problem
Lineage did not survive a sale. A batch listing copied the fry's `sireId`/`damId` off the spawn and carried them through the public projection; fulfillment dropped them. `db.specimens.add` appears nowhere in `frontend/src`, and the batch arrival branch writes only `db.marketOrders`.

The obvious fix — mint on the buyer's side from the parents on the listing — **does not work.** Serials are assigned `local max + 1`, so they are device-scoped: a buyer-side certificate claiming `sireId: 7` points at whatever fish is #7 in *their* registry. It would resolve, render, and be wrong, which is the §3 failure across a device boundary. And the buyer cannot repair it, because the specimen pull is `.eq("owner_address", …)` and RLS scopes the table to the caller's wallet.

> Lineage cannot cross an ownership boundary as a **reference**. It has to cross as a **document**.

#### 🎯 The decision behind the design
Settled by the scenario in §12.3: a master breeder sells 10 premium eggs, four hatch, and the buyer later charges a premium *because the lineage traces to that breeder*. **A pedigree is a document the buyer owns, and its trustworthiness comes from being tamper-evident and attributable — not from who holds it.** The person paying the premium is the *next* buyer, so a document the holder can edit proves nothing; and it has to still stand after the master breeder deletes their account.

- **The hash is the portable identity.** A serial differs per device; a content hash is the same string in every wallet.
- **Documents chain by hash.** A child's hash depends on its parents' hashes, so generation three reaches the original breeder without reading anyone's private registry. A plain snapshot would degrade into a snapshot of a snapshot.
- **The body holds nothing mutable.** No `ownerAddress`, `status`, `archived`, or `currentTankId` — a body containing one stops verifying the first time the fish is moved, a failure that arrives months later and breaks every document at once. Guarded two ways: a forbidden-field scan, and a test that reseals after retiring, archiving, renaming, and moving the fish and asserts the hash is unchanged.
- **Unknown ancestry is recorded, not omitted.** All six ancestor roles are always present; unresolvable ones are `null`. An unrecorded ancestor is unknown, not unrelated.
- **The document states how much it proves.** `ancestorCoverage` reports 2-of-6 versus 6-of-6, so a premium can be judged rather than trusted.
- **Nothing reads as verified until attested.** `pedigreeTrustLevel` returns `invalid` / `unattested` / `attested` / `anchored`, and the UI must read it rather than inferring trust from a document existing. This is §7.1's line applied to provenance and the reason §9.28 was cleared first.

#### 🔍 Two decisions forced by keeping the module loadable
- **SHA-256 via `globalThis.crypto.subtle`, not keccak.** keccak is the chain's native hash and was the first instinct — but the only route to it here is `utils/ethersCompat.js`, which reads `window.ethers` **at module load**, making any importer unloadable in the node test environment where every guarantee is checked. Web Crypto covers browser and node with zero new dependencies. Anchoring later is unaffected: a hash goes on-chain as `bytes32`, not recomputed in Solidity.
- **`PEDIGREE_BODY_DEPTH` is duplicated from `services/pedigree.js` on purpose.** That module imports `db`; importing it would drag Dexie into the graph of a hashing primitive. A test asserts the two constants agree, so drift fails loudly instead of mislabelling a document's depth.

#### 🐛 Guarded because JSON would hide it
`canonicalize` **throws** on `NaN`, `Infinity`, functions, symbols, and bigints rather than letting `JSON.stringify` write `null` or drop them silently. A coerced `NaN` produces a document whose hash no longer describes its contents — a provenance record that fails its own verification, which is the worst failure available here. Errors name the path to the offending value.

#### 🧱 Internal
- 52 tests. The pinned SHA-256 was **confirmed against `node:crypto`** independently of the module's Web Crypto path, so it is a real digest rather than one back-filled from a failing assertion.
- Tamper evidence is asserted by editing a sealed body, not by trusting that a hash was computed. The chain test seals three generations under three different wallets and identifies the *specific* broken link, and distinguishes a missing ancestor document ("incomplete") from a tampered one ("untrustworthy").
- `PEDIGREE_TRUST_COPY` carries casual and pro variants with the `PROHIBITED_TERMS` invariant test, plus an assertion that the unattested wording is actively negative rather than merely omitting the claim.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/pedigreeDocument.js` | **New.** `canonicalize`, `hashCanonical`, `sealPedigreeDocument`, `verifyPedigreeDocument`, `verifyPedigreeChain`, `pedigreeTrustLevel`, `ancestorCoverage`, `traceBreeders`, `PEDIGREE_TRUST_COPY` |
| `frontend/src/__tests__/pedigreeDocument.test.js` | **New.** 52 tests |
| `docs/BREEDER_TOOLS_T3_PEDIGREE_DOCUMENT_SPEC.md` | **New.** The T3 spec |
| `docs/BREEDER_STATE_MODEL.md` | §9.25 core landed; §12.6 updated |

---

## [0.10.8] — 2026-07-30

### 🏆 Trust Badges Now Mean Something

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.28. Found while working through the pedigree decision in §12: that work exists so "bred by this breeder" is worth paying a premium for, and a badge saying "Master Breeder" or "Verified" with nothing behind it doesn't just mislead — it makes the verified version worthless, because a buyer can't tell them apart.

**"Master Breeder" was granted four incompatible ways. Two were backed by nothing.**

#### 🐛 Removed: reputation tiers derived from listing count
`MarketplaceBoard` awarded 🏆 **"Master Breeder"** at 10 active listings, ⭐ "Established" at 5, and ✓ "Trusted" at 3. **Posting listings is free and self-serve**, so all three measured inventory volume and called it trustworthiness — no sales, no ratings, no verification — on the one screen where a buyer decides whether a premium price is justified. This is §9.11's mistake ("Established Seller" earnable by typing 50 into a form) applied to identity. "Established" also collided with the real, verified-sales achievement of the same name, so one word meant two different things depending on the screen.

Not replaced with an honest listing-count label: listing volume is not reputation, and naming it accurately would be clutter carrying no signal. The real flag (`breeder_profiles.is_master_breeder`, gated by `checkMasterBreederEligibility` — tier 4 + 5 completed sales + ≥4.0 rating) belongs on the storefront, where the eligibility check actually runs.

#### 🐛 Relabelled: a self-selected badge that said "Verified"
The worse one, found while fixing the first. `TankList`'s commenter role chip read "⭐ **Verified** Master Breeder" — and **the user clicks it on their own comment.** Nothing checks it. Its gate is 10,000 Companion XP, which measures app engagement (logged feedings, posts) and is reachable without ever having bred a fish. It also unlocks the higher-authority "Lab Audit" comment type.

Tagging a comment as coming from an experienced breeder is genuinely useful, so the chip stays — now "⭐ Experienced Breeder", with a tooltip saying it isn't checked. **The stored role key `master-breeder` is unchanged**, because existing comments carry it in Dexie and the cloud mirror; renaming it would orphan them, the same reason `"Not Sure"` survives as a legacy sex value.

#### 🐛 Removed: "Verified Local Breeder", asserted about everyone
Casual mode replaced the seller's name on **every** listing with a hardcoded "✅ Verified Local Breeder" — a verification claim *and* a locality claim, neither checked, shown to the readers least equipped to question it. A "🤝 Verified Local Breeders" pill made the same claim about all sellers at once from inside a banner headed "Guarantee". Both gone. The escrow and 3-Day Safe Arrival pills stayed, because those describe mechanisms that exist and are enforced.

Fabricated proximity was already retired once from the Fish Finder (Decision D3). This was the same claim surviving in casual mode — worth recording as a pattern: **a fabrication removed from the pro surface can live on in the casual one.** `SellerName` was already casual-safe (display name → local alias → generated alias, never a raw address), so casual mode lost nothing real.

#### 🧱 Internal
- New `src/__tests__/breederTrustClaims.test.js` — 9 source guards, including a conditional one: if a "Master Breeder" badge ever returns to the marketplace board it must read `is_master_breeder` rather than deriving the title from data already in hand.
- `isMasterBreeder: true` in `storefront/StorefrontPage.jsx` was checked and **cleared** — it's inside `DEMO_STOREFRONT_DATA` for `/store/demo` previews, not a production badge. Recorded so it isn't re-flagged.
- Left open deliberately: whether a purely self-described tag should be XP-gated at all. The gate is unchanged; only the claim was.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/components/MarketplaceBoard.jsx` | `breederReputation` tiers deleted; "Verified Local Breeder" and "Verified Local Breeders" removed; seller name now renders in both modes |
| `frontend/src/components/TankList.jsx` | Role chip and comment badge relabelled "Experienced Breeder"; Lab Audit toast names the tag that gates it; stored role key untouched |
| `frontend/src/__tests__/breederTrustClaims.test.js` | **New.** 9 guards |
| `docs/BREEDER_STATE_MODEL.md` | §9.28 closed; §12.7 rewritten |

---

## [0.10.7] — 2026-07-30

### 🥚 Spawn Status Now Means Something

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.6.

#### 🐛 The bug
`relaySpawn` writes `Fry` at creation and **nothing ever moved it**. Every spawn a breeder had ever logged read "Fry" forever — the ones that produced certificated adults two years ago and the ones where nothing survived the first week, side by side, identically labelled. The badge was decorative. `SpawningDashboard` was even loading the grow-out checkpoints already (`growoutData`) and then never reading them.

#### 🎯 Resolved as derived, not stored
`deriveSpawnStatus({ storedStatus, checkpoints })` is a pure function of the grow-out checkpoints, which already record what happened. Storing it on write would need a transition guard, a backfill, and a second copy of the truth that can fall out of date. Derived has none of those, cannot go stale, and reads the same rows through the same `summarizeGrowout` that prints the numbers under the badge — so the two can never disagree.

**It only ever advances.** `promoted > 0` → `Raised`. A counted cohort with nothing alive, nothing promoted, and nothing sold → `Failed`. `fry > 0` → `Fry`, which advances a stored `Egg` and is otherwise a no-op. A stored `Raised`/`Failed` wins outright. With no evidence the stored value stands.

Three of those are decisions, not mechanics:
- **`Egg` is never derived.** `relaySpawn` mints offspring certificates immediately, so a spawn with no checkpoints genuinely has fry. Reading "no `fry_count` checkpoint" as "Egg" would mislabel every spawn a breeder hasn't logged against yet — a downgrade dressed as a fix.
- **A `sold` count is not a `Raised` signal**, even though selling fry implies raising them. It is a self-reported number with nothing behind it — the same thing that was backing the "Established Seller" badge (§9.11) — and it fires too early: "sold 5" in week one would mark a spawn `Raised` while the rest of the cohort is still in the tank.
- **`Failed` requires a fry count.** Without the cohort's size, "everything died" is indistinguishable from "nothing was logged". Unknown stays unknown, exactly as `survivalRate` returns `null` rather than `0`. A cohort that emptied through sales is also not a failure.

#### 🖥️ It says where it came from
Each result carries a `reason`, rendered as a line under the badge ("From grow-out: keepers were promoted to their own certificates"). A badge that changes on its own with no explanation is worse than one that never moved. `derived` is returned separately so a caller can distinguish "we worked this out" from "this is what the record says".

#### 🧩 One `null` meaning, not two
An unrecognized stored status is passed through **unchanged** rather than converted to `null`. `spawnStatusLabel` already renders an unrecognized ordinal as "Unknown", but it reads `null`/`undefined` as *absent* and defaults those to `Fry` — so returning `null` would have collided the two meanings and quietly relabelled a corrupt status as `Fry`. Caught by a test asserting the label, not the return value.

#### 🧱 Internal
- 38 new tests, including guards that `Egg` is never derived from any input, that a full promotion is reported as `Raised` rather than a total loss (fry 4, promoted 4 → alive 0), that a self-reported sale does not advance status, and that `SpawningDashboard` never passes `spawn.status` to the badge or writes a status of its own.
- `SPAWN_DERIVATION_COPY` carries casual and pro variants with the `PROHIBITED_TERMS` invariant test.
- `specimenIdentity.js` now imports `summarizeGrowout`, so there is one funnel implementation behind both the badge and the counts.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/utils/specimenIdentity.js` | **New:** `deriveSpawnStatus`, `SPAWN_TERMINAL_STATUSES`, `SPAWN_DERIVATION_REASON`, `SPAWN_DERIVATION_COPY` |
| `frontend/src/components/SpawningDashboard.jsx` | Badge reads the derived status; reason line beneath it; `checkpointsBySpawn` index over the `growoutData` it was already loading |
| `frontend/src/__tests__/specimenIdentity.test.js` | 38 new tests incl. the copy invariant and dashboard source guards |
| `docs/BREEDER_STATE_MODEL.md` | §9.6 closed; new §8.1 |

---

## [0.10.6] — 2026-07-30

### 🏅 Cohort → Certificate Promotion

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.16, specified in [`BREEDER_TOOLS_T2_PROMOTION_SPEC.md`](docs/BREEDER_TOOLS_T2_PROMOTION_SPEC.md). Retiered from B to A/B before building, because it creates birth certificates.

#### 🧩 The gap
The model says fish start life as a **count** on a grow-out cohort and become a **certificate** when the breeder decides to track one individually (§4.2). There was no path between those two states. A breeder pulling four keepers out of a grow-out tank had to go to the Register tab and retype the sire and dam serials by hand, per fish, from memory — and nothing decremented the cohort, so the same four fish were then counted twice. All of that data is one `db.spawns.get()` away.

#### 🎯 The invariant now enforced
> A fish is counted **either** as a cohort head **or** as an individual certificate. Never both, never neither.

Everything else follows from it:
- **`promoted` is a departure type.** A cohort of 15 that promotes 3 reads as 12 alive plus 3 certificates. Were it not a departure it would read as 15 alive plus 3 certificates — **18 fish that don't exist** — and it would surface as inflated Achievements and Founders totals rather than as a crash.
- **You cannot promote more than the cohort has alive.** Blocked in the service, not just the form, and a rejected promotion writes *nothing* — no certificates, no checkpoint. Otherwise `alive` floors at 0 and the surplus certificates are fabricated fish.
- **The checkpoint count is the number of certificates that actually got created,** counted after the mints. Request 3, have the second fail, and the checkpoint says 2. A count written optimistically decrements the cohort for a fish that does not exist.
- **Promotion is not a survival failure.** `survivalRate` still reads `loss` alone. A promoted fry is the success case, and a rate that dropped when a breeder pulled their best keepers out would be actively misleading.

#### 🧬 Nothing is fabricated to fill a gap
Parents, species, tank, owner, and **hatch date** all come from the spawn record — `birthTimestamp` is the spawn's timestamp, not `Date.now()`. A spawn that can't be found, or has no owner, fails loudly instead of minting with `sireId: 0` or a guessed wallet: an unparented or mis-dated certificate is worse than a blocked one, because `tokenURI` reads a stored string with no setter and a certificate is never destroyed (§4.1), so there is no correction path. Sex defaults to `Unsexed` — promoted fry are usually too young to sex and the app has no business inferring it. Each certificate records `Origin` and `Source Spawn` so a future reader can tell a promoted fry from a wizard-registered offspring, the same reason T1 records `COI Method` beside the coefficient.

#### 🐛 Fixed while adding the type
**`DEPARTURE_TYPES` was documentation, not code.** `summarizeGrowout` hardcoded `lost + culled + sold` and `buildGrowoutTimeline` walked an `else if` chain per type, so *appending to the array changed nothing*. The module was extracted last release specifically so that a new checkpoint type would be a one-place change, and it wasn't one yet — the four-file silent accounting error had been concentrated into one file rather than removed. Both functions now reduce over the array.

#### 🗄️ Migration
`20260729_spawn_growout_sync.sql` is **applied in production**, so the `type` CHECK is widened by a new additive file rather than an edit — editing an applied migration means the file no longer describes any database that exists. The original constraint was declared inline, so Postgres auto-named it; the amendment drops both the auto name and its own, then names the replacement so the next amendment doesn't have to guess. The type-coverage test now reads **both** files, and gained a second assertion in the opposite direction — `GROWOUT_TYPES` drives the manual picker, so a type written only programmatically (like `promoted`) would otherwise slip past the scrape.

#### 🖥️ The panel
A "Promote keepers" action on the grow-out tracker, with the sire and dam shown read-only above the form — the visible payoff of doing this here rather than re-registering from scratch. Per-fish name and sex are optional. The count input's `max` is `promotableCount(funnel)`, the same expression the service's hard block uses, so the form and the boundary can't disagree. When there is nothing left to promote the action is **absent, not disabled** — a greyed button with no explanation is worse than no button.

`promoted` is in `GROWOUT_TYPES` so history rows get a label, but `PROGRAMMATIC_TYPES` filters it out of the manual "Add Checkpoint" picker: a hand-typed promotion would decrement the cohort with no certificates behind it, which is the same double-count from the other direction. On success the funnel and chart **re-derive from the stored checkpoint** rather than adjusting a local number, which is how a displayed count drifts away from what was written. A partial result is reported with both numbers and never rounded off to "done".

The tracker takes **no new props**. It resolves the spawn from Dexie, because it is mounted from two places that pass different prop sets (`GrowOutSection` four, `HatcheryLogs` two).

#### 📇 Species names resolve local-first
A supplied catalog entry, then a **sibling certificate of the same species** already in Dexie — nearly always present, since the spawn minted offspring when it was recorded — then the relayer's own blank defaults. The sibling step is what keeps this path off the per-species RPC enumeration `SpawningWizard` still does on mount (§9.12); copying that here would have spread the problem rather than solved it. A missing name stays blank; it is a cosmetic gap, and guessing one and writing it onto a certificate would not be.

#### 🧱 Internal
- 43 tests in `cohortPromotion.test.js` plus 9 in `growoutFunnel.test.js`. The over-promote and partial-mint cases assert on the **stores**, not the return value: "it returned an error" is not the criterion when the failure mode is a fabricated fish.
- Two promotions in the same second get distinct checkpoint timestamps. The cloud mirror's natural key is `(owner, spawn, event_timestamp, type)` and collisions resolve by upsert — desirable for a double-submitted fry count, but for a promotion it would collapse two events into one row and *undercount* the departure, leaving the cohort holding heads that are already certificates.
- `PROMOTION_COPY` carries casual and pro variants with the `PROHIBITED_TERMS` invariant test, and the service returns an **`errorKey`** rather than a sentence — so counts travel as data on the result (`available`, `promoted`, `requested`) instead of being interpolated into copy the invariant scan could never see. A test asserts no copy string contains a template placeholder.
- No new entitlement key. Promotion reuses `breeder_register_certificate` + `breeder_growout_tracking`, both REQUIRED — `hasEntitlement` fails **closed**, so a new unregistered key would silently disable the feature for everyone.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/cohortPromotion.js` | **New.** `promoteCohortToCertificates`, `promotableCount`, `PROMOTION_COPY`, `PROMOTION_ERROR` |
| `frontend/src/utils/growoutFunnel.js` | Departures reduce over `DEPARTURE_TYPES` in both functions; `promoted` added; `promoted` / `totalPromoted` reported |
| `frontend/src/components/SpawnGrowoutTracker.jsx` | Promote panel; `PROGRAMMATIC_TYPES` / `MANUAL_GROWOUT_TYPES`; spawn lookup; promoted funnel line |
| `frontend/supabase/migrations/20260730_spawn_growout_promoted_type.sql` | **New.** Additive `type` CHECK amendment. **Applied 2026-07-30** |
| `frontend/src/__tests__/cohortPromotion.test.js` | **New.** 43 tests, incl. tracker source guards and the copy invariant |
| `frontend/src/__tests__/growoutFunnel.test.js` | Double-count regression, summary/timeline agreement with a promotion, array-driven source guard |
| `frontend/src/__tests__/growoutCloudSync.test.js` | Type coverage reads both migrations, both directions, plus additive-migration shape |
| `docs/BREEDER_TOOLS_T2_PROMOTION_SPEC.md` | **New.** The T2 spec |
| `docs/BREEDER_STATE_MODEL.md` | §9.16 closed; §4.2 and §7.2 updated |

---

## [0.10.5] — 2026-07-29

### 📊 Founders Dashboard: Stop Reporting Fabricated Metrics

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.22, found during the §9.5 schema audit.

#### 🐛 Fixes
- **Two charts were plotting random numbers.** `getUserGrowth` and `getProtocolActivity` fell back to `generateMockTimeSeries` / `generateMockActivitySeries` — literally `Math.random() * 80 + 10` — whenever a query failed. Because three of the tables being queried **did not exist**, that fallback was the *normal* path. The User Growth and Protocol Activity charts were random walks relabelled as platform metrics. Both generators are now deleted, not just unused.
- **$0 revenue was being reported as a measurement.** `getMarketplaceGMV` queried `market_orders` (no such table) for an `amount` column (no such column); `getProtocolFees` queried a `protocol_fees` table that has never existed — the fee is a *column*, `orders.platform_fee_cents`. Both sat behind `return 0`, so the dashboard confidently displayed **$0 GMV and $0 protocol fees**, indistinguishable from "we earned nothing". Now read from `orders` using the same settled-status filter as the project's own `buyer_order_analytics` view, so revenue agrees across surfaces.
- **"Specimens Minted" was counting something else.** It queried a bare `specimens` table, then silently fell back to summing `profiles.species_count` — a count of distinct *species* per user, not specimens. Now reads `aquadex_specimens`.
- **A hardcoded Poseidon breakdown was rendered as a pie chart.** `getPoseidonStats` returned `{ identify: 42, husbandry: 67, diet: 23, general: 31 }` whenever Supabase was unconfigured. There is no `poseidon_queries` table and `api/ai.js` doesn't log intents, so the metric has no source at all — the panel now says so (§9.23).
- **Two KPI cards showed invented growth.** `trend="+18%"` on Total Users and `trend="+15%"` on Marketplace GMV were hardcoded, never computed. Removed rather than faked (§9.24).
- **Wrong column types in the time series.** `aquadex_specimens` has no `created_at` (registration time lives in the synced blob), and `aquadex_spawns.event_timestamp` is unix **seconds**, not a timestamptz — the old code compared it to an ISO string. Both now read correctly.
- Removed a duplicated query in `getTotalUsers`, which ran the same count twice and discarded the first result.

#### 🎯 The rule now enforced
**`null` means unknown and is never 0.** Every metric returns `null` when its source can't be read, and the dashboard renders that as "—" via a new `NoDataPanel`. An *empty* result is a real finding and returned as such — a flat line at zero is an answer. Previously an unreadable table and a genuinely quiet week were indistinguishable, which is what let this survive. `formatCurrency(null)` returned `"$0"`; it now returns `"—"`, because on a revenue KPI those mean opposite things.

This is the same call the project already made when it removed fabricated proximity discovery from the Local Sellers map (Decision D3).

#### 🧱 Internal
- 21 new tests, including a fixture harness that marks tables as nonexistent so the "missing source" path is actually exercised, plus guards that the mock generators, the hardcoded Poseidon numbers, the fake trends, and all four bad table names are gone.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/foundersAnalytics.js` | Real tables/columns; `null` for unknown; mock generators deleted; `safeCount`/`sumCents` helpers; exported `SETTLED_ORDER_STATUSES` |
| `frontend/src/components/FoundersDashboard.jsx` | New `NoDataPanel`; `formatCurrency(null)` → "—"; no-data states for both charts and the Poseidon panel; fabricated trends removed |
| `frontend/src/__tests__/foundersAnalytics.test.js` | **New.** 21 tests |
| `docs/BREEDER_STATE_MODEL.md` | §9.22 closed; added §9.23, §9.24 |

---

## [0.10.4] — 2026-07-29

### 🔍 Schema & RLS Audit — Including a Correction

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.5. Documentation and one recovered schema; no behavior change.

#### ⚠️ Correction to a previous finding
§9.5 claimed there was **no migration in-repo** for `morph_submissions`, `aquadex_specimens`, `aquadex_spawns`, `aquadex_tanks`, `aquadex_action_logs`, or the `aquadex_listings` RLS lockdown. **That was wrong — all of them exist.**

This project has **two** migration directories and the earlier search only covered `frontend/supabase/migrations/`. Everything reported missing lives in the repo-root `supabase/migrations/`, which holds the Reef/social, cloud-sync, listings, XP-authority, and morph-submission migrations.

The two-directory split is itself worth fixing, and it's why the mistake was possible: date prefixes overlap across both directories, so "apply migrations in filename order" is ambiguous, and neither directory's name hints that the other exists.

#### 🐛 Fixes
- **`user_xp_profiles` had no DDL in the repo** — a genuine gap, now captured in `20260729_user_xp_profiles.sql` from the schema already documented in `cloudSync.js`. It exists live (cross-device XP restore is a shipped feature), but `total_xp` drives `current_tier`, which drives every EARNED entitlement — an undocumented schema behind an authorization input is worth having on paper. **DDL-only, no policy changes**: the live policies on this table haven't been inspected, and guessing could either lock out XP sync for every user or silently widen access.

#### 📋 Found, flagged, not fixed
- **The Founders dashboard reports zeros as though they were measurements** (§9.22). `services/foundersAnalytics.js` queries `specimens`, `spawns`, `market_orders`, and `protocol_fees` — none of which exist. The real tables are `aquadex_specimens`, `aquadex_spawns`, and `orders`/`canonical_orders`. Every call has a silent `return 0` fallback, so **marketplace GMV and protocol fees both read 0**. Outside Breeder Tools, but a business-metrics bug worth its own fix.
- **§9.20 reframed.** The spoofable `x-wallet-address` header fallback is **stage 3 of a documented, deliberate cutover**, not an oversight: `20260613` opened anon access with a "tighten later" note, `20260619` scoped it by header while explicitly acknowledging it's spoofable, and `20260624110000` added dual-mode JWT policies alongside it so clients could migrate without breaking. The two migrations added by this work follow that same convention correctly. Completing the transition is genuinely blocked on reading the **live** policy set, which a repo-only audit cannot do — a recommended sequence is written up in §11.3.

#### Modified Files
| File | Change |
|------|--------|
| `supabase/migrations/20260729_user_xp_profiles.sql` | **New.** Captures the existing live schema; idempotent, DDL-only |
| `docs/BREEDER_STATE_MODEL.md` | New §11 (schema/RLS audit) incl. the correction, the genuinely-missing list, the real three-stage RLS model, and the audit's own limits; §9.5 closed; §9.20 reframed; added §9.22 |

---

## [0.10.3] — 2026-07-29

### 🧬 Breeder Tools: Verified vs Self-Reported, and One Survival Funnel

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.11, and completes the prerequisite for the cohort → certificate promotion path (§9.16).

#### 🐛 Fixes
- **"Established Seller" was earnable by typing a number into a form.** The `first_sale` and `sales_50` badges derived from grow-out `sold` **checkpoints** — a value the breeder enters in a text field — rather than from completed orders. Every badge carries a `ShareButton`, so that self-assessment was one tap from being published as a claim about someone's commercial history. Both now read `verifiedSales`, counted from settled `marketOrders` where the account was the seller (`certificate_transferred` / `seller_paid` / `completed` — never refunded, cancelled, or in-flight).

  The self-reported count is **not** discarded: it still removes fish from the living population in the funnel, and it's shown as its own "Rehomed" tile next to "Sales", because a fish rehomed at a club or given to a friend is a real event that never touches an order. It's an assertion, not a record — so it's labelled as one. The field is named `frySoldSelfReported` and there is deliberately no bare `totalSold` on the stats object, so no future badge can reach for it by accident.

- **The grow-out chart inflated the living population.** Found while extracting the funnel math: the timeline seeded from the *egg* count and let it override a later fry count (`Math.max(eggs, fryCount)`), so the chart's "alive" line disagreed with the funnel summary printed directly above it — and it was wrong in the *normal* case, where fewer fry hatch than eggs were laid. Eggs now seed the line and the first real fry count replaces the estimate. Caught by a test asserting the two functions agree at the final point, which is precisely why they now share a module.

#### 🧱 Internal
- New `utils/growoutFunnel.js` owns the survival math, replacing **four** near-duplicate implementations (`SpawnGrowoutTracker`, `BatchGrowOutPanel`, `BreederAchievements`, `GrowOutChart`). Worse failure mode than the usual duplication: adding a checkpoint type meant editing four places, and missing one produced a *silent accounting error* rather than a crash. This is the prerequisite §9.16 needed — a `promoted` type is now a one-place change.
- New `services/breederStats.js` assembles achievement stats with each number's provenance in its name.
- 40 new tests. Documented, not silently changed: `survivalRate` remains `(fry − lost) / fry`, so an intentional cull doesn't count against survival. Every displayed number and achievement threshold is calibrated to that, so the tests pin it and the question is logged as §9.21 rather than quietly adjusted.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/utils/growoutFunnel.js` | **New.** The single survival-funnel implementation |
| `frontend/src/services/breederStats.js` | **New.** Verified (orders) vs self-reported (checkpoints) stats |
| `frontend/src/components/BreederAchievements.jsx` | Sales badges read `verifiedSales`; separate "Sales" and "Rehomed" tiles; inline Dexie scan removed |
| `frontend/src/components/SpawnGrowoutTracker.jsx` | Funnel via the shared module |
| `frontend/src/components/BatchGrowOutPanel.jsx` | Funnel via the shared module |
| `frontend/src/components/GrowOutChart.jsx` | Timeline via the shared module; egg-count seeding fixed |
| `frontend/src/__tests__/growoutFunnel.test.js` | **New.** 23 tests |
| `frontend/src/__tests__/breederStats.test.js` | **New.** 17 tests |
| `docs/BREEDER_STATE_MODEL.md` | New §7.1 (verified vs self-reported) and §7.2 (the funnel); §9.11 closed; added §9.21 |

---

## [0.10.2] — 2026-07-29

### 🧬 Breeder Tools: Entitlement Classification

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.10. Also confirms both storage migrations from 0.10.0/0.10.1 are **applied in production** — grow-out history now survives a device change, and `tokenURI` resolves to a real document for certificates registered from here on.

#### 🐛 Fixes
- **The entire Breeder Tools surface was absent from the entitlement map.** `hasEntitlement` fails **closed** for unknown keys, so every breeder capability silently read as *denied* — and, more consequentially, nothing stopped someone later attaching a `minTier` to certificate registration. Eight core capabilities are now registered as **REQUIRED**, which the existing safety-invariant test enforces: none may carry a `minTier`, and all must resolve true for a brand-new 0-XP account.

  The line drawn matches how the Breeder Terminal already treats bulk fulfillment: **doing the job on one thing is required; doing it across many at once may be earned.** `breeder_relatedness_check` is deliberately REQUIRED — the COI result is a *warning*, and withholding an inbreeding warning from a low-XP breeder would be the worst possible thing to gate.

- **Batch grow-out is now gated where it belongs.** Multi-spawn batch logging sits behind the same `bulk_management` (Abyssal) key the Breeder Terminal uses; logging a checkpoint on any single spawn stays unconditional. The guard is on the submit handler, not just the button — the entitlement is the rule, not the rendering. The table, metrics, sorting, and every per-spawn tracker remain fully usable either way, and the notice says what unlocks it *and* what already works.

- **`/app/breeder` was reachable in Casual mode with its nav pill hidden.** Left reachable on purpose: Pro vs Casual is a self-service `localStorage` preference, not a permission, and the morph flow explicitly tells breeders to bookmark `/app/breeder?section=morphs`, so redirecting would break a documented deep link. Nothing there is being withheld, so the surface now explains the mismatch and offers a one-click switch to Pro instead of hiding a working page or pretending it's locked.

#### 🧱 Internal
- 21 new tests in `breederEntitlements.test.js`, including a guard that the four core write surfaces (`MintSpecimen`, `SpawningWizard`, `SpecimenLineage`, `SpawnGrowoutTracker`) contain **no** `hasEntitlement` call at all, and that no entitlement key encodes display mode.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/entitlements.js` | Eight breeder capabilities registered as REQUIRED; documented that `bulk_management` also covers batch grow-out |
| `frontend/src/components/BatchGrowOutPanel.jsx` | Multi-spawn actions gated on `bulk_management`; guard on the submit handler; explanatory notice |
| `frontend/src/components/BreederTools.jsx` | Casual-mode notice with a switch-to-Pro action |
| `frontend/src/App.jsx` | Wires `onSwitchToPro`, persisting mode the same way the toggle does |
| `frontend/src/__tests__/breederEntitlements.test.js` | **New.** 21 tests |
| `docs/BREEDER_STATE_MODEL.md` | New §10 (entitlements and mode); §9.10 closed; migration status recorded |

---

## [0.10.1] — 2026-07-29

### 🧬 Breeder Tools: Real Certificate Metadata (No More Fabricated `tokenURI`)

Closes [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.9.

#### 🐛 Fixes
- **Every birth certificate published a fake, permanent, on-chain metadata pointer.** `AquadexManager.tokenURI(tokenId)` returns `specimens[tokenId].ipfsMetadataUri` **verbatim** — that field *is* the ERC-721 metadata claim any external wallet, explorer, or marketplace reads, and it's also emitted in the `SpecimenRegistered` event. Two invented values were being written into it:

  | Surface | Wrote | Problem |
  |---|---|---|
  | Register | `ipfs://bafybeidflm24zspeciemensample/meta.json` | A hardcoded form default — **identical on every specimen ever registered** |
  | Spawning wizard | `ipfs://bafkreispawnlogscompiledmetadata` + `Math.random()` | Invented per offspring at submit time |

  Neither is a real content identifier — both are far short of a CIDv1's 59 characters — nothing was ever pinned, and both resolved to nothing, while still costing gas for the bytes. An empty `tokenURI` is a well-understood "no metadata published" signal. A dead `ipfs://` link is an assertion that turns out to be false, permanently, on-chain.

- **The Advanced section was gated on the wrong mode.** The Metadata URI field only rendered when `casualModeActive` was true, so Pro — the one mode where a breeder might actually have a pinned document — couldn't reach it. Now shown in Pro, where it belongs, and no longer `required`.

#### 🧱 Internal
- New `services/specimenMetadata.js` is the single gate on what reaches the chain. `validateMetadataUri` accepts a plausible `ipfs://` CID or an `https://` URL, treats blank as a valid deliberate answer, and **fails to empty** for anything else — never writing an invalid value through. Both fabricated strings are on an explicit denylist so they can't return via stale form state or a copied value. `isPlausibleCid` is a shape + length check (v0: `Qm` + 44; v1: `b` + 58+), which is enough to reject hand-written placeholders.
- `buildSpecimenMetadata` replaces the two hand-rolled document shapes (the Register form's and the wizard's former `mockMetadata`) with one builder. It preserves the trait names `SpecimenDetailModal` skips by name and the `"Snapped "` prefix `utils/pdfExport.js` filters on — both were undocumented contracts between files.
- 40 new tests, including guards that neither write site contains either fabricated identifier or generates a URI at random, that the object path carries no timestamp, and that the migration's bucket name and policies match what the client actually does.

#### 📄 `tokenURI` now resolves to a real document (§9.19, resolved as option c)
Rather than stopping at "publish nothing," the metadata document is now **hosted in the existing public Supabase Storage project** (new `specimen-metadata` bucket) — chosen over IPFS because it needs no new provider, reuses the storage already serving specimen photos, and makes `tokenURI` resolve today. Stated plainly: it's centralized and mutable, so it's provenance *hosting*, not provenance *proof*. Switching to IPFS later changes only which URI `publicMetadataUri` returns.

**The publish stays off the critical path, without guessing.** Because the bucket is public and the object path is deterministic — `<owner_wallet>/<serial>.json`, no timestamp or nonce — `getPublicUrl` is a pure string operation. The final URL is knowable *before* the upload, so the correct URI can be committed on-chain while the certificate write stays local-first and fire-and-forget. That same property makes a failed upload retryable to the exact same URL, so the on-chain value never has to change. `metadataStatus` (`none` / `pending` / `published` / `failed` / `external`) tracks it, and `retryPendingMetadataPublishes` re-publishes on the next login sync.

The guard worth naming: `publicMetadataUri` returns empty when storage isn't configured. Without it, `supabaseClient`'s `placeholder.supabase.co` fallback would be written on-chain — recreating the exact bug being fixed.

Storage policies are **deliberately stricter than the sibling `specimen-photos` bucket**, which matches only the first 10 characters of the caller's address. A metadata document is the content behind an on-chain provenance claim, so a prefix collision must not be enough to overwrite someone else's; writes compare the full wallet folder. No DELETE policy exists — removing a document would turn a resolving `tokenURI` into a dead one, which is the failure this work set out to fix.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/specimenMetadata.js` | **New.** URI validation gate, the one metadata document builder, and the deterministic-path hosting + retry |
| `frontend/supabase/migrations/20260729_specimen_metadata_storage.sql` | **New.** Public JSON-only `specimen-metadata` bucket; full-wallet-scoped write/update policies; no delete |
| `frontend/src/services/relayer.js` | Resolves the certificate's URI where the serial is assigned (supplied → validated, else the hosted URL, else empty) and publishes fire-and-forget |
| `frontend/src/components/MintSpecimen.jsx` | Defaults to no URI; validates before publishing; Advanced section moved to Pro; builds the document once and passes it to the relayer |
| `frontend/src/components/SpawningWizard.jsx` | Removed the `Math.random()` identifier; each offspring gets its own hosted document |
| `frontend/src/App.jsx` | Runs the metadata retry pass after the login cloud sync |
| `frontend/src/__tests__/specimenMetadata.test.js` | **New.** 40 tests incl. the fabricated-identifier guards, path determinism, and migration/client agreement |
| `docs/BREEDER_STATE_MODEL.md` | New §4.3 (metadata URI + hosting); §9.9 and §9.19 closed; added §9.20 |

---

## [0.10.0] — 2026-07-29

### 🧬 Breeder Tools T1 — Pairing Integrity: Sex on the Certificate, One Inbreeding Engine

Implements [`docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md`](docs/BREEDER_TOOLS_T1_PAIRING_SPEC.md), closing [`BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.7 and §9.8. The Spawning wizard previously couldn't validate what it was told: it accepted pairings it had no basis to accept, then recorded a genetic claim computed with the weaker of two engines it already had available.

#### 🐛 Fixes
- **Cousin pairings were recorded as "0% Safe" on the offspring's certificates** — `SpawningWizard.calculateInbreeding` compared only the two candidates' *immediate* parents. Full siblings and parent–offspring were caught, but cousins, half-cousins, and grandparent–grandchild all fell through to `0% "Safe Lineage"` — and that number was written into each offspring's metadata as the `"Inbreeding Coefficient"` attribute, which `SpecimenDetailModal` reads back. A cousin spawn permanently stamped a false genetic claim on up to ten birth certificates. Relatedness now comes from Wright's path method over three generations (`utils/coiCalculator.js`, already used by the Genetics tab and reachable since the pedigree resolver landed in 0.9.9). The heuristic is deleted, not wrapped.
- **A `0%` that meant "we didn't look" now says so** — the old engine returned a confident zero for every case it couldn't see. A zero is only reported when there was ancestry on **both** sides to search; otherwise the result is an explicit "no pedigree data". Positive detection is always reported, so a parent–offspring pairing still shows 25% even when the parent itself is wild-caught. The recorded attribute is `"Unknown — no pedigree data"`, never `"0%"`.
- **The recorded claim is now self-describing** — `"COI Method": "Wright, 3 generations"` travels with the coefficient, so a future reader can tell a real Wright value from the old heuristic's output. Sire and dam sex are recorded too, which is what makes a pairing auditable after the fact.
- **Two males could be paired** — the Sire/Dam pickers filtered on species alone, so the wizard would register offspring from a same-sex pair. That's now the one blocking validation.
- **The Register form was the only add-a-fish surface that didn't collect sex** — so every birth certificate created there defaulted to `"Unsexed"` and the pairing tools had nothing to check against. It now has a Sex control.
- **`"Not Sure"` vs `"Unsexed"` vocabulary fork** — `TankList`'s two sex pickers wrote the literal `"Not Sure"`, a value no other writer produced, so `nurseryGrouping`, `TankInhabitants`, and `FryNursery` each special-cased both spellings. One stored vocabulary now, normalized on read — no data migration needed.
- **A species mismatch was reported *as* an inbreeding result** (`"Hybrid / Species Mismatch"` with coefficient 0). Relatedness and species compatibility are independent findings and are now reported separately.
- **Unsexed fish were displayed as female** — two specimen rows in `TankList` gated their sex chip on `spec.gender !== "Not Sure"`, which let a fish stored as `"Unsexed"` through and then fell to the `else` branch, rendering a pink **♀**. So any fish added via Register, the Spawning wizard, `FacilityTreeView`, or the E2E seeder showed a confident female marker regardless of its actual sex. Found by the source guard written for acceptance criterion 2 — neither the earlier greps nor a reading of the file had turned it up, which is a decent argument for the guard existing.

#### 🎯 The rule that shaped the design
**Unknown sex never blocks a pairing.** The obvious implementation is to filter the pickers to male × female, and it would have been wrong: most aquarium species can't be reliably sexed by eye and the overwhelming majority of existing records are `"Unsexed"`, so filtering would leave a breeder unable to record a spawn that actually happened. Candidates are **ordered, never removed** — complementary sex first, unsexed next, same-sex last but still selectable. A high COI doesn't block either; line-breeding is deliberate practice and the coefficient is information, not a gate. Both rules are pinned by test.

#### 🧱 Internal
- New `utils/specimenSex.js` — canonical vocabulary (`SEX`, `normalizeSex`, `sexLabel`, `sexSymbol`, `isKnownSex`, `SEX_OPTIONS`), the single `canPair` rule, `pairingCandidateComparator`, and `PAIRING_COPY`.
- New `services/pairingAssessment.js` — `assessPairing` composes the pedigree resolver and the COI engine into three independent signals (sex / species / relatedness) plus one `canProceed`; `pairingMetadataAttributes` builds the recorded claim.
- All new copy lives in `PAIRING_COPY` with the house `PROHIBITED_TERMS` invariant test, matching `orderCopy.test.js` / `listingFlowCopy.test.js`.
- The wizard's assessment is async now (it walks pedigrees), with a stale-result guard so changing a selection mid-flight can't apply the previous pair's answer.
- 41 new tests. The load-bearing ones are a **cousin fixture** (asserts 6.25%, the case the old engine called "Safe"), a **wild-caught × wild-caught fixture** (asserts unavailable, not `0%`), and an explicit assertion that an **unsexed pairing is not blocked**.

#### 📋 Found, logged, not fixed
`coiCalculator.getRiskLevel` bands `<= 25` as `"high"`, so a full-sibling pairing at exactly 25% is labelled "high" with a recommendation reading "equivalent to half-sibling mating". The coefficient is correct; the band edge and that one string are off by a tier. Changing the bands was out of T1's scope, so the tests assert actual behavior and it's logged as §9.18 rather than quietly adjusted.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/utils/specimenSex.js` | **New.** Vocabulary, `canPair`, candidate ordering, `PAIRING_COPY` |
| `frontend/src/services/pairingAssessment.js` | **New.** `assessPairing` + `pairingMetadataAttributes` |
| `frontend/src/components/SpawningWizard.jsx` | Deleted the heuristic; async assessment with stale guard; real COI display; self-describing metadata; sex-aware pickers and summary |
| `frontend/src/components/MintSpecimen.jsx` | Sex control on the Register form |
| `frontend/src/components/TankList.jsx` | Both sex pickers render from `SEX_OPTIONS` and stop writing `"Not Sure"`; fixed two specimen rows that rendered unsexed fish as ♀ |
| `frontend/src/components/COICalculator.jsx` | Same "no pedigree data" honesty rule and shared copy |
| `frontend/src/utils/ownedSpecimens.js` | Returns normalized `gender`; sex symbol in the picker label |
| `frontend/src/utils/nurseryGrouping.js` | Uses `normalizeSex` |
| `frontend/src/components/logbook/TankInhabitants.jsx` | Uses `isKnownSex` / `sexSymbol` |
| `frontend/src/components/FryNursery.jsx` | Uses `isKnownSex` / `sexSymbol` |
| `frontend/src/__tests__/specimenSex.test.js` | **New.** 21 tests incl. the not-blocked-when-unsexed guard and the copy invariant |
| `frontend/src/__tests__/pairingAssessment.test.js` | **New.** 20 tests incl. cousin / half-cousin / sibling / wild-caught fixtures |
| `docs/BREEDER_STATE_MODEL.md` | New sex section (§4.4); §9.7 and §9.8 closed; added §9.18 |

---

## [0.9.9] — 2026-07-29

### 🧬 Breeder Tools: Grow-Out Durability, Retirement Outcomes, and One Pedigree Resolver

Second pass of the Breeder Tools review (continues 0.9.8). Closes the surface's largest data-loss gap, stops a bulk action from recording deaths that didn't happen, and collapses two disagreeing pedigree walkers into one. Gap tracking lives in [`docs/BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) §9.

#### 🐛 Fixes
- **Grow-out history was device-local and silently lost** (§9.2) — `spawnGrowout` was the one load-bearing breeder table with no Supabase mirror. Every fry count, cull, loss, sale, and survival rate — plus the Poseidon overdue nudges and every stat and badge on the Achievements tab, all of which are *derived* from it — existed only in one browser's IndexedDB. A cache clear or a new device erased a breeder's entire production history while leaving their spawns and certificates intact, so the data looked fine and the numbers were wrong. Added the `aquadex_spawn_growout` mirror with a write path, a pull path, and a **backfill** so existing local history isn't stranded. Two design notes: the Dexie `++id` is device-scoped and therefore never used as a cloud identity (rows key on `owner_address + spawn_id + event_timestamp + type`), and base64 checkpoint photos are excluded from the payload rather than bloating every row — `has_photo` records that one existed.
- **"Retire" in the Fish Nursery recorded a death** (§9.1) — `retireFish` hard-wrote status `1` (Deceased) under copy that said "marks it inactive", so rehoming a group of fry recorded a group of deaths. Not cosmetic: those fish then read "Deceased" in every pedigree tree and skewed the grow-out survivor math. Retiring now requires picking an outcome. There is no "inactive" status in the model — the three states are Active/Deceased/Rehomed.
- **The inbreeding calculator could analyse the wrong fish** (§9.4) — `sireId`/`damId` hold *local serials*, but `COICalculator` resolved ancestors by calling `contract.specimens(serial)` **before** checking Dexie. Token ids come from a global `++totalSpecimensMinted` counter unrelated to the serial, so that call returns a real specimen — just the wrong one — with no error. `SpecimenLineage` had the correct Dexie-first order and a comment explaining exactly this hazard. The same pairing could therefore produce a correct family tree and a COI computed against unrelated ancestry.
- **Specimen photos went straight to localStorage** (§9.3) — Register and the Spawning wizard wrote raw `aquadex_specimen_photo_*` keys, sharing one ~5MB origin quota with no sync and no durability. Worst case was a spawn cohort: the same photo was written once *per offspring*, so 10 fry burned 10 copies of one image. Both now write through `putSpecimenPhoto` (durable Dexie `tankMedia`, still mirrored to localStorage so existing readers keep working), and a quota failure no longer loses the photo.
- **Farewell status changes never reached the cloud** — `TankList`'s Farewell modal wrote the new status to Dexie only, so a rehoming or memorial recorded on one device stayed there. Now mirrored, matching the nursery's behavior.

#### 🧱 Internal
- New `services/pedigree.js` is the single ancestor resolver (`fetchSpecimenNode` / `fetchPedigreeTree` / `PEDIGREE_DEPTH`), consumed by both `SpecimenLineage` and `COICalculator`. The "3 generations" badge and copy now read `PEDIGREE_DEPTH` instead of a hardcoded 3.
- `RETIREMENT_OUTCOMES` in `utils/specimenIdentity.js` is the one definition of how a fish leaves your care. `TankList`'s Farewell modal and `FryNursery`'s retire flow both render from it, so they can't drift on status value or copy.
- The shared confirm dialog gained an optional `choices` array for actions with more than one correct resolution. Additive — existing yes/no callers are untouched.
- `SpawningWizard`'s `mockMetadata` renamed to `offspringMetadata`. It was never mock data: it is written as the offspring's real persisted metadata and read back by `SpecimenDetailModal`.
- 34 new tests across `growoutCloudSync.test.js` (row shape, photo stripping, orphan handling, migration/client key agreement) and `pedigreeResolution.test.js` (which uses a contract whose token-id space deliberately collides with the local serial space, so a precedence regression fails loudly).

#### 🗑️ Removed the only path that could destroy a birth certificate (§9.15)
`TankList`'s Farewell modal offered "Released / Other — Completely delete from local registry", implemented as `db.specimens.delete`. Resolved by product decision as **a certificate is never destroyed** — this is a lineage tracker, and a certificate is referenced by `sireId`/`damId` on every descendant, by listings, by orders, and by exported pedigrees. Deleting one doesn't remove a fish from the world, it silently orphans everything downstream. It also never actually held: `pullCloudDataForWallet` re-inserts any cloud row the device is missing, so the "deleted" record came back on next login.

That option is now **"Remove from view"**, which archives. Archiving is a *visibility* concern, not a lifecycle one — for a mis-entry, a duplicate, or a fish whose fate you genuinely don't know, where recording "deceased" or "rehomed" would be a lie. It sets `archived` and detaches from the tank but **leaves `status` untouched**, and it's reversible. Archived certificates disappear from tank views, the nursery tray, and the sire/dam pickers while staying **fully resolvable by serial**, so lineage, COI, and pedigree exports all still see them and every descendant keeps a valid parent reference.

New `services/specimenLifecycle.js` is now the only writer of specimen lifecycle state (`retireSpecimens` / `archiveSpecimens` / `unarchiveSpecimens`) and deliberately exposes **no delete**. A test asserts no exported name contains delete/purge/destroy, that no lifecycle action ever calls `db.specimens.delete`, and that the pedigree resolver does *not* filter on `archived` — descendants must keep resolving.

Documented alongside it: **certificates are for individually tracked fish, cohorts are counts** (§4.2). Fish spawn in the hundreds, so eggs and fry en masse live as grow-out counts (`fry_count` / `loss` / `cull` / `sold`), not as individual records. A fry that doesn't make it is a `loss` count — there was never a certificate to retire or archive. This is why the Spawning wizard caps a spawn at 10 offspring certificates. The missing piece is a promotion path from cohort count → certificate for the keepers pulled out of a grow-out tank (§9.16, not built).

#### Modified Files
| File | Change |
|------|--------|
| `frontend/supabase/migrations/20260729_spawn_growout_sync.sql` | **New.** `aquadex_spawn_growout` table, natural-key unique index, wallet-scoped RLS (JWT claim with header fallback), append-only (no client DELETE) |
| `frontend/src/services/pedigree.js` | **New.** The single Dexie-first ancestor resolver |
| `frontend/src/services/cloudSync.js` | Grow-out write/batch/pull/backfill; drops device-scoped ids and base64 photos from the payload |
| `frontend/src/utils/specimenIdentity.js` | Added `RETIREMENT_OUTCOMES` + `retirementOutcomeLabel` |
| `frontend/src/services/specimenLifecycle.js` | **New.** The only writer of specimen lifecycle state; retire/archive/unarchive, no delete |
| `frontend/src/components/FryNursery.jsx` | Retire requires an explicit outcome; added a "just hide it" choice; excludes archived; serials via `formatCertSerial` |
| `frontend/src/components/TankList.jsx` | Confirm dialog supports `choices`; Farewell modal maps `RETIREMENT_OUTCOMES`; the delete option now archives |
| `frontend/src/utils/ownedSpecimens.js` | Excludes archived certificates from the sire/dam pickers |
| `frontend/src/__tests__/specimenLifecycle.test.js` | **New.** 21 tests, including the never-destroy invariant |
| `frontend/src/components/COICalculator.jsx` | Uses the shared resolver; dropped its contract-first copy |
| `frontend/src/components/SpecimenLineage.jsx` | Uses the shared resolver; dropped its hand-rolled tree walk |
| `frontend/src/components/SpawnGrowoutTracker.jsx` | Mirrors each checkpoint to the cloud |
| `frontend/src/components/BatchGrowOutPanel.jsx` | Mirrors batch checkpoints to the cloud |
| `frontend/src/utils/spawnNarration.js` | Poseidon narration rides the same mirror |
| `frontend/src/components/MintSpecimen.jsx` | Photo via `putSpecimenPhoto`; photo and metadata failures reported separately |
| `frontend/src/components/SpawningWizard.jsx` | Cohort photo via `putSpecimenPhoto`; `mockMetadata` → `offspringMetadata` |
| `frontend/src/__tests__/growoutCloudSync.test.js` | **New.** 17 tests |
| `frontend/src/__tests__/pedigreeResolution.test.js` | **New.** 17 tests |
| `docs/BREEDER_STATE_MODEL.md` | §7 grow-out mirror specifics; §9 statuses updated; added §9.14, §9.15 |

---

## [0.9.8] — 2026-07-29

### 🧬 Breeder Tools: Certificate Identity, Status, and Attribution

First pass of the Breeder Tools review. This surface predates the spec-driven rework of the Logbook, Marketplace, and Fish Finder, and it is the surface that *creates* the birth certificate every other surface reads — so it had drifted with no state model to hold it. Added [`docs/BREEDER_STATE_MODEL.md`](docs/BREEDER_STATE_MODEL.md) as the authoritative model and fixed the correctness bugs it exposed. The remaining gaps are enumerated in §9 of that document rather than left to be rediscovered.

#### 🐛 Fixes
- **A deceased fish displayed as "Transferred"** — `contracts/AquadexStorage.sol` declares `SpecimenStatus { Active, Deceased, Rehomed }`, and `PedigreeTree`, `BreedGallery`, and `SpecimenDetailModal` each inlined that mapping correctly. `SpawningDashboard` inlined it *wrong*, rendering `1` as "Transferred" and `2` as "Inactive" — so a fish you recorded as dead in My Aquariums read as transferred in your Breeder Tools certificate list. All four copies now come from one module.
- **Certificate serials were truncated into other real certificates** — `SpawningDashboard` formatted serials with `.toString().slice(-3)`. Since `relayMintSpecimen` assigns sequential serials, cert 1042 rendered as "042" and its sire #1007 as "007" — both of which are *different real certificates*. Serials are identity, so `formatCertSerial()` only ever pads, never truncates. Same fix applied to the spawn/tank reference ids in the Spawning Logs, Grow-Out overdue banner, and batch panel.
- **The Spawning Logs badge claimed a lifecycle that didn't exist** — It rendered Fry/**Juvenile**/**Adult**, but the model is `SpawnStatus { Egg, Fry, Raised, Failed }` and nothing ever advances the field past `Fry` anyway. Labels now name only real states. (Advancing the status from grow-out checkpoints is tracked as §9.6.)
- **Another account's fish could be claimed as parents** — `loadOwnedSpecimens()` and the Register form's tank dropdown both ended with a "beta single-device fallback" that returned *every* record in IndexedDB when nothing matched the signed-in account. On a shared browser profile, or after an account switch, one account could see and select another account's fish as a sire/dam, or file a certificate into another account's tank. Ownership is now a hard filter with no fallback — an empty picker is the correct answer, and the empty states already existed.
- **The "Breeder Account Username" Edit button could only produce an error** — In Pro mode any edit threw `"you do not have permission"` (the validation added in 0.9.x, see below), so the Edit affordance was a pure trap; in Casual mode the check was skipped entirely and the value was written to the certificate unvalidated. The Pro default also wrote the *display name* into `specimen.breeder`, which `services/relayer.js` defines as a canonical lowercase EOA. Attribution is now a derived, read-only row showing the signed-in account's display name and truncated address. Registering on behalf of another breeder needs a real permission model, not a text box.
- **Redundant metadata refetch** — The Register form re-ran its full on-chain species-catalog and tank load whenever the Reef profile name resolved or the mode toggled, neither of which affects that data.

#### 🧱 Internal
- New `utils/specimenIdentity.js` is the single source for specimen status, spawn status, certificate serial formatting, and local-record references. `services/relayer.js` now imports `SERIAL_CEILING` from it instead of redeclaring it.
- `src/__tests__/specimenIdentity.test.js` parses the Solidity enums out of `AquadexStorage.sol` and asserts the JS mirrors them ordinal-for-ordinal, so a contract change that reorders a state fails the suite. It also source-guards `SpawningDashboard` against re-inlining the mapping.
- `src/__tests__/breederOwnershipScope.test.js` pins the ownership filter, including the shared-device case, and guards the Register form against the fallback and the permission trap returning.

> Supersedes the **Breeder Ownership Validation** entry below (`"you do not have permission"`), which is removed rather than fixed: the check validated a field that should never have been editable.

#### Modified Files
| File | Change |
|------|--------|
| `docs/BREEDER_STATE_MODEL.md` | **New.** Authoritative model for specimen identity, status, spawn records, attribution, ownership scoping, and storage tiers; §9 enumerates the remaining gaps with tiers |
| `frontend/src/utils/specimenIdentity.js` | **New.** Canonical status enums, labels, tones, and non-truncating serial/reference formatters |
| `frontend/src/components/SpawningDashboard.jsx` | Fixed status labels and serial truncation; consumes the shared helpers |
| `frontend/src/utils/ownedSpecimens.js` | Ownership is a hard filter; removed the all-device fallback; empty account returns `[]` |
| `frontend/src/components/MintSpecimen.jsx` | Removed the tank-list fallback, the editable breeder field, and the permission trap; attribution derived from the session; trimmed the metadata-refetch deps |
| `frontend/src/components/GrowOutSection.jsx` | Spawn refs via `formatLocalRecordRef` |
| `frontend/src/components/BatchGrowOutPanel.jsx` | Spawn refs via `formatLocalRecordRef` |
| `frontend/src/services/relayer.js` | Imports `SERIAL_CEILING` from the shared module |
| `frontend/src/__tests__/specimenIdentity.test.js` | **New.** Enum-parity, formatting, and source guards (20 tests) |
| `frontend/src/__tests__/breederOwnershipScope.test.js` | **New.** Ownership scoping and Register-form guards (11 tests) |

---

## [0.9.7] — 2026-07-10

### 🛠️ Marketplace & XP Bug Fixes

Batch of fixes from a beta bug-bash session: a marketplace price display bug, three usability issues in the listing flow, and an XP exploit that let repeated feeding farm unlimited tier progress.

#### 🐛 Fixes
- **Marketplace price shown as 1000x actual value** — `marketplace.html`'s `ethToUSD()`/`ethToUSDRaw()` helpers were leftover from when listings were priced in ETH and multiplied the price by 1000 to fake a USD conversion. Listings have stored plain USD dollar strings for a while now, so a $50 fish was displaying as $50,000. Removed the multiplier.
- **Listing drawer couldn't be scrolled** — `.modal-inner-card` (the shared base style for every modal, including the "List Specimen for Sale" / "List Fry Batch" drawers reachable from both the Marketplace tab and each tank's "Sell" action) used `overflow: hidden`, clipping tall form content above the ~640px mobile breakpoint (which had its own `!important` override). Changed to `overflow-y: auto`.
- **Serial number entry required memorizing a certificate number** — Replaced the raw "Certificate Serial No." text input in the listing flow with a picker listing the seller's own active specimens (photo, name, cert #), so sellers tap the fish instead of typing its serial from memory. Manual entry kept as a fallback.
- **Flat "Shipping Fee" field was dead weight (and misleading)** — Shipping is buyer-paid and quoted live at checkout via ShipEngine (`ShippingRateModal` / `services/shipping.js`); the flat dollar amount sellers set when listing was never actually charged to buyers. Removed the input from the list/edit/batch listing forms and the misleading `🚚 Shipping (+$X.XX)` card badge that displayed it.
- **"Listed by" showed a raw wallet address in Pro mode** — Added a `SellerName` resolver (Supabase Reef profile → local Dexie mirror → deterministic fish-themed alias) so the marketplace listing card and the "consolidated pickup" banner show a human-readable name instead of `0x4a85…a6d3`.
- **XP could be farmed to unlimited tier progress by spam-clicking "Feed"** — Every quick-action handler (Feed, Water Change, Scrape Algae, Water Test, and the batch/bulk logging panels) called `addXp()` directly *in addition to* writing an `actionLogs` entry, which independently triggers a Dexie hook that also awards XP for the same action — a silent double-award with **no cooldown** on the direct path. A full cooldown system already existed (`utils/xpCooldowns.js`, a dedicated `xpCooldowns` Dexie table, per-tank cooldown windows matching the spec) but was never wired into anything. Removed the redundant `addXp()` calls (XP now comes exclusively from the Dexie hook) and wired `enforceXpCooldown()` into that hook so repeat actions on the same tank within the cooldown window are logged but earn no XP. Also fixed a couple of `actionType` string mismatches (batch panel logged `"Fed"` instead of `"Feed"`; bulk rack logging used labels the hook didn't recognize) that were silently awarding zero real XP despite the success toast claiming otherwise.
- **Corrupted activity-log dates (e.g. "9/2/58471")** — The batch Quick Log panel stored `Date.now()` (milliseconds) as the log timestamp, while every other writer stores seconds and the Parameter History view always renders `timestamp * 1000`. Fixed the panel to store seconds like everywhere else.

#### Modified Files
| File | Change |
|------|--------|
| `frontend/marketplace.html` | Fixed the 1000x price multiplier in `ethToUSD()`/`ethToUSDRaw()` |
| `frontend/src/styles/index.css` | `.modal-inner-card` overflow fix for scrollable listing drawers |
| `frontend/src/components/ListSpecimenModal.jsx` | Owned-specimen picker instead of manual serial entry; removed flat shipping fee input |
| `frontend/src/components/BatchListingWizard.jsx` | Removed flat shipping fee input (fry batch listings) |
| `frontend/src/components/EditListingModal.jsx` | Removed flat shipping fee input (edit listing) |
| `frontend/src/components/MarketplaceBoard.jsx` | Added `SellerName` resolver; fixed misleading shipping fee badge |
| `frontend/src/hooks/useXPSync.js` | Wired `enforceXpCooldown()` into the `actionLogs` XP-award hook |
| `frontend/src/components/TankList.jsx` | Removed redundant `addXp()` calls from quick-action handlers; cooldown-aware toasts |
| `frontend/src/components/QuickLogPanel.jsx` | Fixed timestamp unit bug (ms → s); fixed `"Fed"` → `"Feed"` actionType mismatch |

---

## [0.9.6] — 2026-07-09

### 🔔 Retention System: Real Push Notifications, Email, and Analytics

Fixed several silently-broken pieces of the notification stack (some had been failing on every run since deployment) and built out a full retention system on top: transactional/retention email via Resend, product analytics via PostHog, and a daily job that reaches out to at-risk and inactive users.

#### 🐛 Critical Fixes (Production Bugs Found and Fixed)
- **`app.settings.supabase_url` / `service_role_key` were never configured** — Every `pg_net`-backed Postgres trigger and `pg_cron` job that reads these settings (`orders` table → `order-notifications`, plus the `tide-lifecycle`, `reef-digest`, `breeder-summary`, `anti-gaming`, and `distribute-rewards` cron jobs) had been failing on **every single run** since they were created, confirmed via `cron.job_run_details` showing a 100% failure rate with `unrecognized configuration parameter`. Hosted Supabase doesn't allow `ALTER DATABASE ... SET` on custom GUCs, so the values were moved into **Supabase Vault** (`vault.create_secret`) and every trigger/cron job now reads from `vault.decrypted_secrets` instead. Verified live: all jobs now succeed, marketplace order notifications fire, and `breeder-summary` completed a real batch update on first successful run.
- **`send-push` Edge Function never actually delivered push notifications** — Two separate bugs: VAPID JWT signing used an invalid `"raw"` key-import format (Web Crypto only supports `"raw"` for EC *public* keys, not private), and the encrypted payload was never attached to the outgoing request (it POSTed with `Content-Length: 0`). Rewrote the function with correct JWK-based VAPID signing and full RFC 8291 (`aes128gcm`) payload encryption (ECDH P-256 + HKDF-SHA256 + AES-128-GCM) using only Web Crypto — no `web-push` npm dependency (which doesn't work reliably under Deno). Verified end-to-end against Google's real FCM endpoint using a synthetic subscription.
- **`echo-nudge` and `echo-personality-drift` Edge Functions were fully written but never deployed** — deployed both and scheduled via `pg_cron` (echo-nudge every 4 hours, personality-drift weekly).
- **No UI ever called `subscribeToPush()`** — a complete push/email notification preferences panel (`SonarPreferences.jsx`) already existed but was only reachable from The Reef's inbox panel. Surfaced it directly in the main Settings tab (`DataPortabilityWidget.jsx`).

#### New Features
- **Resend email integration** — `_lib/resend.js` helper (raw REST, no SDK) with branded HTML templates: streak-risk nudge, inactivity win-back, and weekly digest fallback.
- **Daily retention job** (`/api/retention`, Vercel Cron once/day) — finds streak-at-risk users (streak active, no action since yesterday) and inactive users at fixed 3/7/14-day touchpoints, and reaches out via both push and email. Respects a new `notification_preferences.retentionEmail` opt-out.
- **PostHog product analytics** — client wrapper (`services/analytics.js`) tracking `signup`, `login`, `tank_created`, `xp_earned` (via the existing app-wide `aquadex_xp_added` event), `notification_opt_in`, and `marketplace_purchase` (both crypto and fiat paths — fiat captured server-side from the Stripe webhook since that flow redirects through a static page outside the React bundle).
- **Email capture from Privy** — `AuthContext.jsx` now mirrors the user's Privy-linked email (`user.email.address` or `user.google.email`) onto `profiles.email` on login, so retention email actually has an address to send to.
- **Auto-recovery from stale PWA shells** — `chunkErrorRecovery.js` detects "stale shell" failures (an already-installed PWA/desktop window serving a cached `app.html` that references a hashed JS chunk from a previous deployment, which 404s after a new deploy ships) and automatically unregisters the stale service worker and force-reloads. Wired into global error handlers plus both `ErrorBoundary` and `TabErrorBoundary`. `PwaManager` now also actively checks for service worker updates on window focus, tab visibility change, and every 30 minutes, instead of only relying on the browser's own update schedule.

#### Schema
- `profiles.email` column added (indexed), plus `notification_preferences` backfilled to a full default shape (per-category push toggles, quiet hours, email digest frequency, `retentionEmail`) for all existing rows and set as the column default for new ones.

#### New Files
| File | Purpose |
|------|---------|
| `frontend/api/_lib/resend.js` | Resend email helper + templates (streak-risk, win-back, weekly digest) |
| `frontend/api/_lib/posthogServer.js` | Server-side PostHog capture (raw HTTP, no SDK) for the Stripe webhook path |
| `frontend/api/retention.js` | Daily retention cron endpoint (push + email to streak-risk/inactive users) |
| `frontend/src/services/analytics.js` | Client-side PostHog wrapper (init/identify/capture, no-ops if unconfigured) |
| `frontend/src/utils/chunkErrorRecovery.js` | Detects and auto-recovers from stale-shell chunk load failures |
| `supabase/migrations/20260709_fix_pg_net_vault_settings.sql` | Repoints the orders trigger + 5 cron jobs at Supabase Vault instead of the nonfunctional `app.settings.*` GUCs |
| `supabase/migrations/20260709_schedule_echo_functions.sql` | Deploys/schedules `echo-nudge` (4hr) and `echo-personality-drift` (weekly) |
| `supabase/migrations/20260709_profile_email_and_notification_defaults.sql` | Adds `profiles.email`; backfills `notification_preferences` defaults |

#### Modified Files
| File | Change |
|------|--------|
| `supabase/functions/send-push/index.ts` | Correct VAPID JWK import + full RFC 8291 payload encryption |
| `frontend/api/stripe.js` | Fires `marketplace_purchase` PostHog event on fiat settlement |
| `frontend/src/App.jsx` | Global `aquadex_xp_added` listener → `xp_earned` analytics event |
| `frontend/src/main.jsx` | Initializes PostHog and installs chunk-error recovery at boot |
| `frontend/src/contexts/AuthContext.jsx` | Email capture from Privy; PostHog identify/reset on login/logout |
| `frontend/src/components/DataPortabilityWidget.jsx` | Surfaces `SonarPreferences` (push/email settings) in the main Settings tab |
| `frontend/src/components/reef/SonarPreferences.jsx` | Fires `notification_opt_in` analytics event on push/email opt-in |
| `frontend/src/services/relayer.js` | Fires `tank_created` and `marketplace_purchase` (crypto) analytics events |
| `frontend/src/components/ErrorBoundary.jsx` / `TabErrorBoundary.jsx` | Auto-recover from stale-chunk errors instead of showing the fallback UI |
| `frontend/src/components/PwaManager.jsx` | Actively polls for service worker updates (focus/visibility/30min interval) |
| `frontend/vercel.json` | Added daily cron entry for `/api/retention` |
| `frontend/package.json` | Added `posthog-js@1.399.1` (pinned) |
| `.env.example`, `frontend/.env` | Added `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `CRON_SECRET` |

#### Known Gaps (Deferred)
- Static marketing pages (`index.html`, `marketplace.html`, etc. — separate Vite entries outside the React app bundle) are not instrumented with PostHog; only the `app.html` React app is.
- Real end-to-end push delivery is unverified against a live user subscription (none existed before this session, since no UI ever called `subscribeToPush()`); the encryption/delivery pipeline itself was verified against Google's live FCM endpoint using a synthetic subscription.

---

## [0.9.5] — 2026-07-07

### 🧬 Functional Lineage + On-Chain Reconciliation Readiness

Made the Pro-mode Breeder "Lineage" tab actually work, and laid the groundwork for a clean migration to fully on-chain specimens.

#### Lineage / Breeder Tools Fixes
- **Sequential serial numbers** — Specimen IDs are now generated as clean, sequential serials (`001`, `002`, …) instead of `Date.now()` timestamps. This was the root cause of the "random number" family tree: 13-digit timestamp IDs never matched the small serials the UI displayed or the sire/dam references users entered, so the ancestry tree always came back empty. Legacy timestamp IDs are ignored when computing the next serial, so old test data can't collide with or inflate new serials.
- **Parent pickers** — The Sire/Dam fields in Register Birth Certificate are now dropdowns of the breeder's actual registered specimens (e.g. `Cert. 001 — Neon Tetra [tag]`). Selecting a parent stores the correct ID automatically, so parentage always links instead of relying on hand-typed serials.
- **Lineage lookup picker** — The Ancestry Family Tree Lookup gained a "pick one of your specimens" dropdown that generates the tree on selection, with the manual serial box kept as a fallback.
- **Grandparent bug fix** — Fixed a guard in the pedigree walk where the maternal-grandfather node was gated by `damNode.damId` instead of `damNode.sireId`, causing it to intermittently drop out of the tree.

#### On-Chain Reconciliation Foundation (prep for full on-chain)
- **ID-mapping schema (Dexie v21)** — Added `onChainId`, `chainStatus` (`local` | `pending` | `synced` | `failed`), and `txHash` to specimen records. Additive and non-destructive; existing rows read as `local`. The local serial (`id`) remains the stable client-side reference key; the authoritative ERC-721 token id lives in `onChainId` once a mint confirms.
- **Shared ID resolver** — New helper centralizes translation between local refs and on-chain token ids so no other code assumes `id === tokenId` (the contract assigns `++totalSpecimensMinted`, a global counter that can't be predicted client-side).
- **Token-id capture** — When a batched UserOperation settles, the relayer parses `SpecimenRegistered` events and writes the real token id back onto each local record. Mapping is positional (contract assigns ids in call order) and only applied when event count matches mint count, so a batched spawn can't cause a mis-map; unmatched records stay `pending` for backfill. Batch failures mark mints `failed`.
- **Lineage nodes carry sync state** — Pedigree nodes now expose `onChainId`/`chainStatus` from both contract and local sources, so the UI can surface on-chain status and prefer the token id once available.

#### New Files
| File | Purpose |
|------|---------|
| `frontend/src/utils/ownedSpecimens.js` | Local-first loader + label helper for specimen pickers |
| `frontend/src/utils/specimenIds.js` | Local-ref ↔ on-chain token-id resolver and chain-status helpers |

#### Modified Files
| File | Change |
|------|--------|
| `frontend/src/services/relayer.js` | Sequential serial generation; specimen records seeded with `onChainId`/`chainStatus`/`txHash`; queue metadata + `reconcileMintedTokenIds` to capture on-chain token ids |
| `frontend/src/components/MintSpecimen.jsx` | Sire/Dam number inputs replaced with specimen pickers |
| `frontend/src/components/SpecimenLineage.jsx` | Specimen picker for lookup; grandparent guard fix; nodes carry `onChainId`/`chainStatus` |
| `frontend/src/db.js` | Dexie v21 schema (specimen on-chain reconciliation fields) |

#### ⛓️ Recommendations for Full On-Chain Cutover (not yet implemented)
These are the remaining steps to migrate specimens from local-first to fully on-chain, deliberately deferred as they are behavioral rather than foundational:
- **Parent-ref translation + topological flush** — Before submitting a child mint on-chain, translate its local `sireId`/`damId` to the parents' confirmed `onChainId`, and defer children until their parents are `synced` (the contract reverts with `SireNotFound`/`DamNotFound` if a parent isn't on-chain yet). Flush in dependency waves, roots first.
- **One-time backfill** — Topologically sort existing local-only specimens, submit roots, record `onChainId` on confirmation, translate the next wave's parent refs, repeat until drained.
- **`clientRef` contract change (redeploy)** — Add an optional external reference to `mintSpecimen` plus a `mapping(bytes32 => uint256) refToTokenId` guard, and emit the ref in `SpecimenRegistered`. This makes correlation trivial (no positional matching, even in batches) and mints idempotent (retries can't double-mint).
- **Display rule** — Show the local serial with a "pending" badge until synced, then present the on-chain token id as the canonical Cert. Serial No.
- **Global counter caveat** — On-chain ids are assigned from a contract-global counter across all users and can never be predicted client-side; always treat the token id as assigned-on-confirmation and reconcile via the mapping layer.

---

## [0.9.4] — 2026-06-20

### 🔱 Global Poseidon AI Chat Widget

Poseidon is now accessible from anywhere on the site via a floating action button. Talk to the AI assistant without leaving your current page — with session memory, mobile-optimized UX, and smart navigation links.

#### New Features
- **Global FAB** — Floating "Poseidon" button (bottom-right) opens a slide-up glassmorphic chat drawer. Works on every tab.
- **Conversation persistence** — Chat history stored in sessionStorage, survives page navigation within the same session. Auto-expires after 30 minutes of inactivity.
- **Mobile pill mode** — On small screens (≤480px), a compact pill previews the last Poseidon response above the FAB. Tap to expand, dismiss with ×.
- **Deep-link detection** — Species names in AI responses (50+ common freshwater fish) render as clickable green links → navigate to gallery with search pre-filled. Navigation intents ("check the marketplace") become blue action links that switch tabs.
- **Context-aware suggestions** — Quick-tap suggestion chips adapt based on the active dashboard tab (tanks → water params, breeder → spawning tips, marketplace → pricing help).
- **Echo integration** — Poseidon responses with echo reactions dispatch `poseidon:echo-reaction` events for the companion fish entity.

#### New Files
| File | Purpose |
|------|---------|
| `PoseidonGlobalWidget.jsx` | Main widget component: FAB, panel, messages, pill, suggestions |
| `poseidonDeepLinks.js` | Utility: parses AI text for species names and nav intents |

#### Modified Files
| File | Change |
|------|--------|
| `usePoseidon.js` | Added sessionStorage persistence (save/restore/expire), `persistKey` option |
| `App.jsx` | Renders global widget, added `poseidon:navigate` event listener for deep-links |
| `index.css` | Full widget CSS: FAB animations, panel glassmorphism, pill, deep-link styles, responsive breakpoints |

---

## [0.9.3] — 2026-06-20

### 🚚 Post-Purchase Arrival Flow

Adds a complete lifecycle layer between marketplace purchase and tank assignment. Fish now enter a "transit" state after purchase, and users are guided through a structured arrival flow to assign them to a tank when they're home — merging with the existing shipping confirmation for zero extra steps.

#### New Features
- **Incoming Fish section** — New nav tab appears when specimens are in transit. Shows individual fish and batch orders with purchase type badges, seller info, and relative timestamps. Hides automatically when empty.
- **Arrival Modal** — Unified confirmation flow for all purchase types (shipping, in-person, instant, fiat). Handles tank selection, optional acclimation notes, and XP awards in one action.
- **Merged shipping confirmation** — "Release Funds" for buyers now opens the Arrival Modal, combining escrow release + tank assignment into a single step. Sellers retain the original direct-release behavior.
- **Smart tank defaults** — Single-tank users get auto-assignment with a toast (zero friction). Multi-tank users see a sorted selector with the most recently interacted tank suggested.
- **Acclimation notes** — Optional free-text field (500 chars) during arrival for recording acclimation protocol. Persona-aware placeholders.
- **Nudge system** — Non-blocking badge + banner when fish have been in transit past threshold (7 days for shipping, 48 hours for in-person/instant). Dismissible for 7 days. Startup toast (24h cooldown).
- **Batch arrival** — Batch juvenile orders can be marked as arrived and assigned to a grow-out tank. The tank view shows pending fry counts.
- **Transit metadata** — Purchases now write `arrivalStatus`, `purchasedAt`, and `purchaseType` on specimen records for lifecycle tracking.

#### New Components
| Component | Purpose |
|-----------|---------|
| `TankSelector.jsx` | Reusable tank picker with type icons, MRU ordering, suggested badge |
| `AcclimationNotes.jsx` | Persona-aware textarea with character counter |
| `ArrivalModal.jsx` | Shared modal for all arrival confirmations |
| `IncomingSpecimens.jsx` | Transit view with IncomingCard + IncomingBatchCard |
| `IncomingBadge.jsx` | Nav badge with pulse animation on nudge |
| `useArrivalNudge.js` | Hook for incoming count, nudge state, startup toast |
| `arrivalNudge.js` | Utility: threshold logic, relative time, purchase type labels |

#### Modified Files
| File | Change |
|------|--------|
| `db.js` | Version 16: compound index `[ownerAddress+arrivalStatus]`, `assignedTankId` index on marketOrders |
| `xp.js` | Added `ARRIVAL_CONFIRMED` (25pts) and `BATCH_ARRIVAL_CONFIRMED` (15pts) |
| `relayer.js` | `relayPurchaseSpecimen` writes transit metadata; `relaySettleHandshake` supports in-person transit |
| `CheckoutSummary.jsx` | Buyer "Release Funds" opens ArrivalModal (merged flow) |
| `useUserTanks.js` | Batch order reconciliation — injects fry placeholders into tank specimens |
| `App.jsx` | "Incoming" nav tab, badge, startup nudge toast |
| `index.css` | `@keyframes incomingPulse` |

#### XP Awards
- Specimen arrival confirmed: +25 pts
- Batch arrival confirmed: +15 pts

---

## [0.9.2] — 2026-06-20

### 🐠 Echo Companion: Progression Wiring Fix

Fixes critical disconnect where Echo's companion widget wasn't receiving real-time XP updates from direct `addXp()` calls (minting, checkout, handshakes), and wires real user state into the whisper/nudge system.

#### Bug Fixes
- **XP → Dexie bridge** — `addXp()` (localStorage-only) events now get routed through `useXPSync` to update Dexie's `userProfile.totalXp`, `breederCompanion.eggState`, and `currentTier`. Previously, minting a specimen or completing a checkout wouldn't update Echo's widget until a separate care action triggered the Dexie path.
- **EchoWhispers real state** — Replaced hardcoded `streakDays: 0`, `lastActiveDate: null`, `currentTier: "Shallow"`, and empty `tankData` with actual values from Dexie. Streak encouragement, care reminders, and progress nudges now fire correctly.
- **Tier-up joyful mood** — Echo now enters "joyful" mood for 10 seconds when the user reaches a new tier, instead of `justLeveledUp` always being `false`.

#### Files Changed
| File | Change |
|------|--------|
| `src/hooks/useXPSync.js` | Added bridge listener for external `aquadex_xp_added` events; tagged own dispatches with `_dexieSynced` flag |
| `src/App.jsx` | Added `db` import, `echoUserState`/`echoTankData` state from Dexie, passed to `EchoWhispers` |
| `src/components/EchoCompanionWidget.jsx` | Added `justLeveledUp` state, wired tier-change detection from XP events into mood calculation |

---

## [0.9.1] — 2026-06-20

### 🛡️ Beta Readiness: Security Hardening & Platform Polish

Full security audit and UX polish pass to prepare for closed beta launch.

#### Security Fixes
- **CORS lockdown** — All API endpoints now restricted to allowed origins (aquacellum.com, aquadex.fish, Vercel previews, localhost). Created shared `_lib/cors.js` utility.
- **Rate limiting** — Added sliding-window rate limiter (`_lib/rateLimiter.js`). Relay endpoint: 50 tx/hr per user. Poseidon AI: 30 queries/hr per IP. Returns proper 429 + `X-RateLimit-*` headers.
- **Privy auth verified** — Confirmed `verifyPrivyToken.js` has proper JWKS-based JWT verification against Privy's endpoint.

#### New Features
- **Feedback Widget** — Floating "Feedback" button opens modal with category selector (Bug/Feature/UX/Other), textarea, optional screenshot upload. Stores to Supabase `beta_feedback` table + sends Discord webhook notification in real-time.
- **"What's New" Modal** — Version-gated changelog popup shows curated user-facing changes on app update.
- **Cloud Sync Toast** — Non-blocking notification on sync failure with Retry button. Auto-clears on success.
- **Last Synced Timestamp** — Footer shows "☁️ Last synced: X min ago" to reassure offline-first users.
- **Reset Local Data** — Two-step confirmation button in Settings to purge Dexie + localStorage for stuck accounts.
- **Tank Archive + Confirmation** — "Archive this tank" with specimen count warning and two-step confirm.
- **Poseidon Action Confirmation** — AI actions now require user confirmation before executing (Confirm/Skip bar).
- **Poseidon Quick Action Chips** — Suggestion buttons (Log Feeding, Water Test, Check Compatibility, Suggest Fish) shown below chat input for new conversations.
- **Species Count Chip** — Shows `🐠 X species` in the XP header bar.

#### UX Improvements
- **BetaBanner expanded** — Now includes "Known Beta Limitations" dropdown (data privacy, XP client-side, sponsor wallet, resets, AI accuracy). Auto-expands for first 3 sessions.
- **Geolocation deferred** — No more surprise permission prompt on marketplace mount. Triggered only on map interaction.
- **Catalog sync cap reduced** — Onboarding hold cap lowered from 8s → 4s for faster mobile experience.
- **Water param pre-fill** — Form now pulls all 5 params from last reading + "Same as last time" one-tap button.
- **Haptic feedback** — `navigator.vibrate(50)` on XP toasts, stronger pattern `[50, 30, 80]` on level-ups.
- **Echo egg wobble** — Subtle CSS wiggle animation (4s cycle) during pre-hatch state. Tooltip: "Something's stirring inside..."
- **WebXR error boundary** — Improved fallback with device compatibility guidance, "Try Again" and "Go Back" buttons.

#### Files Changed
| Area | Files |
|------|-------|
| API Security | `_lib/cors.js` (new), `_lib/rateLimiter.js` (new), all 9 API endpoints |
| Frontend Components | `FeedbackWidget.jsx` (new), `WhatsNewModal.jsx` (new), `BetaBanner.jsx`, `PoseidonChatConsole.jsx`, `TankList.jsx`, `MarketplaceBoard.jsx`, `DataPortabilityWidget.jsx`, `OnboardingWizard.jsx` |
| Reef/WebXR | `ImmersiveReef.jsx` |
| App Shell | `App.jsx` |
| Styles | `index.css` (eggWobble keyframe) |
| Config | `frontend/.env` (Discord webhook) |

---

## [Unreleased] — 2026-06-19

### 💳 Stripe Sandbox Integration & Fiat Payment Pipeline

Wired up a new Stripe sandbox account for end-to-end fiat purchases. Configured webhook events, environment variables, and verified the on-chain settlement flow.

#### What Was Done
- Configured new Stripe test keys (`pk_test_51Tk2WQ...` / `sk_test_51Tk2WQ...`) across local `.env` and Vercel environment variables.
- Set up webhook endpoint at `https://aquacellum.com/api/stripe-webhook` listening for `payment_intent.succeeded`, `charge.dispute.created`, and `account.updated`.
- Added `stripe` package (v17.7.0) to frontend dependencies for serverless function use.
- Shelved 3 livestream API routes (`tank-cam-setup`, `tank-cams`, `tide-stream-setup`) to `api/_shelved/` to stay under Vercel Hobby's 12-function limit.
- Added `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to Vercel for server-side API routes.

#### Files Changed
| File | Change |
|------|--------|
| `frontend/.env` | Updated Stripe keys, added server-side Supabase vars, updated marketplace address |
| `frontend/api/stripe-webhook.js` | Hardened module initialization (try-catch Stripe SDK, flexible body parsing) |
| `frontend/api/_shelved/` | Moved tank-cam-setup.js, tank-cams.js, tide-stream-setup.js |
| `frontend/package.json` | Added `stripe@17.7.0` dependency |

---

### 🔗 AquadexMarketplace v2 Deployment (Fiat Settlement)

Redeployed the marketplace contract with `purchaseSpecimenFiat`, `purchaseShippingFiat`, `purchaseBatchFiat`, and `purchaseMultipleFiat` functions. The old contract lacked these — they were written after the May 29 deployment.

#### New Contract
- **Address**: `0x9E9ca82766ce0B36c88aF1eDc093d4e01826BBBf` (Base Sepolia)
  - **⚠️ Superseded (2026-07-08):** a later redeploy moved the marketplace to `0xEC4d21Aa32c6c378Ba43E6d9038e93A9702177BF`. The canonical, live address is always whatever `deployed-addresses-sepolia.json` reports — treat this historical entry as a record of the first fiat-enabled v2, not the current address.
- **Old (deprecated)**: `0x16168B514144e0380610b78d904a4de51ba03Ca3`
- **Verified**: `purchaseSpecimenFiat()` successfully transferred Token #5 from marketplace escrow to buyer, deactivated listing, and recorded the Stripe payment hash.
- **TX**: [0x2317bb58...](https://sepolia.basescan.org/tx/0x2317bb5892c3485335b24c4aa9fe3bf2789de8cce9e7fcab8aad8a9d697b349c)

#### Setup Completed
- `FIAT_RELAYER_ROLE` granted to deployer wallet.
- `setApprovalForAll` called on AquadexManager for new marketplace.
- Token #5 recovered from old marketplace escrow and re-listed.
- `MARKETPLACE_ADDRESS` and `VITE_MARKETPLACE_ADDRESS` updated on Vercel.

#### Files Changed
| File | Change |
|------|--------|
| `deployed-addresses-sepolia.json` | Updated to new marketplace address |
| `scripts/deploy-marketplace-v2.js` | New deployment script (Hardhat v3) |
| `scripts/setup-new-marketplace.js` | Post-deploy role/listing setup |
| `scripts/settle-fiat-direct.js` | Direct on-chain E2E test script |
| `scripts/grant-relayer-role.js` | FIAT_RELAYER_ROLE grant utility |
| `scripts/preflight-stripe-test.js` | Pre-flight checklist for Stripe E2E |
| `scripts/simulate-webhook.js` | Webhook simulation for testing |

---

### 📱 Cross-Device XP Sync

Fixed XP not syncing between desktop and mobile. XP was stored locally in IndexedDB (Dexie) per device with no cloud persistence for the `userProfile` table.

#### Root Cause
- `cloudSync.js` synced tanks, specimens, and action logs — but explicitly skipped `userProfile` and `breederCompanion`.
- Desktop accumulated 1581 XP locally; mobile started fresh at 0.

#### Fix
- Created `user_xp_profiles` table in Supabase (wallet_address PK, total_xp, current_tier, streak_days, etc.).
- Added `syncXpProfileToCloud()` — fire-and-forget upsert on every XP award.
- Added `pullXpProfileFromCloud()` — called on login, uses "highest wins" merge (cloud XP never decreases local).
- Wired into `pullCloudDataForWallet()` so XP restores automatically on any new device.
- Wired into `useXPSync` hook so every XP award pushes to cloud immediately.

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/services/cloudSync.js` | Added `syncXpProfileToCloud()`, `pullXpProfileFromCloud()`, XP pull in login flow |
| `frontend/src/hooks/useXPSync.js` | Added cloud sync call after XP transaction completes |

---

## [Unreleased] — 2026-06-18

### 🔐 Per-User Smart Wallet Derivation (Critical Bug Fix)

Fixed a critical bug where **all users shared the same Coinbase Smart Wallet address** (`0x53d3c6F4F11b0B08bC1A5034bBCe7d46198b6851`). The smart wallet was being derived from a hardcoded sponsor private key instead of each user's Privy embedded wallet (EOA).

#### Symptoms
- All marketplace listings showed the same seller address regardless of who listed them.
- New users saw the project owner's smart wallet as their own.
- Listings created by other users didn't display correctly in filtered views.

#### Root Cause
`smartAccountClient.js` → `getClientsForSigner()` always used `SPONSOR_PRIVATE_KEY` as the owner in `toCoinbaseSmartAccount()`, ignoring the actual logged-in user.

#### Fix
- Each user now gets their **own unique Coinbase Smart Wallet** derived from their Privy embedded wallet's EIP-1193 provider.
- Added `setUserSigner()` / `clearUserSigner()` lifecycle — called by `AuthContext` when the user's wallet becomes available or on logout.
- Sponsor key is now **only** used as a fallback for pre-login / read-only operations.
- Smart wallet address in `DataPortabilityWidget` now refreshes reactively when the user logs in.

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/services/smartAccountClient.js` | Rewrote wallet derivation to use per-user EIP-1193 provider; added `setUserSigner`, `clearUserSigner`, `hasUserSigner` exports |
| `frontend/src/contexts/AuthContext.jsx` | Registers user signer on wallet availability; clears on disconnect |
| `frontend/src/components/DataPortabilityWidget.jsx` | Smart wallet address effect now depends on `[account]` instead of `[]` |

---

### 🏆 Unified Gamification System (Phases 1–5)

Complete gamification overhaul — unified XP pool, zone leaderboards, loyalty rewards, and anti-gaming enforcement.

#### Phase 1: Unified XP Pool
- **Single `totalXp` pool** replaces the split `prestigeXp` + `hobbyistXp` fields. One number, two lenses.
- **Canonical 5-tier ladder**: Shallow (0–1,499) → Coastal (1,500–2,499) → Pelagic (2,500–4,999) → Abyssal (5,000–9,999) → Hadal (10,000+).
- **Mode-aware labels**: "Loyalty Points" / "pts" in casual mode, "Reputation XP" / "XP" in pro mode.
- **XP_ACTIONS expanded**: 21 defined actions with point values, cooldown metadata, and daily limits per spec.
- **Dexie v15 migration**: Sums legacy fields into `totalXp`, adds `xpCooldowns` table for anti-gaming.
- **`xpCooldowns.js` utility**: Per-tank cooldowns, daily maximums, `enforceXpCooldown()` before awarding.

#### Phase 2: Zone Leaderboard
- **Adaptive-density zones**: 27 pre-defined metro regions (10–18mi radius) + sparse default (25mi). `zoneHash.js` calculates deterministic zone from coordinates.
- **Supabase schema**: `zones` table, `xp_events` audit trail, `zone_leaderboard` materialized view (refreshes every 5min).
- **Zone champion evaluation**: Only one God-Tier per zone. Server-side promotion/demotion with notifications.
- **`ZoneLeaderboardWidget.jsx`**: Dashboard sidebar widget with top 5, user rank, cross-zone browser, champion callout.
- **`ZoneAssignmentFlow.jsx`**: Multi-step location permission UX (intro → detect → confirm → assign) with 90-day transfer cooldown.
- **Settings integration**: "Zone & Location" section added to Settings tab.

#### Phase 3: Loyalty Rewards Pool
- **40% of 4% protocol fee** flows into the pool on every marketplace transaction.
- **Monthly distribution**: Proportional to XP earned that month. Eligibility: 500+ total XP + marketplace activity in 90d.
- **Credit transactions**: Full earn/spend/expire audit trail. Credits expire after 12 months.
- **Tier-based marketplace discounts**: Coastal 2%, Pelagic 4%, Abyssal 6%, Hadal 8% — applied at checkout.
- **`RewardCreditsCard.jsx`**: Dashboard widget showing balance, tier discount badge, next distribution countdown, transaction history.
- **Checkout integration**: Toggle to apply credits + tier discount breakdown in `CheckoutSummary.jsx`.
- **`distribute-rewards` Edge Function**: Monthly cron — expires old credits, runs distribution, refreshes views, sends notifications.

#### Phase 4: Anti-Gaming & Server-Side Validation
- **`validate-xp-event` Edge Function**: Server-side enforcement — validates action types, checks per-tank cooldowns, daily limits, streak multiplier (7d → 1.5x), expo multiplier (2x).
- **XP sync to Supabase**: `useXPSync.js` now fires-and-forgets `logXpEvent()` after local XP award. `mapReasonToActionKey()` translates free-text labels to action codes.

#### Phase 5: Weekly Contributors & Badge Refinement
- **Weekly contributors board**: `DiscoveryPanel.jsx` now pulls from `weekly_contributors` materialized view (shows weekly XP + action counts). Falls back to manual Insights + Audits query.
- **25 achievement badges**: Replaced old tier names (Bronze/Silver/Gold/Master/God-Tier) with canonical (Coastal/Pelagic/Abyssal/Hadal). Added: zone_champion, expo_attendee, challenge_victor, care_streak_30, care_streak_90, weekly_contributor, xp_10000 (Deep Sea Legend).

#### Files Created (New)
| File | Purpose |
|------|---------|
| `docs/GAMIFICATION_SPEC.md` | Single source of truth for the gamification system |
| `frontend/src/utils/xpCooldowns.js` | Anti-gaming cooldown enforcement |
| `frontend/src/utils/zoneHash.js` | Adaptive zone calculation from coordinates |
| `frontend/src/services/zoneLeaderboardApi.js` | Zone leaderboard Supabase queries |
| `frontend/src/services/rewardsPoolApi.js` | Rewards pool credit/checkout queries |
| `frontend/src/hooks/useZoneLeaderboard.js` | React Query hooks for zones |
| `frontend/src/hooks/useRewardsPool.js` | React Query hooks for rewards |
| `frontend/src/components/ZoneLeaderboardWidget.jsx` | Dashboard zone leaderboard card |
| `frontend/src/components/ZoneAssignmentFlow.jsx` | Location permission + zone assignment UX |
| `frontend/src/components/RewardCreditsCard.jsx` | Dashboard reward credits card |
| `supabase/migrations/011_zone_leaderboard.sql` | Zones, xp_events, materialized views |
| `supabase/migrations/012_rewards_pool.sql` | Pool ledger, distributions, credit transactions |
| `supabase/functions/validate-xp-event/index.ts` | Server-side XP validation Edge Function |
| `supabase/functions/distribute-rewards/index.ts` | Monthly distribution cron Edge Function |

#### Files Modified (27)
`App.jsx`, `TankList.jsx`, `CheckoutSummary.jsx`, `BreedersCouncil.jsx`, `ConnectWallet.jsx`, `IdentityStep.jsx`, `NameConfirmStep.jsx`, `persistCompanion.js`, `BadgeShelf.jsx`, `DiscoveryPanel.jsx`, `ProfileCard.jsx`, `PublicProfile.jsx`, `CompanionGuide.jsx`, `DataPortabilityWidget.jsx`, `db.js`, `xp.js`, `useXPSync.js`, `useReefProfile.js`, `useDiscovery.js`, `depthScoreApi.js`, `echoCompanion.js`, `reefApi.js`, `index.css`, `PROJECT_SUMMARY.md`, test files.

---

### 🐠 Echo Companion Presence — Active AI Companion System

Transformed Echo from a background Easter egg into a constant, reactive presence in the app.

#### Echo Dashboard Widget (`EchoCompanionWidget.jsx`)
- Persistent card in the sidebar showing Echo's current state
- Tier-appropriate avatar art with glow effect (maps to Shallow→Hadal art)
- Mood emoji indicator (✨ joyful / 🌊 pleased / 🫧 calm / 💭 curious / 💫 concerned / 🌙 quiet)
- Poetic one-liner that changes based on streak, recent activity, and time of day
- Care streak badge (🔥 + day count)
- Progress bar to next tier with mode-aware labels
- Tap to expand: recent XP reactions + full mood text
- Pre-hatch egg state for new users (progress bar to 500 pts)

#### Echo Mood State Machine (`echoMood.js`)
- 6 moods determined by: streakDays, hoursSinceLastAction, actionsToday, justLeveledUp
- ~36 poetic one-liner lines across all moods
- Greeting system: morning/afternoon/evening/returning/streak variants
- Action reactions: 7 types (feeding, water, params, tank, mint, spawn, tier-up)

#### Echo Whispers (`EchoWhispers.jsx`)
- Floating speech bubble (fixed, bottom-left) with contextual nudges
- Triggers: care reminders, progress nudges, streak encouragement, new user tips
- Priority-ranked candidate system — highest priority whisper shown
- Action-reaction whispers (1.5s delay after XP events)
- Auto-dismiss after 8s, 2-minute cooldown between whispers, click to dismiss
- Smooth enter/exit animations

#### AI Observations (`useEchoObservation.js`)
- Calls Poseidon (Gemini) with tank context on first tank open
- 1 call per session, cached in sessionStorage
- Prompt: max 25 words, warm/poetic, reference actual species/params
- Falls back to 6 canned observations if Poseidon is offline
- Respects Poseidon enabled/disabled toggle

#### Files Created
| File | Purpose |
|------|---------|
| `frontend/src/utils/echoMood.js` | Mood state machine + poetic lines |
| `frontend/src/components/EchoCompanionWidget.jsx` | Dashboard sidebar companion card |
| `frontend/src/components/EchoWhispers.jsx` | Proactive floating nudge system |
| `frontend/src/hooks/useEchoObservation.js` | AI-powered per-session observation |

---

### 📊 Founders Dashboard — Internal Analytics & Monitoring

Added a wallet-gated Founders Dashboard tab to the React SPA. Only allowlisted founder wallets see the "📊 Founders" navigation item — everyone else has no visibility of this feature.

#### Sections
- **KPI Strip**: Total Users, DAU, Specimens Minted, Protocol Fees (cumulative), Marketplace GMV, Live Activity (cams + tides). Trend indicators and sparkline-style context.
- **User Growth Chart**: Area chart showing cumulative user signups over the last 7/30/90 days (Recharts).
- **Protocol Activity Chart**: Grouped bar chart — Specimens minted, Spawns, and UserOps per week.
- **Social Engagement Panel**: Posts, Reactions, Comments, and 7-day active users from The Reef.
- **AI Poseidon Queries**: Donut chart breaking down query intents (Identify, Husbandry, Diet, General) with total count.
- **Operational Health**: Service status grid — Poseidon AI, Supabase, Mux Video, Stripe Connect, Smart Contracts (green/amber/red indicators with live health checks).
- **Auto-Refresh**: Dashboard data refreshes automatically every 60 seconds.

#### Access Control
- Wallet allowlist (`FOUNDER_WALLETS` in App.jsx). Currently: `0x53d3c6F4F11b0B08bC1A5034bBCe7d46198b6851`.
- Non-founder wallets never see the tab or route.

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/components/FoundersDashboard.jsx` | **New** — Full dashboard component with KPI cards, Recharts charts, health panel |
| `frontend/src/services/foundersAnalytics.js` | **New** — Analytics service (Supabase queries, health checks, mock data fallback) |
| `frontend/src/App.jsx` | Import, wallet allowlist, `isFounder` gate, nav tab, switch case |
| `frontend/package.json` | Added `recharts` dependency |

---

### 🥚 Spawning Dashboard — Certificates, Hatchery Insights & Logs

Added a full Spawning Dashboard to the Spawning sub-tab under Breeder Tools. Renders above the existing Spawning Wizard with three pill-navigated sections:

#### Sections
- **Registered Certificates**: Scrollable list of all birth certificates (specimens) owned by the connected wallet, showing serial numbers, species, sire/dam lineage, status badges, and registration dates.
- **Hatchery Insights**: Stats overview — total spawns, total offspring, average clutch size, unique species bred, 30-day activity, top-bred species bar chart, and last spawn event summary.
- **Spawning Logs**: Chronological feed of every spawn event with species, parent IDs, offspring count, tank assignment, lifecycle status (Fry/Juvenile/Adult), and timestamps.

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/components/SpawningDashboard.jsx` | **New** — Dashboard component with 3 sub-sections |
| `frontend/src/components/BreederTools.jsx` | Import + render `SpawningDashboard` above `SpawningWizard` in spawning section |

---

### 🐛 XP Bar — Tier & Progress Display Fix

Fixed the XP progress bar and tier label showing incorrect values (resetting to Tier 1) when navigating between tabs.

#### Root Cause
- **Property name mismatch**: The progress bar referenced `levelInfo.levelPoints` / `levelInfo.nextLevelPoints`, but `getLevelInfo()` returns `baseXp` / `nextLevelXp`. This caused `NaN` width calculations.
- **Lazy init missing**: XP state initialized to `0` and only read from localStorage after the first render effect, briefly flashing Tier 1.
- **Tier 4 edge case**: At max tier, `nextLevelXp` is `null`, causing a division-by-null crash in the progress bar.

#### Fix
- Corrected property names in the progress bar width calc and XP counter display
- Changed `useState(0)` → `useState(() => getXp())` for immediate localStorage read on first render
- Added null guard for max tier — bar shows 100% and label shows "MAX"

---

### 🧬 Breeder Tools — Unified Pro Tab

Consolidated the three separate Pro-mode tabs (Register, Lineage, Spawning) into a single **Breeder Tools** tab with internal pill-style sub-navigation. All functionality preserved — cleaner top-level nav with fewer tabs.

#### Changes
- **New component**: `BreederTools.jsx` — wrapper with internal Register / Lineage / Spawning pill switcher
- **App.jsx**: Replaced 3 tab entries + 3 render cases with single "🧬 Breeder Tools" tab
- **External navigation preserved**: "View Lineage" links from other tabs open directly to the Lineage sub-section
- Updated helper text in `ModeSegmentedControl.jsx`, `TankList.jsx`, `BreedGallery.jsx`

---

### ⚡ My Orders — Instant Load Performance Fix

Fixed slow loading of the My Orders tab (previously blank for several seconds even with zero orders).

#### Root Cause
`fetchOrders()` made sequential blockchain RPC calls for every specimen ever minted + 50 batch purchase IDs before showing any UI. Each call has network latency on Base Sepolia, causing multi-second waits.

#### Fix
- **Local-first instant render**: Loads Dexie/IndexedDB orders immediately and displays them (sets `loading = false` within milliseconds)
- **Background on-chain scan**: Blockchain RPC calls run silently after the UI is already rendered
- **Parallel RPC batching**: On-chain reads now fire in parallel batches of 10 via `Promise.allSettled` instead of sequential `await` loops

---

### 👤 My Orders — Display Names Instead of Wallet Addresses

Replaced all raw `0x...` wallet address displays in the Orders tab with human-readable user identifiers.

#### Resolution Strategy
1. Supabase Reef profile `display_name` (if user set one during onboarding)
2. Local Dexie `userProfile.alias` (cached locally)
3. `generateAlias()` fallback — deterministic fish-themed name (e.g. "Coral-Tetra-4821")

#### Locations Fixed
- Consolidated Shipping header ("Grouping specimens from seller...")
- Cash Handshake QR modal (Buyer / Seller fields)
- Batch Order detail modal (Seller / Buyer)
- Shipping Order detail modal (Seller / Buyer)

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/components/BreederTools.jsx` | **New** — Combined pro tab with internal sub-nav |
| `frontend/src/components/CheckoutSummary.jsx` | Performance rewrite + `DisplayName` component for address resolution |
| `frontend/src/App.jsx` | Replaced 3 pro tabs with single Breeder Tools tab |
| `frontend/src/components/ModeSegmentedControl.jsx` | Updated hint text |
| `frontend/src/components/TankList.jsx` | Updated empty state text |
| `frontend/src/components/BreedGallery.jsx` | Updated hash navigation |

---

## [Unreleased] — 2026-06-17

### ✨ Premium UX Overhaul — Fish Finder & Breed Gallery

Complete visual and UX refresh for the Fish Finder (Casual mode) and Breed Gallery (Pro mode) sections, delivering a premium, image-dominant card experience with reduced visual noise.

#### New Component: `SpeciesCardPremium.jsx`
Extracted the 300+ line inline card rendering into a clean, memoized React component with proper CSS classes.

| Before | After |
|--------|-------|
| Terminal-style macOS colored dots header | Removed — cleaner top edge |
| 2×2 monospace parameter grid | Compact inline parameter pills |
| Raw on-chain values in card (`tempX10`, `phX10`, `salX10000`) | Hidden from cards, shown only in detail view |
| Inline JS hover handlers per card | CSS-driven hover animations (scale, glow, arrow translate) |
| Inline styles (~200 lines per card) | CSS BEM classes with proper specificity |

#### Card Design Improvements
- **Image-dominant layout** — photo area with gradient fade overlay into body text
- **Floating difficulty badge** (top-right) color-coded per care level (green/amber/red/violet)
- **Owned indicator** (top-left) with green glow for species in user's tank
- **Parameter pills** — compact `🌡️ 10–24°C · 💧 pH 6–8 · 📐 40 gal` inline row
- **Personality tagline** (casual mode) with accent-colored left border
- **Behavior tags** — "Schooling", "Easy Feeder", "Beginner Friendly" as pill badges
- **Footer CTA** — "Learn More →" with hover-animated arrow
- **Staggered entrance animation** — 60ms offset per card via CSS keyframes

#### Filter UX Upgrade
- Filter toggle button now uses `gallery-filter-bar` glassmorphic class
- Cleaner border and padding rhythm
- Active state badge persists when filters are applied

#### Species Detail View
- **Tab navigation** converted from inline-styled buttons to `.species-detail__tabs` CSS system
- **Premium slider inputs** — custom thumb with blue glow, larger hit area
- **Simulator title** adapts per mode: "Tank Match" (casual) vs "Simulate My Tank" (pro)

#### Database.html (Static Fish Finder) Polish
- Card aspect ratio changed from `2.5:3.5` to `3:4` (squarer, more modern)
- Flip card container widened to 360px with matching ratio
- Card info section rewritten with flexbox gap layout
- Hover-reveal "View Details →" CTA added to each card

#### CSS Added (~200 lines in `index.css`)
- `.species-card-premium` — full card system (image, badge, body, pills, tags, CTA)
- `.gallery-filter-bar` / `.gallery-filter-chip` — horizontal filter chip system
- `.species-detail__tabs` / `__tab` — segmented tab navigation
- `.simulator-widget` — collapsible container for tank simulator
- `.premium-slider` — custom range input with glow thumb
- `.compat-quick` — quick compatibility result display (casual mode)
- Full responsive overrides (768px, 480px breakpoints)

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/components/SpeciesCardPremium.jsx` | **New** — Extracted premium species card component |
| `frontend/src/components/BreedGallery.jsx` | Replaced inline card rendering with `<SpeciesCardPremium />`, upgraded tabs/sliders/filters to CSS classes |
| `frontend/src/styles/index.css` | Added ~200 lines of premium gallery CSS |
| `frontend/database.html` | Updated card ratio, info layout, flip card size, added hover CTA |

#### Verification
- ✅ `npm run build` — Vite production build passes (exit code 0)
- ✅ No TypeScript/lint diagnostics in modified files
- ✅ All existing functionality preserved (easter eggs, filters, natural language search, virtualized scrolling)

---

### ⛓️ EIP-4337 Account Abstraction — Full On-Chain Integration

Migrated from local-only beta relayer to full EIP-4337 account abstraction with Coinbase Smart Wallet and CDP Paymaster gas sponsorship. All user actions now persist on-chain with zero gas cost.

#### Architecture
- **Smart Wallet**: Coinbase Smart Account (`0x53d3c6F4F11b0B08bC1A5034bBCe7d46198b6851`) derived from sponsor key
- **Paymaster**: CDP Paymaster sponsors all gas — users never pay fees
- **Bundler**: CDP Bundler batches UserOperations into single transactions
- **Client Batching**: 3-second debounce queue (max 10 ops) → one UserOp per flush

#### Operations Going On-Chain via 4337
| Action | Contract Function | Batched? |
|--------|-------------------|----------|
| Register tank | `registerTank()` | ✅ |
| Mint specimen / Add fish | `mintSpecimen()` | ✅ |
| Log water parameters | `logWaterParameters()` | ✅ |
| Move fish between tanks | `moveSpecimenToTank()` | ✅ |
| Initiate spawn | `initiateSpawn()` | ✅ |
| Create listing | `approve()` + `listSpecimen()` | ✅ |
| Cancel listing | `cancelListing()` | ✅ |

#### Files Changed
| File | Change |
|------|--------|
| `frontend/src/services/smartAccountClient.js` | **New** — EIP-4337 client (viem + Coinbase Smart Account + CDP Paymaster/Bundler) with call builders for all contract functions |
| `frontend/src/services/relayer.js` | Rewired from server-side API to client-side 4337 queue with `enqueueOnChain()` batching |
| `frontend/api/relay-transaction.js` | Expanded to support all contract functions (fallback for non-4337 environments) |
| `frontend/src/components/DataPortabilityWidget.jsx` | Added smart wallet status card in Settings (address, network, BaseScan link) |
| `frontend/package.json` | Added `viem@^2.52.2` dependency |

#### Verified on Base Sepolia
- ✅ Batched UserOp (registerTank + mintSpecimen) confirmed in single tx
- ✅ Gas fully sponsored by CDP Paymaster ($0 cost)
- ✅ All contract functions pass (mint, log params, spawn, move)

---

### 🐟 My Aquariums — Visual & Functional Fixes

#### Fixes Applied
| Issue | Fix |
|-------|-----|
| `viewMode` set to invalid `"grid"` | Changed to `"list"` (the actual valid mode) |
| Pro Overview hardcoded ideal ranges (22-27°C, 6.5-8.0 pH) | Now uses dynamic ranges per tank type (Freshwater/Saltwater/Brackish/Pond) |
| Salinity visible in UI (freshwater-only app) | Removed from all forms, states, safe ranges, landing page, and relay calls. Contract still receives `0` for the param. |
| Spawning Wizard shows dog emoji 🐶 | Changed to 🥚 (egg emoji) |
| Fish intermittently missing from Spawning Wizard | Rewrote to local-first data loading (Dexie tanks + specimens → on-chain merge) |
| Hatchery Spawning Logs shows "No Spawning History" | Now queries local `db.spawns` table first, merges with on-chain data |
| Spawned fish not appearing in tanks | Added specimen reconciliation in `useUserTanks` — cross-references `db.specimens` against tank arrays |

#### Files Changed
- `frontend/src/components/TankList.jsx` — Salinity removal, dynamic ranges, viewMode fix
- `frontend/src/components/SpawningWizard.jsx` — Dog→egg emoji, local-first specimen/tank/species loading
- `frontend/src/components/HatcheryLogs.jsx` — Local Dexie spawn query + on-chain merge
- `frontend/src/components/FacilityTreeView.jsx` — Removed salinity from init params
- `frontend/src/components/LandingHobbyist.jsx` — Updated marketing copy (removed salinity mention)
- `frontend/src/components/onboarding/TankTourStep.jsx` — Removed salinity from tutorial
- `frontend/src/hooks/useUserTanks.js` — Added specimen reconciliation step

---

### 🧠 Poseidon AI Gateway — Critical Fix (Live Site Restored)

Fixed Poseidon AI assistant failing on the live site (aquacellum.com) with "Sorry, I'm having trouble connecting to my knowledge base right now." All AI-powered features are now fully operational in production.

#### Root Cause
1. **Corrupted credentials**: The `GCP_SERVICE_ACCOUNT_JSON` env var stored in Vercel was 4 characters shorter than the correct value (2306 vs 2310), causing the RSA private key to be unreadable by Node.js's OpenSSL layer (`error:1E08010C:DECODER routines::unsupported`).
2. **Node 24 + google-auth-library incompatibility**: The `google-auth-library` package's key handling was fragile on Vercel's Node 24 runtime with OpenSSL 3.x, providing unhelpful error messages that masked the real issue.
3. **Silent fallback to depleted API key**: When Vertex AI auth failed, the system fell back to the `GEMINI_API_KEY` (Google AI Studio) which had exhausted prepayment credits (HTTP 429).

#### Fixes Applied

| File | Change |
|------|--------|
| `frontend/api/_lib/vertexClient.js` | **Complete rewrite** — replaced `google-auth-library` with manual JWT signing (`crypto.createSign`). Gives full control over auth, clearer errors, and works reliably on Node 24. Includes AI Studio fallback with proper error propagation. |
| `frontend/api/poseidon.js` | Added diagnostic logging for `isVertexConfigured()` failures and debug hints in non-production error responses |
| `frontend/src/hooks/usePoseidon.js` | Fixed `isOnline` state detection — now correctly handles `data.error: true` responses from the API; stopped counting error responses toward rate limit |
| `frontend/vercel.json` | Changed `functions` scope from `api/poseidon.js` to `api/*.js` — all serverless functions now get access to `fishbase_master.json` |
| `frontend/vite.config.js` | Added `/api` proxy to `localhost:3000` for local dev (forwards to `vercel dev`) |
| `frontend/package.json` | Changed `"dev"` script to `vercel dev --listen 3000`; added `"dev:vite"` for Vite-only mode; added `engines.node: "20.x"` |
| `frontend/.vercel/.env.production.local` | Removed empty `GEMINI_API_KEY=""` and stale OIDC token that were overriding real `.env` values |
| Vercel Environment Variables | Re-uploaded correct `GCP_SERVICE_ACCOUNT_JSON` (2310 chars) via `vercel env add` |

#### New File
- **`frontend/api/poseidon-health.js`** — Diagnostic health check endpoint (`GET /api/poseidon-health`) that reports credential status, JSON parseability, private key format, and performs a live Vertex AI ping test

#### AI Endpoints Verified Working (Production)
- `POST /api/poseidon` — Poseidon chat assistant (Gemini 2.5 Flash + species RAG)
- `POST /api/parse-search` — Natural language search → structured filters
- `POST /api/suggest-species` — AI-powered species validation (WoRMS + Gemini audit)
- `POST /api/generate-alt-text` — Gemini Vision alt-text for aquarium photos
- `GET /api/poseidon-health` — Credential & connectivity diagnostic

#### Architecture (vertexClient.js)
```
Auth Flow: Manual JWT → Google OAuth2 token exchange → Vertex AI Bearer auth
Fallback:  If Vertex fails → GEMINI_API_KEY (AI Studio endpoint)
Caching:   Access tokens cached in-memory (1hr TTL with 60s buffer)
```

#### Verification
- ✅ `npm run build` — Vite production build passes
- ✅ `/api/poseidon-health` — `vertexTest.success: true` on live site
- ✅ `/api/poseidon` — Returns structured JSON responses with correct intent classification
- ✅ `/api/parse-search` — NLP query parsing operational
- ✅ Deployed to production via `vercel --prod`

---

## [Unreleased] — 2026-06-16

### 🎬 Video & Livestream System — Complete (Phases 1–3)

Full video infrastructure for The Reef social layer, powered by Mux.

#### Phase 1: Short-Form Video in Currents
- **Video Upload Pipeline**: Record (MediaRecorder) or select video (max 60s, 100MB) → client-side validation → Mux Direct Upload → HLS transcoding → inline feed playback
- **VideoPlayer**: Autoplay-on-scroll (IntersectionObserver), tap-to-unmute, duration badge, progress bar, error/retry states
- **VideoRecorder**: In-app camera with 60s circular timer, front/back toggle, live preview
- **Webhook Handler**: Processes `video.asset.ready`/`errored`/`upload.asset_created` events to update post status
- **ContentComposer**: Extended with video file picker + record button (mutual exclusivity with photos)
- **CurrentCard**: Renders VideoPlayer for ready videos, VideoThumbnail for processing states

#### Phase 2: Tank Cams (Always-On Ambient Livestream)
- **Tank Cam Setup**: One-click from tank Overview tab → creates Mux live stream → displays RTMP URL + stream key
- **Tank Cam Viewer**: Full-screen LL-HLS player with LIVE badge, viewer count (Supabase Presence), floating emoji reactions
- **Tank Cam Discovery**: Grid layout in new "📹 Live" tab in The Reef showing all active public cams
- **Webhook Integration**: `live_stream.active/idle/disconnected` events update `tank_cams.status` in real-time
- **FloatingReactions**: Periscope-style emoji animation overlay (broadcast via Supabase Realtime)

#### Phase 3: Virtual Tide Livestream
- **TideStreamPlayer**: Host controls (create stream, RTMP credentials, end stream) + LL-HLS viewer for attendees
- **VOD Recording**: Streams are automatically recorded; after event ends, recording becomes available in Recap tab
- **Webhook**: Handles `live_stream.active/idle/disconnected` + `asset.live_stream_completed` for VOD playback ID
- **TidePage**: Replaced "Coming Soon" placeholder with live stream player

#### Infrastructure
| Component | Technology | Purpose |
|-----------|------------|---------|
| Video Transcoding | Mux (Direct Upload + HLS) | Upload, transcode, adaptive bitrate |
| Live Streaming | Mux Live (LL-HLS, RTMP ingest) | Tank Cams + Tide broadcasts |
| Playback | hls.js + native `<video>` | Cross-browser HLS |
| Realtime | Supabase Presence + Broadcast | Viewer counts, reactions |
| Webhooks | Vercel Serverless | Async status updates |

#### New API Endpoints
- `POST /api/video-upload` — Mux Direct Upload URL creation
- `POST /api/mux-webhook` — Handles all Mux webhook events
- `POST /api/tank-cam-setup` — Create/delete Tank Cam live streams
- `GET /api/tank-cams` — List active public Tank Cams
- `POST /api/tide-stream-setup` — Create/end Tide livestreams with VOD recording

#### Database Migrations
- `20250615_video_currents.sql` — Video columns on currents table
- `20250616_tank_cams.sql` — Tank Cams table with RLS
- `20250616_tide_streams.sql` — Tide Streams table with RLS

---

### 🤝 Social Layer Overhaul — Follow System & School Invites

#### One-Tap Follow System (Batch 1)
- **FollowButton component**: Compact (feed cards) and full (profiles) variants with optimistic UI
- **Follow from feed**: Every post shows a "+ Follow" button next to the author timestamp
- **Follow from profile**: Full-size Follow button next to Connect on PublicProfile
- **Follower/Following counts**: Displayed on all profiles
- **Following feed fixed**: Now includes posts from followed users (not just tankmates)
- Uses existing `follows` table with `follow_type: "follow"` — no migration needed

#### School Invite System (Batch 2)
- **SchoolInviteButton**: Dropdown on user profiles showing eligible schools (only visible to Founders/Elders)
- **SchoolInvites panel**: Shows pending invites in Following tab with Join/Decline
- **API functions**: `inviteToSchool`, `acceptSchoolInvite`, `declineSchoolInvite`, `getMySchoolInvites`
- **DB migration**: `school_invites` table with unique pending constraint
- **Flow**: Founder visits profile → Invite to School → user sees invite in feed → accepts → joined

---

### 🐛 Bug Fixes & UI Polish

- **ContentComposer mobile**: Fixed nav bar overlapping modal on mobile (React Portal + z-index 99999 + 100dvh + safe-area-inset)
- **Mux webhook**: Fixed signature verification (Vercel body parsing) and env var fallback (`VITE_SUPABASE_ANON_KEY`)
- **Comments auto-show**: Comments now auto-load and expand when a post has them (no click required)
- **Create Tide wizard**: Premium glassmorphic redesign (gradient buttons, glow steps, card hover lift, form focus states, responsive grid, fadeSlideIn animation)
- **Create Tide steps**: Fixed step numbers not centered (removed ::before pseudo-element connectors)
- **Create Tide button**: Styled "+ Create Tide" button (was rendering with browser defaults/white)
- **Virtual Tide unlocked**: Removed "Coming Soon" badge — now fully functional with livestream

---

### 🔧 Command Console — Replace Quick Clean with Water Change

Swapped the "Quick Clean" (algae sweep) button in the pro Command Console with a "Water Change" button. Clicking it instantly logs a water change action and updates the tank card's "Water Change" timestamp in real time.

#### Modified Files
- **`src/components/TankList.jsx`** — Added `logWaterChange()` function, replaced Quick Clean tile and dropdown item with Water Change (💧 icon, logs `actionType: "Water Change"`)

---

## [Unreleased] — 2026-06-15

### 🎬 Video Upload & Livestream — Phase 1: Short-Form Video in Currents

Full video upload pipeline for The Reef social feed. Users can record or select video clips (up to 60s) and post them as Currents with inline HLS playback.

#### New Infrastructure
| Component | Technology | Purpose |
|-----------|------------|---------|
| Video Transcoding | Mux (Direct Upload + HLS delivery) | Upload, transcode, adaptive bitrate streaming |
| Webhook Handler | Vercel Serverless (`/api/mux-webhook`) | Process video.asset.ready/errored events |
| Upload API | Vercel Serverless (`/api/video-upload`) | Generate Mux Direct Upload URLs |
| Playback | hls.js + native `<video>` | Cross-browser HLS with autoplay-on-scroll |

#### New Files
- **`api/video-upload.js`** — Serverless endpoint creating Mux Direct Upload URLs with wallet auth
- **`api/mux-webhook.js`** — Webhook handler with signature verification, processes asset status transitions
- **`src/services/videoUpload.js`** — Client-side upload service (validates type/size/duration, metadata extraction, thumbnail generation, PUT to Mux with progress)
- **`src/hooks/useVideoUpload.js`** — TanStack Query mutation hook with progress tracking
- **`src/components/video/VideoPlayer.jsx`** — HLS player with autoplay-on-scroll (IntersectionObserver), tap-to-unmute, duration badge, progress bar, error/retry states
- **`src/components/video/VideoThumbnail.jsx`** — Poster frame display with processing/error overlays and duration badge
- **`src/components/video/VideoRecorder.jsx`** — In-app camera recording with MediaRecorder API, 60s timer ring, front/back toggle, live preview
- **`src/components/video/index.js`** — Barrel export
- **`supabase/migrations/20250615_video_currents.sql`** — DB migration adding video columns to currents table
- **`docs/VIDEO_ARCHITECTURE.md`** — Full architecture document covering all 4 phases (video uploads, Tank Cams, Tide Livestream, AI video features)

#### Modified Files
- **`src/components/reef/ContentComposer.jsx`** — Added video selection (file picker + in-app recorder), video preview with duration badge, mutual exclusivity with photo uploads
- **`src/components/reef/CurrentCard.jsx`** — Renders `VideoPlayer` for ready videos, `VideoThumbnail` for processing/error states
- **`src/services/reefApi.js`** — `createCurrent()` now accepts `videoUploadId`, `videoDuration`, `videoThumbnailUrl` params
- **`package.json`** — Added `hls.js` ^1.5.17 dependency
- **`.env.example`** — Added `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`, `FRONTEND_ORIGIN`

#### Database Schema (Supabase Migration)
```sql
ALTER TABLE currents ADD COLUMN video_upload_id TEXT;
ALTER TABLE currents ADD COLUMN video_asset_id TEXT;
ALTER TABLE currents ADD COLUMN video_playback_id TEXT;
ALTER TABLE currents ADD COLUMN video_thumbnail_url TEXT;
ALTER TABLE currents ADD COLUMN video_duration_seconds NUMERIC;
ALTER TABLE currents ADD COLUMN video_status TEXT;
ALTER TABLE currents ADD COLUMN video_alt_text TEXT;
```

#### Video Upload Flow
1. User records (MediaRecorder) or selects video file (max 60s, 100MB)
2. Client validates type/size/duration, extracts metadata
3. Client calls `/api/video-upload` → receives Mux Direct Upload URL
4. Client PUTs file directly to Mux with progress tracking (XHR)
5. Current created with `video_status: "uploading"`
6. Mux transcodes → fires webhook → updates to `"ready"` with playback ID
7. Feed renders inline HLS player with autoplay-on-scroll

#### Feed Playback UX
- Autoplay muted when 50%+ visible (IntersectionObserver)
- Tap to unmute → tap again to pause
- Duration countdown badge (bottom-right)
- Progress bar on hover
- Poster frame from Mux thumbnail API
- Processing state: blurred thumbnail + spinner
- Error state: retry button

#### Verification
- ✅ `npm run build` — Vite production build passes (hls.js code-split into own chunk)
- ✅ Mux API authenticated — Direct Upload creation confirmed
- ✅ `/api/video-upload` endpoint live — returns upload URLs
- ✅ `/api/mux-webhook` endpoint live — rejects unsigned requests (signature verification working)
- ✅ Deployed to production via `vercel deploy --prod`

---

## [Unreleased] — 2026-06-13

### Breeder Pro Mode Premium Upgrades & Enhancements

#### 🧪 Husbandry, Detailed Feed, and Bulk Command Upgrades
- **Interactive Feed Inputs:** Replaced simple input fields in the Feed dialog with interactive selection chips for **Feed Types** (e.g. Brine Shrimp, Mysis, Bloodworms) and **Dosages** (e.g. Pinches, Cubes, Sheets) with dynamic text preview.
- **Bulk Husbandry & Maintenance Shortcuts:** Added quick-actions to open the Bulk Log console pre-configured to "Entire Rack" or "Entire Room" scope for feeding or cleaning.
- **Bulk Water Testing:** Fixed bulk water parameter logging (pH, Temp, Nitrite, Nitrate, Ammonia) to apply parameters sequentially across all targeted tanks in a rack or room, keeping the inputs visible when a bulk scope is selected.

#### 🛒 Premium Marketplace & Listing Editing
- **Marketplace Theme Alignment:** Upgraded sub-tabs, filters, trust banners, analytics dashboards, and submission forms in the Marketplace to use the signature Breeder Pro violet/purple gradient theme.
- **Self-Listing Editing Drawer:** Added the ability for breeders to edit their own active listings directly from the marketplace grid. Supported updating price, delivery type (local pickup vs. shipping), shipping fee, and managing up to 5 compressed listing images.
- **Multi-Image Carousel:** Updated listing cards to display dots pagination and left/right navigation arrows for browsing multiple specimen photos on hover.

#### 🗺️ Premium Offline-First Local Breeder Map
- **IndexedDB Support:** Integrated local Dexie DB stores (`db.localListings` and `db.listings`) to enable offline-first mapping of breeders and listings.
- **Violet Pro Aesthetic:** Upgraded the radar sweeps, concentric grids, transmitter pulses, range tags, and detail panels with the Breeder Pro violet theme.

#### ✦ Premium Birth Certificate Registration & Breeder Validation
- **Visual Design:** Redesigned the **Register** tab container and input fields with glowing violet borders, fuzzed focus shadows, and the `.btn-primary-pro` purple gradient button.
- **Breeder Username Display:** Masked Breeder Account Address behind the Breeder Account Username, defaulting to the profile's resolved name/alias.
- **Advanced Options:** Completely hid the collapsible advanced options settings from the breeder registration form in Pro mode.
- **Breeder Ownership Validation:** Enforced breeder name validation on submission. If the input breeder username does not match the active user's resolved profile name, blocked registration and returned the exact error message `"you do not have permission"`.

---

### Premium UI Overhaul — Previous Session Changes

---

### 🔒 Specimen Birth Certificate & Lineage Fixes

#### `SpecimenDetailModal.jsx`
- Fixed certificate number display — clicking the certificate number now correctly opens the birth certificate view
- Registry address (wallet address) is now hidden in the certificate; replaced with the user's **profile name** for a premium, web2-friendly experience
- The certificate panel is now presented with a premium glassmorphic design

#### `SpecimenLineage.jsx`
- Fixed bug where navigating to **Ancestry** in the Lineage tab did not show the birth certificate
- Birth certificate is now correctly rendered in both the specimen detail view and the ancestry lineage path
- Three-generation family tree condensed to be more compact and space-efficient

---

### 🛒 Marketplace Listing — Web2-Friendly Masking

#### `ListSpecimenModal.jsx`
- **"List on Marketplace"** workflow completely reworked to hide Web3/blockchain terminology
- All wallet addresses, contract calls, and publish directory references are now masked behind plain English labels (e.g. "Listing Price" instead of "Token Amount")
- The modal now guides breeders step-by-step in plain breeder language with a premium card layout
- Web3 mechanics operate invisibly in the background — the breeder only sees a familiar e-commerce listing experience

---

### 🧬 Breed Gallery — Pro Mode Upgrades

#### `BreedGallery.jsx`
- **Registered Breeds tab** defaults to **"My Tank Species"** in Pro Mode — showing only species the breeder actively has in their tanks
- Added a **sliding segmented scope switcher**: `🐠 My Tank Species (N)` ↔ `🌐 All Catalog Breeds (N)` with animated pill indicator and live counts
- Quick-tap **category badge chips** with emoji icons and specimen counts for instant filtering
- **Premium empty states** added:
  - *Empty tank registry*: Glassmorphic card with `Register First Specimen 🐠` CTA redirecting to registration wizard
  - *No matches in tank collection*: Clear filters + Browse All Catalog options
- Redundant **Breeders Council** tab removed from the Registered Breeds sub-navigation
- New **Registered Breeds** tab repositioned above the search bar

#### `BreedersCouncil.jsx`
- Breeders Council content moved inside the **Select Species** flow within the Breed Gallery
- Presented as a premium contextual panel rather than a standalone tab

#### `SuggestSpeciesModal.jsx`
- Minor cleanup and consistency improvements

---

### 🗂️ Main Navigation Bar — Premium Pill Design

#### `App.jsx`
- Replaced plain `btn-primary` / `btn-secondary` tab buttons with a **premium glassmorphic pill navigation bar**
- Tabs now rendered from a clean config array with icon + label layout
- **Mode-adaptive theming**: teal accent in Casual mode, purple accent in Pro mode
- Active tab: gradient fill + glowing border + text-shadow
- Hover: soft tinted border + background tint
- Scroll edge **fade masks** for graceful overflow
- Pulse badge on Reef/Social tab preserved
- Semantic `<nav>` element with `aria-current` for accessibility

#### `index.css`
- Added full `PREMIUM MAIN NAV BAR` CSS block:
  - `.aquadex-nav`, `.aquadex-nav--casual`, `.aquadex-nav--pro`
  - `.aquadex-nav-tab`, `.aquadex-nav-tab--active`
  - Hover/active states for both modes
  - Mobile-responsive pill sizing at ≤640px

---

### ⚙️ Tank Action Bar — Premium Pill Design (Scan / Quick Log / Register)

#### `TankList.jsx`
- Replaced the old `sticky-scanner-header` flat bar with a new **premium glassmorphic `tank-action-bar`**
- Buttons reorganised: **Scan** left · **Grid/Tree toggler** centre · **Quick Log + Register** right (flex spacer)
- All buttons converted to `tank-action-pill` system:
  - **Scan Tank/Unit**: Breathing glow pulse — teal in Casual, purple in Pro
  - **Grid list / Facility Tree**: Pill-group toggler with purple active fill + glow
  - **Quick Log**: Ghost pill with mode-tinted border
  - **Add Tank / Register Unit**: Tinted gradient pill with mode-matched border
- `scale(0.97)` press feedback on all pills
- Sticky positioning retained (`top: 0; z-index: 100`)

#### `index.css`
- Removed old `.sticky-scanner-header`, `.scanner-btn`, and `pulse-blue` keyframe
- Added full `PREMIUM TANK ACTION BAR` CSS block:
  - `.tank-action-bar`, `.tank-action-bar--casual`, `.tank-action-bar--pro`
  - `.tank-action-pill` and all variant modifiers
  - `.tank-view-toggle`, `.tank-view-btn`, `.tank-view-btn--active`
  - `@keyframes tank-scan-pulse-teal` and `tank-scan-pulse-purple`
  - Reduced-motion and mobile media query overrides

---

### 🔗 Supporting Hook Fixes

#### `useUserTanks.js`
- Minor improvements to tank data resolution used by Breed Gallery scope switcher

---

### ✅ Verification

All changes verified with:
- `npm run build` — Vite production build ✓ (no errors)
- `npm run test` — All 212 unit tests passed ✓
