# Aquadex Protocol — Development Changelog

All dated development actions, feature implementations, and infrastructure changes.
For the current project specification, see [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md).

---

## June 12, 2026 — UI Fix: Breeder Store Card Redirection & Aquarium Water Care Timers

Fixed breeder store card redirection bugs and resolved stale/inactive water chemistry parameters timers.

### Changes
- **Breeder Store / Marketplace (`MarketplaceBoard.jsx`)**:
  - Removed the card-level `onClick` handler from the listing cards which incorrectly took users to the "My Orders" tab with non-existent shipping/batch order IDs.
  - Removed the `cursor: "pointer"` style from the listing cards.
- **Aquarium Water Care Timers (`useUserTanks.js` & `TankList.jsx`)**:
  - Updated `useUserTanks.js` to query local `db.actionLogs` dynamically for each tank, computing the actual latest water test (🧪) and water change (💧) timestamps.
  - Replaced the single relative timer with separate `latestTestTime` and `latestChangeTime` states for each tank.
  - Redesigned the right-hand card telemetry grid block into a structured, symmetric **Water Care** panel showing both the last water test time (🧪) and the last water change time (💧).
  - Configured logging handlers (Quick Feed, Quick Clean, Quick Water Test, bulk loggers, inline details, and Poseidon AI actions listener) to call `fetchDashboardData()` immediately after writes, ensuring relative timers update in real-time.

---

## June 12, 2026 — Feature: Premium Social Reef, Profile Metrics, Catalog Filters, and Breeder Store (Casual Mode)

Redesigned multiple key screens in the application under Casual Mode to declutter the interface, refine terminology, and elevate the design to a premium, modern aesthetic.

### Changes
- **Social Reef (`ReefFeed.jsx`, `ReefSearchBar.jsx`, `DiscoveryPanel.jsx`, `SonarBell.jsx`)**:
  - Cleaned up and decluttered the top community section header.
  - Replaced native tooltips with premium custom glassmorphic HTML tooltips.
  - Configured labels to transition into view smoothly when hovering over the icons.
- **Profile Page & Achievements (`TankList.jsx`, `BadgeShelf.jsx`, `PublicProfile.jsx`)**:
  - Hidden locked achievements by default to reduce clutter on the achievement shelf.
  - Added dynamic background synchronization inside `TankList.jsx` that queries local Dexie tables (`db.tanks` and `db.specimens`) to auto-sync the user's active species and tank metrics, correcting stale counts.
  - Upgraded the stats row to glassmorphic cards with cyan glows and custom metric icons.
- **Fish Finder / Breed Gallery (`BreedGallery.jsx`)**:
  - Filtered the "My Collection" view to display only species currently residing in the user's local tanks.
  - Synced specimens tracking with both the local `db.tanks` arrays and the standalone `db.specimens` table.
  - Fixed search scope bugs, enabling dynamic searches in both the global catalog and owned collections.
  - Redesigned quick-tap species tag pills as compact glass capsules with interactive hover floats and glows.
- **Add a Fish Tab & Onboarding (`App.jsx`, `FishTourStep.jsx`, `fishTourCopy.js`)**:
  - Hidden the "Add a Fish" tab in Casual Mode to prevent duplication (as casual users add fish directly within tank lists).
  - Updated the guided onboarding tour step `tour_fish` to spotlight `"aquariums-tab"` instead of the hidden `"add-fish-tab"`, and updated the instructional copy accordingly to prevent spotlight errors.
- **Breeder Store / Marketplace (`App.jsx` & `MarketplaceBoard.jsx`)**:
  - Renamed the tab from `"🛒 Browse Fish"` to `"🛒 Breeder Store"` in Casual Mode to align with marketplace/store branding.
  - Hidden the breeder analytics sub-tabs and the "Publish Entry" button for casual users.
  - Redesigned the text-heavy trust banner into a compact glass guarantee ribbon displaying: `🛡️ Escrow Health Guarantee`, `📦 3-Day Safe Arrival`, and `🤝 Verified Local Breeders`.
  - Added a `"Price: High to Low"` sort option and implemented `price-desc` sorting logic.
  - Styled card badges as beautiful HTML capsule pills (e.g. `🏠 Tank-Bred`, `🚚 Shipping`, `📍 Local Pickup`, `✨ Beginner Friendly`) with icons and custom background tints.
  - Re-worded card actions to `"Purchase"` (or `"Purchasing..."`) and `"Remove Listing"` in Casual Mode.

---

## June 12, 2026 — UI Fix: Remove Saltwater Specific Gravity / Salinity Telemetry

Removed all Specific Gravity (Salinity) parameter inputs and telemetry displays from the application as the system is freshwater-focused.

### Changes
- **`TankList.jsx`**:
  - Removed the "Specific Gravity" telemetry tile from the Pro mode dashboard overview grid.
  - Adjusted the layout of the "Nitrogen Cycle" telemetry tile to span 2 columns (`gridColumn: "span 2"`), maintaining a balanced and clean grid.
  - Removed the "Salinity (SG)" slider field from the quick log water parameter form.
  - Reorganized the Ammonia, Nitrite, and Nitrate inputs into a single clean 3-column row layout.
- **`SpawningWizard.jsx`**:
  - Removed the "Salinity" card from the environmental chemistry snapshot view.
  - Organized the remaining 5 tiles into a 2-column grid (Temp, pH) and a 3-column grid (Ammonia, Nitrite, Nitrate).

---

## June 11, 2026 — Feature: Inline "Add Fish" Button on Tank View

Added a one-click "Add Fish" action directly in the tank detail Fish tab, so users no longer need to navigate out to the separate registration page.

### Changes (`TankList.jsx`)
- "+ Add Fish" button in the Fish sub-tab header, plus a prominent CTA in the empty state ("+ Add your first fish").
- New inline Add Fish sliding drawer: searchable species picker (from the on-chain catalog via `useContractSpecies`), one-tap select, and submit.
- Uses `relayMintSpecimen` (local-first, no MetaMask). On success: awards XP, shows a toast, dispatches `aquadex:specimen_added`, and refreshes the active tank.
- Escape-to-close wired into the existing drawer keyboard handler.

The standalone "Add Fish" tab remains for the onboarding tour and as an alternate path.

---

## June 11, 2026 — Fix: Full Local-First Beta — Remove MetaMask From All Flows

Extended the local-first relayer pattern to the entire app. No user action triggers MetaMask anymore — listings, purchases, escrow/handshake settlement, breeding/spawning, and species curation all run through Dexie. The only remaining wallet prompt is the explicit "Connect MetaMask" login choice.

### Relayer (`relayer.js`) — new local-first functions
- Listings: `relayCreateListing`, `relayCancelListing`, `relayCancelBatchListing`, `getLocalListings`.
- Purchases: `relayPurchaseSpecimen`, `relayPurchaseMultiple`, `relayPurchaseBatch`.
- Orders/escrow: `relayGetOrders`, `relayUpdateShippingOrder`, `relayUpdateBatchOrder`, `relaySettleHandshake`.
- Breeding/curation: `relaySpawn`, `relayAddSpecies`.

### Components converted (no more `getSigner()` writes)
- `MarketplaceBoard.jsx`: buy / batch buy / cancel listing / cancel batch.
- `CheckoutSummary.jsx`: consolidated checkout, in-person release, dispatch/release/dispute/resolve shipping, release/refund batch; `fetchOrders` and `loadAllListings` now merge local orders/listings.
- `HandshakeVerification.jsx`: lock escrow, verify release, settle cash handshake.
- `ListSpecimenModal.jsx`: approve (now no-op) + list; `verifyToken` falls back to local specimens.
- `HatcheryLogs.jsx`: buy juveniles.
- `SpawningWizard.jsx`: spawn + offspring minting.
- `CurationQueuePanel.jsx`: species approval.
- Removed unused `getSigner` imports from `BreedGallery.jsx`, `LocalBreederMap.jsx`, `FacilityTreeView.jsx`.

### Data layer
- `db.js` (schema v13): added `localListings`, `marketOrders`, `spawns` tables.
- `useMarketplaceListings.js`: merges local beta listings so they survive the on-chain cache refresh.

### Notes
- Read paths still use read-only RPC (never prompt MetaMask) with local data merged in.
- On-chain publishing is deferred to a future flow once meta-transaction/ownership delegation is added to the contracts.

---

## June 11, 2026 — Fix: Remove MetaMask Popup from Tank Operations (Local-First Relayer)

Routine tank operations (adding fish, moving specimens, logging water parameters) no longer trigger MetaMask. All day-to-day writes are now routed through the local-first Dexie relayer, matching the existing tank registration pattern.

### Changes
- **`relayer.js`**: Added `relayMintSpecimen()`, `relayMoveSpecimen()`, `relayLogWaterParameters()` — store specimens and logs locally in Dexie with no wallet interaction.
- **`MintSpecimen.jsx`**: `handleMintSubmit` now uses `relayMintSpecimen()` instead of direct contract call. `loadMetadata()` merges local Dexie tanks into the tank dropdown.
- **`TankList.jsx`**: `handleMoveSpecimen` and `handleLogSubmit` use local relayer functions instead of `getSigner()` → contract calls.
- **`db.js`**: Added `specimens` table (schema version 12) for standalone specimen queries by owner, species, or tank.

### Notes
- Marketplace/trading operations (buy, sell, handshake) still go on-chain intentionally.
- On-chain minting deferred to a future "publish" flow once meta-transaction or ownership delegation support is added to the contract.

---

## June 11, 2026 — Merged to Production (master)

All changes from `feat/social-reef-phase5-complete` merged to master and deployed to aquacellum.com via Vercel. Includes: onboarding revamp, immersive reef XR biomes/cutouts/planted environments, Vertex AI migration, display name uniqueness, Echo companion art, 13 new 3D fish models, 280+ species cutout sprites, sponsorship scaffolding, and internal docs/scripts excluded from repo.

---

## June 11, 2026 — Onboarding Revamp: Cinematic Dual-Pane Wizard & Guided Spotlight Tour

Complete rewrite of the onboarding experience from a flat chat-bubble card into a dual-pane, stage-driven wizard that culminates in a guided spotlight tour of the real application.

### Dual-Pane Cinematic Layout
- **`OnboardingLayout.jsx`**: CSS Grid two-column shell (narration | visual stage). Responsive: stacks vertically below 768px with stage on top. Uses new `onboarding-*` class system in `index.css`.
- **`PoseidonNarrator.jsx`**: Chat-style narrator with `/poseidon-avatar.jpg`, typing-indicator → reveal rhythm, `role="log"` + `aria-live="polite"`. Imperative API via ref (`addMessage`, `say`, `reset`).
- **Persona-aware dialogue**: Ported full `DIALOGUE` script with `resolveLine()` helper for casual/pro copy selection.

### Echo Egg Hatch Stage
- **`EchoStage.jsx`**: Real egg art → crack animation → Echo fry (`/echo-fry.png`) revealed in a glass tank-frame backdrop. States: idle (pulse) → cracking (wobble + crack keyframe) → hatched (swim). Keyboard/click activation (Enter/Space), ≥48×48px target, 6s nudge timer.
- **`persistCompanion.js`**: On hatch, writes `breederCompanion` (eggState hatched, tier Bronze, initial XP) to Dexie. Idempotent guard.
- **`prefers-reduced-motion`**: Cross-fade instead of crack/shake; opacity-only transitions throughout.

### Guided Spotlight Tour (Real UI)
- **`SpotlightOverlay.jsx`**: Full-screen dim with box-shadow cutout around `data-tour-id` target. Recomputes on resize/scroll, scrolls target into view, fires `onTargetMissing` for fallback.
- **`TourCoachmark.jsx`**: Poseidon-styled instruction bubble anchored to target. Focus trap, Esc to skip (where allowed), persona-aware copy. Repositions dynamically.
- **`SpotlightTour.jsx`**: Orchestrates 3 steps — tank registration → add fish → profile picture nudge. Uses `useTourStep` for dual event+poll detection.
- **`useTourStep.js`**: Completion watcher with event listener + Dexie `verify()` poll + graceful timeout. Single terminal latch (idempotent advance). Pure `createTourStepWatcher` factory for testability.
- **Real component events**: `aquadex:tank_registered`, `aquadex:specimen_added`, `aquadex:avatar_set` dispatched on success paths in `FacilityTreeView`, `MintSpecimen`, `ProfileEdit`.
- **`data-tour-id` anchors**: `aquariums-tab`, `add-fish-tab`, `profile-widget` on real controls in `App.jsx` and `ConnectWallet.jsx`.

### Privy-Only Authentication
- **`IdentityStep.jsx`**: Single Privy CTA only — MetaMask button and external-wallet link removed from onboarding. Retry on fail (no MetaMask fallback). OAuth-redirect resume preserved.
- **`NameConfirmStep.jsx`**: Pre-filled alias from `generateAlias(account)`, max 30 chars, Enter-to-submit, disabled when empty. **Uniqueness check**: debounced case-insensitive query against Supabase `profiles.display_name` — shows "name taken" warning and blocks confirm.

### Per-Account Onboarding Gate
- **`useOnboardingGate.js`**: Resolution order: localStorage fast-path cache → Supabase `profiles.onboarding_complete` → Dexie `userProfile.onboardingComplete` fallback → authenticated-but-no-account ⇒ show.
- **`OnboardingContext.jsx`**: Phase state machine (persona → identity → nameConfirm → hatch → tourTank → tourFish → profileNudge → complete). Persists phase to Dexie only after account exists. `completeOnboarding()` writes Supabase + Dexie + localStorage cache.
- **App-level gate**: `App.jsx` replaced localStorage-only boolean with `useOnboardingGate(account)`.
- **Supabase migration**: `profiles.onboarding_complete BOOLEAN DEFAULT false` column added.
- **Replay**: Settings "Replay Intro" clears cache + resets Dexie phase without clearing data.

### Display Name Uniqueness
- **`checkDisplayNameAvailable(name, excludeWallet)`** in `reefApi.js` — case-insensitive `ilike` query against Supabase, excludes user's own wallet. Fails open (never blocks if Supabase is down).
- **`NameConfirmStep`**: 400ms debounce check as user types. Shows "Checking availability…" and "That name is already taken" states. Confirm button disabled when duplicate found.

### CSS Foundation
- New class system appended to `index.css`: `onboarding-layout`, `onboarding-pane--*`, `onboarding-card`, `poseidon-bubble`, `poseidon-avatar`, `echo-stage`, `echo-egg`, `echo-egg--cracking`, `echo-fry`, `echo-tank-frame`, `tour-overlay`, `tour-spotlight`, `tour-coachmark`, `tour-skip`.
- Keyframes: `eggCrack`, `echoSwim`.
- `@media (max-width:767px)` pane stacking + `@media (prefers-reduced-motion: reduce)` overrides.

### Accessibility
- Focus management on phase transitions (tabIndex + ref.focus).
- `aria-live="polite"` on narrator, `role="button"` + focus ring on egg, focus trap in coachmark.
- Reduced-motion: opacity-only equivalents reach same end states (Property 7).

### Files Created (27 new)
| Directory | Files |
|-----------|-------|
| `frontend/src/components/onboarding/` | OnboardingLayout, PoseidonNarrator, EchoStage, IdentityStep, NameConfirmStep, SpotlightOverlay, TourCoachmark, SpotlightTour, spotlightGeometry, identityCopy, nameConfirmCopy, persistCompanion, tankTourCopy, fishTourCopy, profileTourCopy, firstTankReward + tests |
| `frontend/src/contexts/` | OnboardingContext.jsx + test |
| `frontend/src/hooks/` | useOnboardingGate.js + test, useTourStep.js |
| `frontend/src/utils/` | a11y.js |

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/App.jsx` | useOnboardingGate replaces localStorage gate, data-tour-id on tabs |
| `frontend/src/components/OnboardingWizard.jsx` | Full rewrite — composes new components |
| `frontend/src/components/ConnectWallet.jsx` | data-tour-id="profile-widget" |
| `frontend/src/components/MintSpecimen.jsx` | aquadex:specimen_added event |
| `frontend/src/components/FacilityTreeView.jsx` | aquadex:tank_registered event |
| `frontend/src/components/reef/ProfileEdit.jsx` | aquadex:avatar_set event |
| `frontend/src/components/DataPortabilityWidget.jsx` | Replay resets Dexie phase |
| `frontend/src/services/reefApi.js` | setOnboardingComplete, checkDisplayNameAvailable, ensureProfile updated |
| `frontend/src/db.js` | v11 schema — onboardingComplete indexed on userProfile |
| `frontend/src/styles/index.css` | Onboarding/tour CSS classes + keyframes + media queries |

---

## June 11, 2026 — Vertex AI Migration, Imagen Asset Pipeline & Reef Environment Textures

Consolidated all Google AI usage onto **Vertex AI** so it bills to the `aquacellum` Cloud project (credits), generated the static reef art with Imagen 4, and wired the generated biome textures into the 3D reef. Also fixed fish clipping through the floor.

### Vertex AI Migration (Gemini + Imagen → Cloud project billing)
- **Root cause of prior setup**: all four serverless functions + the Imagen script authenticated with an **AI Studio Developer API key** (`generativelanguage.googleapis.com`), which bills a personal account, not the Cloud project. Credits apply to **Vertex AI**, so usage wasn't drawing from them.
- **New shared client** `frontend/api/_lib/vertexClient.js`: mints an OAuth token from a service account via `google-auth-library`, calls `{location}-aiplatform.googleapis.com`. `isVertexConfigured()` gates the offline fallbacks. Auth resolves from `GCP_SERVICE_ACCOUNT_JSON` (Vercel) → `GOOGLE_APPLICATION_CREDENTIALS` (local) → ADC.
- **Migrated all four functions** off the API key: `poseidon.js`, `parse-search.js`, `generate-alt-text.js`, `suggest-species.js`. Prompts, JSON schemas, safety settings, and fallback branches preserved unchanged.
- **Model update**: Gemini 2.0 and 1.5 are **retired** on Vertex (return `404 NOT_FOUND`). Standardized on Gemini 2.5, with a cost-aware split:
  - `gemini-2.5-flash` → `poseidon.js` (chat quality) + `suggest-species.js` (taxonomic accuracy)
  - `gemini-2.5-flash-lite` → `parse-search.js` + `generate-alt-text.js` (simple, high-volume)
- **Env config**: added `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_SERVICE_ACCOUNT_JSON` to `.env.example` and local `.env` files; installed `google-auth-library` in `frontend`.
- **Verified end-to-end**: authenticated Vertex calls return HTTP 200 for Gemini 2.5 Flash / Flash-Lite / Pro on the `aquacellum` project.
- **Security**: the downloaded service-account key was moved out of the repo to `%USERPROFILE%\.gcp\` and `.gitignore` patterns added (`aquacellum-*.json`, `*-service-account*.json`, etc.). Key was never committed.
- **New docs**: `docs/GOOGLE_VERTEX_MIGRATION.md` (full migration guide), `docs/GOOGLE_ACCOUNT_MANAGER_TALKING_POINTS.md` + `docs/GOOGLE_AM_ONE_PAGER.md` (current usage, services of interest, cost/credit-burn estimates for the account-manager meeting).

### Imagen 4 Reef Asset Generation (Vertex)
- **`imagen_generate.py` migrated to Vertex**: `genai.Client(vertexai=True, project=..., location=...)`; gating switched from `GEMINI_API_KEY` to `GCP_PROJECT_ID`.
- **Generated the static reef art** (billed to credits): 12 biome textures (6× floor + backdrop), 36 hardscape cutouts, and 312/316 species sprites.
- **Robustness fixes**:
  - Sci-name-only retry fallback for species whose common names trip Imagen's person-safety filter (e.g. "Oscar", the "Julie" cichlids returned empty images).
  - `FLOOR_STYLE` prompt now includes `no text, no watermark, no labels, no writing, no logo, no UI` — fixes floor textures that hallucinated stock-site chrome (e.g. an Iwagumi floor with a `lexica.art` URL and CSS baked in).
  - Added `--kind` / `--index` flags to regenerate a single hardscape cutout (e.g. one bad driftwood) without re-rolling a whole biome.
- **Species sprites are staging-only**: Imagen species accuracy is unreliable (wrong species/morphs, e.g. swordtail → sword-wielding creature), so the 316 sprites were moved out of the repo to `Desktop\review images\` for manual review/approval. The reef continues to use existing `species-cutouts` / `species-images`. Nothing in the app references `species-sprites`.

### Reef Environment Textures (GenerativeReef.jsx + ReefEnvironment.jsx)
- **Biome floor textures**: substrate plane now maps `/biomes/{biome}/floor.png` (tiled, repeat 5), loaded via R3F `useLoader` (cached, Suspense-backed) to avoid a texture-disposal flicker that briefly blanked the floor.
- **Underwater backdrop**: `/biomes/{biome}/backdrop.png` wrapped on an open inward-facing cylinder around the scene horizon.
- **Applied to all six biomes** and the **default Main Reef** (`ReefEnvironment` uses the `dutch_planted` set); `BiomeFloor`/`BiomeBackdrop` exported for reuse.
- **Hardscape**: tried 2D cutout billboards for rocks/driftwood but they either pivoted with the camera or read as crossed photos — reverted to the procedural 3D dodecahedron rocks + cylinder driftwood (the cutouts can later be lifted to real 3D via the existing TripoSR pipeline).

### Fish Floor Clamp (FishSchool.jsx + SpeciesSwarm.jsx)
- **Fixed fish clipping below the substrate** (floor at `y = -3`): added a hard world-space floor clamp in the swim loop (fish kept at/above `-2.6`, downward velocity zeroed at the plane). The previous depth check was a soft nudge in local space that let fish sink through.
- **Bottom-dweller school centers** were being seeded as low as `~-4.1`; now clamped to `≥ -2.4` so schools never start under the floor.

---

## June 10, 2026 — Immersive Reef Visual Overhaul & Freshwater Biomes

Rebuilt the 3D reef from a rough saltwater prototype into a polished freshwater aquarium experience. Migrated from TripoSR GLB models to clean cutout sprites, generated transparent backgrounds for all 313 species, created 6 unique freshwater biomes, and implemented dense real-plant environments.

### 3D Model Pipeline (TripoSR Texture Baking)
- **Fixed CUDA device mismatch bug** in TripoSR's `bake_texture.py` — added a runtime monkey-patch (`_patch_bake_texture_device`) that moves query positions to the GPU, enabling the bake pass to run successfully on RTX 5080
- **Regenerated 19 models with `--bake-texture`**: 4 Echo tiers + 15 hero species at 2048px UV-mapped PBR texture atlases
- **Pivot to cutout sprites**: TripoSR meshes (especially flowing-fin fish like betta/Echo) read as rough foil; clean cutout billboards look uniformly better. GLB path preserved behind `USE_HERO_GLB` flag in FishSchool.jsx

### Species Cutout Generation (313 transparent billboards)
- **Built `cutout_species_images.py`**: rembg (u2net) background removal pipeline with alpha floor cleanup and tight crop
- **Processed 313/313 species** — all now render as clean fish silhouettes on transparency
- **Fixed fish-in-hand photos**: automated skin-suppression for Variatus Platy, manual Paint.NET edits for 8 additional species (devario-aequipinnatus, pangio-oblonga, nomorhamphus-liemi, nannostomus-marginatus, bunocephalus-coracoideus, baryancistrus-xanthellus, botia-almorhae, melanochromis-auratus)
- **Built detection tools**: `scan_hand_cutouts.py` (scored all 313 by skin-tone × smoothness × blob size), `hand_suspects_contact_sheet.py` (visual review grid)

### Echo Companion (Sprite Rewrite)
- **Generated 4 Echo cutouts** from source JPGs (echo-fry, echo-silver, echo-mid, echo-evolved) via rembg
- **Rewrote CompanionGuide.jsx** as a cutout billboard sprite with camera-follow, mood reactions, tier scale-in transition (ease-out-back), and glow point light

### Freshwater Environment Overhaul
- **Created `PlantedEnvironment.jsx`**: 80 real plant cutout instances scattered in 3 depth layers (carpet: cryptocoryne-parva/bucephalandra; midground: anubias/bacopa/ludwigia/hygrophila/crypts; background: vallisneria/echinodorus). Each instance is a yaw-billboarded, base-anchored plane with a gentle sway animation
- **Fixed tall plant orientation**: separated billboard yaw from sway pivot into nested groups; `forcePortrait` flips landscape source images to upright for grass-like plants (vallisneria, echinodorus)
- **Classified aquatic plants in `flora.js`**: 40+ genus prefixes to route plant species to substrate-rooted flora rendering instead of swimming sprites
- **Built `ReefFlora.jsx`**: individual catalog plant species render as multi-blade swaying clumps on the floor

### Environment Rendering (ReefEnvironment.jsx)
- **Freshwater lighting**: shifted from ocean-blue to warm amber/green palette (ambient #d4e8d0, directional #ffe8c0, point lights green #4caf50)
- **Removed saltwater elements**: coral garden deleted, replaced with scattered real plants
- **Rocks restyled**: Seiryu/dragon stone palette (blue-gray), flat-shaded dodecahedrons, scattered across wider world
- **Driftwood doubled**: 12 pieces spread across 160-unit world
- **Substrate**: warm gravel-brown (#4a3a28)
- **Fog & clear color**: green-tinted freshwater (#0b1f1a fog, #081a14 clear)

### 6 Freshwater Biomes (GenerativeReef.jsx)
Complete rewrite of the biome system from 5 saltwater templates to 6 unique freshwater aquascape styles:

| Biome | Signature | Plants | Hardscape |
|-------|-----------|--------|-----------|
| 🌑 Amazon Blackwater | Tannin-dark, dim amber, falling leaf detritus | Swords + crypts | 22 driftwood pieces, leaf litter |
| 🌿 Dutch Planted | Lush jungle, pearling oxygen bubbles | 110 plants (7 species, layered) | Light rocks |
| 🏞️ Asian Stream | Clear cool water, sideways-drifting current particles | Vals + crypts | 26 smooth river pebbles |
| 🪨 African Rift Lake | Bright blue, sandy floor | Sparse vals | 40 ochre rocks in stacked piles |
| ⛩️ Iwagumi Stone Garden | Minimalist zen, arranged stones, negative space | 70 carpet plants | 7 arranged Seiryu stones |
| 💎 Crystal Spring | Gin-clear turquoise, brilliant god rays | Tall vals | 14 white limestone rocks |

- Each biome has unique: clear color, fog range, lighting, floor color, rock palette, driftwood density, plant selection, particle behavior (rise/fall/flow), bubble count
- **Fixed biome switching**: added `key={biome}` to force remount, preventing stale state when switching directly between biomes

### Layout & Exploration
- **Expanded world 3–4x**: biome zones now radius 16–28 (vs. 8–12), species spread across 160×160 unit floor
- **Deterministic placement**: seeded PRNG from species slug ensures stable positions between reloads
- **Wider school spread**: individual fish drift in 6-unit sphere (vs. 4), initial positions 4× wider
- **Smaller schools**: default 2 fish (vs. 3) for less crowding per encounter
- **60 species rendered** in master mode (vs. 40)

### Rendering Quality
- **`enhanceFishMaterials.js`**: added env map support (IBL from `reefEnvMap.js` — procedural underwater gradient cubemap, cached per renderer). Roughness tuned to 0.7/0.75 to avoid foil look
- **Sprite sizing**: each sprite uses its real aspect ratio (no stretch), `depthWrite: false` for clean layering, `alphaTest: 0.2` for crisp edges
- **Cutout preference**: `FishSchool.jsx` prefers `/species-cutouts/` (transparent) over `/species-images/` (opaque photo), with fallback chain

### New Files
| File | Purpose |
|------|---------|
| `frontend/scripts/cutout_species_images.py` | rembg batch background removal (313 species) |
| `frontend/scripts/fix_variatus_hand.py` | Automated hand removal for Variatus Platy |
| `frontend/scripts/fix_hand_cutouts.py` | Batch skin-suppression for fish-in-hand photos |
| `frontend/scripts/scan_hand_cutouts.py` | Score all cutouts by smooth skin blob fraction |
| `frontend/scripts/hand_suspects_contact_sheet.py` | Visual review grid for manual QA |
| `frontend/scripts/verify_hand_fixes.py` | Post-edit verification of cleaned cutouts |
| `frontend/public/species-cutouts/*.png` (313 files) | Transparent fish/plant cutouts |
| `frontend/public/echo-*.png` (4 files) | Echo companion tier cutouts |
| `frontend/src/reef/PlantedEnvironment.jsx` | Dense real-plant cutout scatter (80 instances) |
| `frontend/src/reef/ReefFlora.jsx` | Catalog plant species as swaying floor billboards |
| `frontend/src/reef/flora.js` | Plant genus classifier |
| `frontend/src/reef/utils/reefEnvMap.js` | Procedural IBL env map for fish materials |

### Modified Files
| File | Changes |
|------|---------|
| `frontend/scripts/trellis_generate.py` | Added `_patch_bake_texture_device()` CUDA fix |
| `frontend/src/reef/CompanionGuide.jsx` | Rewritten as cutout sprite |
| `frontend/src/reef/FishSchool.jsx` | Cutout preference, hero GLB flag, wider school spread |
| `frontend/src/reef/SpeciesSwarm.jsx` | Wide explorable layout, plant routing, deterministic placement |
| `frontend/src/reef/ReefEnvironment.jsx` | Freshwater lighting, real plants, no coral |
| `frontend/src/reef/GenerativeReef.jsx` | 6 freshwater biomes (full rewrite) |
| `frontend/src/reef/ImmersiveReef.jsx` | Freshwater clear color, biome key-remount |
| `frontend/src/reef/ProceduralSwim.jsx` | IBL env map support |
| `frontend/src/reef/utils/enhanceFishMaterials.js` | Env map, tuned roughness |

### Next Steps
- Source 20–30 additional freshwater plant photos for denser variety
- Download poly.pizza / Sketchfab props (rocks, driftwood GLBs) for the `ReefProps` loader
- Decimation pass on the 19 hero GLBs (currently 55–125k faces each) for when `USE_HERO_GLB` is re-enabled
- Clickable environment props (plants/rocks show info cards)
- Replace procedural driftwood/rocks with real 3D assets

---

## June 9, 2026 — Species Database Enrichment (FishBase v25.04 Verified Data)

Complete overhaul of the species catalog data layer — replaced LLM-generated placeholder values with verified data extracted directly from the FishBase v25.04 MySQL backend (via HuggingFace parquet dataset) and Seriously Fish species profiles.

### Data Pipeline Built
- **FishBase parquet extraction**: Downloaded 6 tables from `cboettig/fishbase` HuggingFace dataset (species, ecology, reproduc, spawning, fooditems, estimate) — 36,132 species, 59,152 food item records
- **Species matching**: Matched 279/316 catalog species against FishBase by scientific name and SpecCode
- **Seriously Fish scraper**: Built and ran automated scraper for 172 species, successfully extracted diet and reproduction data for 135 species
- **Manual verification**: 46 species with known tank size overrides, trophic corrections, and taxonomy fixes

### Data Corrections (from FishBase verified)
- **276 maxLengthCm values corrected** using FishBase Total Length (TL) measurements
- **19 significant size discrepancies fixed** (e.g., Goldfish 30→48cm, Neon Tetra 4→2.7cm, Discus 20→16.7cm)
- **70 trophicLevel classifications corrected** using FishBase DietTroph and FeedingType fields
- **Trophic overrides**: Oscar→Carnivore, Kuhli Loach→Omnivore, Discus→Omnivore (from numeric trophic levels)

### Data Gaps Filled
- **minVolumeGallons**: 0/316 → **316/316** (100%) — calculated from verified TL with behavior-based adjustments and expert overrides
- **ecology.biotope**: 283/316 → **316/316** (100%) — plants/inverts filled with Tropica/aquarium sourced descriptions
- **diet.fooditems**: 28/316 → **292/292 fish** (100%) — FishBase food items + Seriously Fish diet text
- **reproduction.spawningTrait**: 29/316 → **292/292 fish** (100%) — FishBase RepGuild + Seriously Fish reproduction profiles
- **ecology.socialBehavior**: 283/316 → **316/316** (100%)

### Accuracy Validation
- Tank size spot-check: **26/29 correct** within 5gal of Seriously Fish/aquarium consensus
- Trophic level check: **18/18 correct** against known classifications
- Spawning method check: **9/10 correct** keyword match against known breeding methods

### Scripts Created
| Script | Purpose |
|--------|---------|
| `scripts/extract-fishbase-data.mjs` | Reads FishBase parquet files, extracts verified data for 279 species |
| `scripts/merge-verified-data.mjs` | Merges FishBase data into proposed JSON with tank size calculation |
| `scripts/scrape-seriously-fish.mjs` | Scrapes seriouslyfish.com for diet/reproduction (135 species) |
| `scripts/merge-seriously-fish.mjs` | Integrates Seriously Fish data into master file |
| `scripts/fill-remaining-gaps.mjs` | Plants, invertebrates, and final fish ecology data |
| `scripts/fill-final-gaps.mjs` | Last 45 species manual fill |

### Data Files
| File | Size | Content |
|------|------|---------|
| `fishbase_verified_data.json` | ~800 KB | Raw FishBase extraction for 279 species |
| `seriously_fish_data.json` | ~400 KB | Scraped diet/reproduction for 135 species |
| `fishbase_species.parquet` | 5.0 MB | FishBase species table (36,132 species) |
| `fishbase_ecology.parquet` | 1.4 MB | FishBase ecology table |
| `fishbase_spawning.parquet` | 0.5 MB | FishBase spawning table |
| `fishbase_fooditems.parquet` | 1.9 MB | FishBase food items (59,152 records) |
| `fishbase_reproduc.parquet` | 0.6 MB | FishBase reproduction table |
| `fishbase_estimate.parquet` | 2.6 MB | FishBase estimates (TL, trophic, temp prefs) |

### Production File Updated
- `frontend/public/fishbase_master_proposed.json` — 316 species, 713 KB, schema-validated, JSON round-trip verified

---

## June 9, 2026 — 3D Model Pipeline & Immersive Reef Improvements

Set up local 3D fish model generation using TripoSR on RTX 5080, generated Echo companion models, and iterated on reef rendering quality.

### 3D Model Generation Pipeline
- **Miniconda installed** with Python 3.10 conda env (`trellis`)
- **PyTorch 2.11.0+cu128** installed — fully compatible with RTX 5080 (sm_120, 17.1 GB VRAM)
- **TRELLIS attempted** — patched sparse attention modules for SDPA support, but the sparse diffusion step is incompatible with sm_120 without flash_attn/xformers kernels (deferred until those ship sm_120 support)
- **TripoSR deployed** — Stability AI's feedforward image-to-3D model, runs at ~2 seconds per fish with zero compatibility issues
- **26 fish GLB models generated** (26.5 MB total) including all priority species
- **4 Echo evolution models generated**: `echo-fry.glb`, `echo-silver.glb`, `echo-mid.glb`, `echo-evolved.glb`
- **Batch script**: `frontend/scripts/trellis_generate.py` — processes all 311 species images locally

### Reef Rendering Fixes
- **Vertex color support**: TripoSR GLBs export COLOR_0 without normals — added `computeVertexNormals()` and gamma correction (power 0.55) for proper display
- **Sprite-first rendering**: Disabled GLB loading in favor of sprite billboards (TripoSR blob quality not production-ready). GLB code preserved for future high-quality models
- **Fish movement**: Slowed boid velocities ~4x, added Y-axis damping and depth clamping to prevent fish floating up
- **Scene lighting**: Boosted ambient + added hemisphere light + secondary directional for better 3D model visibility
- **Content-type check**: Fixed Vite SPA fallback false-positive on GLB HEAD requests

### Echo Companion — 3D Model Integration
- **CompanionGuide.jsx** rewritten to load tier-specific Echo GLB models (Bronze→Fry, Silver→Silver, Gold→Mid, Master→Evolved)
- Procedural swim animation applied to Echo's mesh (spine undulation, vertical bob)
- Suspense fallback to procedural geometry if GLB fails to load

### Files Created
| File | Purpose |
|------|---------|
| `frontend/scripts/trellis_generate.py` | TripoSR batch generation script |
| `frontend/scripts/generate_fish_models.py` | Multi-backend generation (Tripo API + HF Space) |
| `frontend/public/models/fish/*.glb` (26 files) | Generated 3D fish models |

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/reef/CompanionGuide.jsx` | Rewritten: loads Echo GLB by tier, swim animation |
| `frontend/src/reef/ProceduralSwim.jsx` | computeVertexNormals, gamma correction, reduced model scale |
| `frontend/src/reef/FishSchool.jsx` | Sprite-first mode, slower movement, Y-axis damping |
| `frontend/src/reef/ReefEnvironment.jsx` | Brighter lighting (hemisphere + boosted directional) |
| `frontend/scripts/TRELLIS_SETUP.md` | Rewritten for TripoSR local workflow |

### Next Steps (3D Models)
- Re-generate with `--bake-texture` for UV-mapped textures (much better than vertex colors)
- Investigate Rodin Gen-2 / InstantMesh for better fish topology
- Consider parametric fish mesh generator (body profile + projected texture)

---

## June 8, 2026 — Technical Debt Audit & Codebase Cleanup

Performed a full staff-level codebase audit against `PROJECT_SUMMARY.md` specification. Eliminated dead weight, consolidated scattered assets, unified backend migrations, and decomposed oversized components.

### Files & Folders Removed (~150+ files)
- **14 debug/scratch scripts** deleted from `frontend/`: `trace-error[1-6].mjs`, `__tmp_frag_*.json`, `_sanity_personality.mjs`, `tmp-personality-check.mjs`, `scan_emoji_tmp.cjs`, `check-bundle.js`
- **3 build-dir pollutants** deleted: `_emoji_scan.cjs`, `_nonascii_scan.cjs`, `__t7_master_backup.json` from `frontend/dist/`
- **Stale root `dist/`** directory removed entirely (orphaned build artifacts from pre-Vite era)
- **6 root-level migration artifacts** deleted: `_gen_progress.cjs`, `generate_final_list.py`, `antigravity_master_pipeline.py`, `species_rows.csv`, `final_output.json`, `migration_errors.log`
- **`Poseidon/` folder eliminated**: planning docs moved to `docs/`, `prep_ai_context.py` moved to `scripts/`, duplicate echo images removed
- **`__pycache__/`** removed
- **`migration_assets/` (107 PNGs)** + **`local_data/` (6 files)** untracked from git via `git rm --cached` and added to `.gitignore`

### Supabase Migrations Consolidated
- Unified two conflicting migration directories (`supabase/migrations/` and `frontend/supabase/migrations/`) into a single canonical sequence:
  - `001_reef_mvp_schema.sql` through `010_depth_score_and_moderation.sql`
- Deleted `frontend/supabase/` entirely — root `supabase/` is now the single source of truth
- Resolved version-number collision (both dirs previously had conflicting `003`/`004` files)

### Documentation Consolidated
- Moved 5 root-level markdown docs into `docs/`: `BASE_GRANT_OVERVIEW.md`, `BASE_TESTNET_DEPLOYMENT_CHECKLIST.md`, `CURATION_STANDARD.md`, `PROPOSAL.md`, `ONBOARDING_WIZARD_TASKS.md`
- Moved 3 Poseidon planning docs into `docs/`: `POSEIDON_ECHO_BRAINSTORM.md`, `POSEIDON_ECHO_LIGHT_V1_BETA_PLAN.md`, `POSEIDON_ECHO_V1_ONE_PAGE_SUMMARY.md`
- Root now has only: `README.md`, `CHANGELOG.md`, `PROJECT_SUMMARY.md`

### Component Decomposition
| Extracted File | Lines | Source |
|---|---|---|
| `CompanionFishEntity.jsx` | 275 | Was inline in `TankList.jsx` — animated companion fish with tier evolution |
| `TankQRCode.jsx` | 24 | Was inline in `TankList.jsx` — QR code canvas renderer |
| `CurationQueuePanel.jsx` | 162 | Was inline in `BreedGallery.jsx` — curator approval/reject panel |

- `TankList.jsx`: ~2,800 → 2,495 lines (–305)
- `BreedGallery.jsx`: ~2,957 → 2,810 lines (–147)
- Consolidated scattered mid-file imports to top of `TankList.jsx`

### PROJECT_SUMMARY.md Updates
- Updated Social Backend description to reflect 8 Edge Functions (was incorrectly listed as 2)
- Added canonical project structure tree to Section 7
- Added migration consolidation note

### .gitignore Updates
- Added `migration_assets/` and `local_data/` exclusions

---

## June 7, 2026 — Discovery Features (Task 17) — Social Reef 70/70 Complete

Built the three remaining discovery sub-features for the Discover tab. All 70 Social Reef tasks are now complete.

### Nearby Breeders
- **`useNearbyBreeders()` hook**: Queries profiles by shared `zone_hash` prefix (first 4 chars = same region). Fallback: shows recently-active breeders if the current user has no zone set.
- Displays up to 10 regional breeders sorted by XP.

### Breeders Who Keep [Species]
- **`useBreedersForSpecies(query)` hook**: Searches `currents.species_tags` for matching species, deduplicates by wallet, returns breeder profiles (max 15).
- Search input with real-time results; fallback to client-side filter if Supabase `cs` operator fails.

### Top Contributors This Week
- **`useTopContributors()` hook**: Tallies `species_insights` posts + `expert_audits` given since Monday 00:00 UTC. Ranks top 10 by combined activity score.
- Leaderboard with medal ranks (🥇🥈🥉), insight/audit count badges, profile navigation.

### Integration
- **`DiscoveryPanel.jsx`**: Collapsible three-section panel with accessible keyboard navigation, mode-aware copy (casual/pro), and responsive layout.
- Rendered at the top of the Discover tab in `ReefFeed.jsx` — visible when users switch to "Explore".
- Build passes clean; no new dependencies.

### Files Created
| File | Purpose |
|------|---------|
| `frontend/src/hooks/useDiscovery.js` | Discovery query hooks (nearby, species, contributors) |
| `frontend/src/components/reef/DiscoveryPanel.jsx` | Discovery UI component |

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/components/reef/ReefFeed.jsx` | Imported DiscoveryPanel, renders on Discover tab |
| `frontend/src/components/reef/index.js` | Added DiscoveryPanel export |
| `.kiro/specs/social-reef/tasks.md` | Task 17 marked complete (70/70) |

---

## June 7, 2026 — Social Reef Phase 5 Complete: Search, Production Hardening & Launch Prep

Completed the final phase of The Reef social layer. All 70 tasks across 5 phases are now shipped (except auto-transcription, deferred until Virtual Tides go live).

### Search — Supabase Full-Text (Tasks 60-61)
- **`useReefSearch.js`**: Debounced ilike queries across 5 content types (profiles, currents, schools, tides, insights) in parallel. TanStack Query caching (30s stale).
- **`ReefSearchBar.jsx`**: Expandable search trigger in ReefFeed header. Dropdown results grouped by type with counts. Keyboard shortcut (`/` to focus, `Escape` to dismiss). Mobile-responsive fixed overlay.
- Integrated into existing global navigation flow — click results navigate to profiles, schools, or tides.
- Decision: Supabase ilike over Typesense. No external search dependency needed for current scale.

### Virtual Tides — Coming Soon Gate (Task 63)
- **CreateTide.jsx**: Virtual tide type disabled with purple "Coming Soon" badge. Users cannot select it.
- **TidePage.jsx**: Virtual tides show informational panel instead of stream link.
- All underlying infrastructure stays intact (stream_url field, realtime channels, TideChat, TideLiveFeed).

### Rate Limiting (Task 65)
- **`rateLimiter.js`**: Client-side throttle using localStorage with pruning. Limits: 10 posts/hr, 50 comments/hr, 100 reactions/hr, 3 audits/day, 1 school/day, 20 Poseidon/hr.
- Wired into `reefApi.js`: `createCurrent`, `postComment`, `toggleReaction` all check limits before hitting Supabase.
- User-friendly error messages with retry-after time formatting.
- `withRateLimit()` higher-order function for wrapping any async action.

### Moderation Admin Panel (Task 66)
- **`ModerationPanel.jsx`**: Curator-accessible flagged content queue.
- Actions: dismiss, hide content, warn user, mute 24h/7d, ban.
- Fetches from `moderation_flags` table with reporter profile joins.
- Poseidon AI summary display, escalation history viewer, prior warnings indicator.
- Filter tabs: Pending / Resolved / All with live counts.

### GDPR Data Export & Deletion (Task 67)
- **`gdprService.js`**: `exportUserData()` — parallel fetch across 9 tables → structured JSON. `requestAccountDeletion()` — soft-delete with 30-day grace. `cancelAccountDeletion()` — reversal during grace period.
- **`DataPrivacySettings.jsx`**: Export button, deletion confirmation (typed "DELETE MY ACCOUNT"), grace period countdown banner with cancel option.
- Integrated into ProfileEdit component as a collapsible section at the bottom.

### Performance Optimization (Task 68)
- **Code-splitting**: ReefFeed lazy-loaded via `React.lazy()` + Suspense with skeleton placeholder.
- Reef social chunk now separate (~21 kB gzipped) — main bundle reduced by ~157 kB.
- Existing optimizations verified: WebP uploads, client-side resize, Supabase Realtime connection pooling (10 events/sec).

### Accessibility (Task 69)
- **`a11y.js`**: Focus trap utility, `announce()` for live region screen reader messages, `handleKeyActivate()` for keyboard interaction, `reactionAriaLabel()` for descriptive labels.
- `prefersReducedMotion()` detection, WCAG AA color contrast checker utility.
- Verified existing ARIA: ReactionBar has `role="group"`, `aria-pressed`, `aria-label`; SearchBar has `role="listbox"`, keyboard shortcut.

### Integration Testing (Task 70)
- **`reef-integration.test.js`**: 17 tests covering the critical social path.
- Rate limiter: allow within limits, record actions, block at ceiling, daily limits, unknown actions graceful.
- Profile CRUD, content lifecycle (create → feed → react → comment), social connections, GDPR export shape validation, notification retrieval.
- All 17 passing via `vitest run`.

### Files Created
| File | Purpose |
|------|---------|
| `frontend/src/hooks/useReefSearch.js` | Supabase social search hook |
| `frontend/src/components/reef/ReefSearchBar.jsx` | Global search UI component |
| `frontend/src/services/rateLimiter.js` | Client-side rate limiting service |
| `frontend/src/services/gdprService.js` | Data export & account deletion |
| `frontend/src/components/reef/ModerationPanel.jsx` | Admin moderation panel |
| `frontend/src/components/reef/DataPrivacySettings.jsx` | GDPR settings UI |
| `frontend/src/utils/a11y.js` | Accessibility utility functions |
| `frontend/src/__tests__/reef-integration.test.js` | Integration test suite |

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/components/reef/CreateTide.jsx` | Virtual type gated with Coming Soon |
| `frontend/src/components/reef/TidePage.jsx` | Virtual tide Coming Soon panel |
| `frontend/src/components/reef/ReefFeed.jsx` | Search bar integrated in header |
| `frontend/src/components/reef/ProfileEdit.jsx` | DataPrivacySettings section added |
| `frontend/src/components/reef/index.js` | New component exports |
| `frontend/src/services/reefApi.js` | Rate limiting wired into mutations |
| `frontend/src/App.jsx` | React.lazy code-splitting for ReefFeed |
| `frontend/src/styles/index.css` | Search bar + Coming Soon badge styles |
| `.kiro/specs/social-reef/tasks.md` | Phase 5 tasks marked complete |
| `PROJECT_SUMMARY.md` | Phase 5 features documented |

---

## June 6, 2026 — Beta Readiness: Legal, Privacy & About Pages

Added all legal and informational pages required for beta tester distribution. Full glassmorphic design system integration, responsive layouts, and Vercel routing.

### New Pages
- **`/about`** (`about.html`): Mission statement, "What We're Building" cards (Hobbyists, Breeders, The Reef, AI), team section (GGSteve92 & McDermKev81, Founders), values grid (Privacy First, Conservation Backed, Community Driven, Local-First, Fun Not Friction, Open & Transparent), contact section (kevin@aquacellum.com)
- **`/legal`** (`legal.html`): Single-page hub with anchor navigation across 4 sections:
  - **Terms of Service** (`#terms`): 13+ age requirement, wallet responsibility, beta disclaimer, acceptable use policy, IP rights, marketplace disclaimer (platform facilitator not party), 4% fee disclosure, liability cap ($100 USD), NY governing law, termination policy
  - **Privacy & Data Collection** (`#privacy`): Full data inventory (collected vs. not collected), zero analytics disclosure, storage breakdown (Dexie local, Supabase, blockchain), third-party services (Privy, Vercel, Gemini AI, Supabase), COPPA compliance, data retention & deletion rights, security measures (RLS, JWT auth, location fuzzing, commit-reveal)
  - **Beta Program Terms** (`#beta`): Testnet-only disclaimer, data wipe warning, feature instability notice, feedback IP grant, no mainnet guarantees, gasless relayer explanation, embedded wallet caveats
  - **Community Guidelines** (`#community`): Respect standards, fraud/lineage honesty rules, content standards, marketplace conduct, AI usage expectations, enforcement escalation (warning → mute → suspend → ban), Schools/Tides event conduct

### Infrastructure Updates
- `vite.config.js`: Added `about` and `legal` to multi-page build inputs
- `vercel.json`: Added `/about` and `/legal` rewrites for clean URLs
- `index.html`: Footer updated with About, Terms, and Privacy links

### Files Created/Modified
| File | Change |
|------|--------|
| `frontend/about.html` | New — About page |
| `frontend/legal.html` | New — Legal hub (ToS, Privacy, Beta Terms, Community Guidelines) |
| `frontend/vite.config.js` | Added 2 new build entries |
| `frontend/vercel.json` | Added 2 new rewrites |
| `frontend/index.html` | Footer links updated |
| `PROJECT_SUMMARY.md` | Landing Pages section updated |

---

## June 6, 2026 — The Reef Landing Page

Dedicated static landing page for the Social Reef feature at `/reef`. Coral/ocean-blue palette, distinct from all other pages.

### Built
- **`frontend/reef.html`**: Full landing page with hero (mock feed UI preview), "How the Reef Works" step cards (mini UI mockups: feed card, Tankmate connections, Depth Score meter), bento-grid feature showcase (audit scorecards, spawn lifecycle, Sonar notifications, Poseidon AI messages, Species Insights), Depth Score tier ladder (Shallow→Hadal with gradient bar), Schools section (mock clubs with member avatars), and Tides section (expanded Expo card with GPS map + swap sheet + countdown, Virtual stream preview, Auction bid preview, Challenge leaderboard)
- **Ambient design system**: Coral/ocean-blue CSS tokens, glassmorphic cards with per-color hover glows, animated coral branch dividers, wave SVG section separators, hero grid mesh, floating reaction emojis, CSS-only aquarium scenes (animated fish + plants + bubbles)
- **Routing**: Added to `vite.config.js` build inputs, `vercel.json` rewrites (`/reef` → `/reef.html`), main site navigation

### Files Created/Modified
| File | Change |
|------|--------|
| `frontend/reef.html` | New — full landing page (1700+ lines) |
| `frontend/vite.config.js` | Added `reef` entry to multi-page build |
| `frontend/vercel.json` | Added `/reef` rewrite |
| `frontend/index.html` | Added "The Reef" to nav links |
| `PROJECT_SUMMARY.md` | Added Landing Pages section |

---

## June 6, 2026 — The Reef: Phase 4 — Depth Score + Poseidon Social AI

Complete reputation system and AI-powered social intelligence layer. All Edge Functions deployed and active.

### Depth Score System (Tasks 56-59)
- **Database migration** (`004_depth_score_and_moderation.sql`): `depth_score_events`, `moderation_flags` tables + profile columns (`depth_score`, `depth_tier`, `poseidon_summary`)
- **Auto-calculation triggers**: score updates on expert audit creation (+15 auditor, +10 recipient), insight upvote milestones (+5 at 5 votes, +10 at 15), moderation action (-50)
- **Tier auto-promotion**: Shallow (0) → Coastal (100) → Pelagic (500) → Abyssal (1500) → Hadal (5000+)
- **DepthScoreMeter component**: progress bar, tier badge, expandable event history, "What is Depth Score?" explainer
- **Tier privileges API**: graduated permissions (post insights, create schools, give audits, mentor, host tides, moderate)
- **Anti-gaming Edge Function** (`anti-gaming`): detects mutual upvote rings, 24h score spikes from single source, high-activity zero-engagement accounts

### Poseidon Social AI (Tasks 48-49, 51-53)
- **Reef Digest** (`reef-digest`): weekly personalized digest for each active user — tankmate highlights, trending insights, upcoming tides. Gemini-generated, stored as Sonar notification.
- **Breeder Summary** (`breeder-summary`): weekly 2-sentence AI profile blurb based on species focus, audits, schools, activity. Stored in `profiles.poseidon_summary`.
- **Tide Narration** (`tide-narration`): two modes — live narration (posts system messages every 15 min during active tides) and post-event recap (structured JSON with stats + AI summary).
- **Content Moderation** (`content-moderation`): spam pattern matching + Gemini text/image classification. Auto-hides flagged content, creates moderation_flags entry with AI confidence score.
- **Mentor Matching** (`mentor-match`): AI-powered pairing — analyzes user species/struggles vs. mentor expertise/availability/depth score. Heuristic fallback when Gemini unavailable.

### Edge Functions Deployed (8 total, all ACTIVE)
| Function | Schedule | Purpose |
|----------|----------|---------|
| `send-push` | On demand | VAPID push delivery |
| `tide-lifecycle` | Every minute | Status transitions + XP + chat purge |
| `reef-digest` | Sunday 9am UTC | Weekly personalized digest |
| `breeder-summary` | Monday 3am UTC | AI profile summaries |
| `content-moderation` | On content insert | Auto-flag inappropriate content |
| `tide-narration` | During live tides | Live narrator + recap generation |
| `mentor-match` | On demand | AI mentor pairing |
| `anti-gaming` | Daily 4am UTC | Reputation fraud detection |

### Files Created
| File | Purpose |
|------|---------|
| `supabase/migrations/004_depth_score_and_moderation.sql` | Depth Score + moderation tables |
| `supabase/functions/reef-digest/index.ts` | Weekly Reef Digest |
| `supabase/functions/breeder-summary/index.ts` | AI profile summaries |
| `supabase/functions/content-moderation/index.ts` | Text + image moderation |
| `supabase/functions/tide-narration/index.ts` | Live narration + recaps |
| `supabase/functions/mentor-match/index.ts` | AI mentor pairing |
| `supabase/functions/anti-gaming/index.ts` | Reputation fraud detection |
| `frontend/src/services/depthScoreApi.js` | Depth Score API + privileges |
| `frontend/src/hooks/useDepthScore.js` | Depth Score React hooks |
| `frontend/src/components/reef/DepthScoreMeter.jsx` | Score visualization component |

---

## June 6, 2026 — The Reef: Phase 3 — Tides (Events) + Web Push Notifications

Complete events system ("Tides") with real-time social interaction, GPS-gated check-ins, live auctions, and push notification infrastructure. All deployed and live on aquacellum.com.

### Tides Infrastructure
- **Database migration** (`003_tides_tables.sql`): 4 new tables — `tides`, `tide_attendees`, `tide_chat`, `auction_bids`
- **RLS policies**: tide_chat restricted to attendees, bids publicly readable, RSVP self-managed
- **Notification triggers**: auto-notify RSVPs when tide goes live, notify previous bidder on outbid
- **Indexes**: status+start_time, wallet lookups, chat by tide+time, bids by tide+token

### Tide Components
- **TideCalendar**: grid/list view of upcoming events, type filters (Expo/Virtual/Challenge/Auction), countdown timers, "My Tides" section
- **CreateTide wizard**: 3-step form — type selection → details (title, time, banner) → type-specific settings (GPS/stream/challenge rules/auction items)
- **TidePage**: full event detail with tabbed interface — Details / Live Feed / Chat / Map / Swap Sheet / Auction / Recap. Three display states: pre-event, live, post-event
- **TideLiveFeed**: real-time activity stream via Supabase Realtime channel, auto-scroll with pause/resume, activity burst indicator
- **TideChat**: ephemeral real-time chat (300-char, 5s rate limit), Poseidon system messages styled distinctly, auto-purged 48h post-event
- **TideMap**: Mapbox GL JS integration with zone overlay, fuzzed attendee pins, GPS check-in button (+100 XP), Haversine distance calculation
- **SwapSheet**: pre-event "I'm bringing..." board with species search, read-only when live
- **AuctionPanel**: real-time bidding with 5% minimum increment, countdown timer, bid history, outbid notifications

### Tide Lifecycle Edge Function
- **`tide-lifecycle`** (deployed to Supabase, scheduled via pg_cron every minute):
  - Transitions: upcoming → live → ended based on time
  - On ended: distributes attendance XP (+100 checked-in, +50 going)
  - 48h post-end: purges ephemeral tide_chat messages

### Web Push Notifications
- **VAPID key pair generated** and stored as Supabase secrets
- **Service Worker** (`sw.js`): handles push events, shows native OS notifications, routes clicks to app deep links
- **`pushService.js`**: subscribe/unsubscribe management, permission flow, stores subscription in Supabase
- **`send-push` Edge Function** (deployed): VAPID-authenticated push delivery to browser endpoints, auto-cleanup of expired subscriptions
- **`push_subscriptions` table**: stores browser push subscription JSON per wallet
- **SonarPreferences**: per-category push opt-in (Activity/Social/Events/Milestones/Poseidon), quiet hours, email digest frequency

### Services & Hooks
- `tidesApi.js`: full CRUD — tide create/update/cancel, RSVP/check-in, swap sheet, chat, auction bids
- `useTides.js`: TanStack Query hooks + Supabase Realtime subscriptions for chat, live feed, and auction bidding

### Integration
- **Reef header**: "🌊 Tides" button added alongside Schools and Profile
- **Sub-navigation**: TideCalendar → TidePage with full routing, back button, create flow
- **Mapbox token**: configured in frontend .env (`VITE_MAPBOX_TOKEN`)

### Deployment
- Edge Functions deployed: `send-push` (ACTIVE), `tide-lifecycle` (ACTIVE)
- VAPID secrets set on Supabase project
- pg_cron scheduled: `tide-lifecycle-check` running every minute
- Vercel auto-deployed from GitHub push

### Files Created (16)
| File | Purpose |
|------|---------|
| `supabase/migrations/003_tides_tables.sql` | Tides DB schema + RLS + triggers |
| `supabase/functions/tide-lifecycle/index.ts` | Cron: status transitions + XP + chat purge |
| `supabase/functions/send-push/index.ts` | VAPID push delivery to browsers |
| `frontend/public/sw.js` | Service worker for push notifications |
| `frontend/src/services/tidesApi.js` | Tides CRUD API |
| `frontend/src/services/pushService.js` | Push subscription management |
| `frontend/src/hooks/useTides.js` | Tides React hooks + realtime |
| `frontend/src/components/reef/TideCalendar.jsx` | Events calendar/grid |
| `frontend/src/components/reef/TidePage.jsx` | Event detail page |
| `frontend/src/components/reef/TideLiveFeed.jsx` | Real-time event feed |
| `frontend/src/components/reef/TideChat.jsx` | Ephemeral event chat |
| `frontend/src/components/reef/TideMap.jsx` | Mapbox GPS map + check-in |
| `frontend/src/components/reef/SwapSheet.jsx` | Species swap board |
| `frontend/src/components/reef/AuctionPanel.jsx` | Live auction bidding |
| `frontend/src/components/reef/CreateTide.jsx` | Tide creation wizard |
| `frontend/src/components/reef/SonarPreferences.jsx` | Notification preferences |

### Files Modified (4)
| File | Changes |
|------|---------|
| `frontend/src/components/reef/ReefFeed.jsx` | Added Tides sub-views + 🌊 button |
| `frontend/src/components/reef/index.js` | Exported all Phase 3 components |
| `frontend/src/styles/index.css` | Full Tides CSS (~400 lines) |
| `frontend/.env` | Added VITE_MAPBOX_TOKEN, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY |

---

## June 5, 2026 — Poseidon AI Intelligence Layer (Phase 4 Foundation)

Complete AI infrastructure buildout. Poseidon is now a Gemini-powered freshwater fish expert grounded in the curated 326-species catalog, with RAG context injection, spawn narration, natural language search, image accessibility, and user-controlled toggles.

### Poseidon Edge Function Gateway
- **`api/poseidon.js`**: Node.js serverless function routing user queries to Gemini 2.0 Flash with structured JSON schema enforcement
- **System prompt**: Encodes Curation Standard (metric scaling ×10/×100/×10000), FishBase specCode as primary key, dual-persona tone (casual/pro), available actions (CREATE_TANK, LOG_HUSBANDRY, QUERY_COMPATIBILITY, etc.)
- **Multi-turn context**: Last 6 conversation turns sent for continuity
- **Graceful degradation**: Returns structured offline fallback when API key missing or Gemini unreachable

### Species RAG Layer
- **`api/_lib/speciesIndex.js`**: Loads `fishbase_master.json` at cold-start (326 species), builds in-memory indices for fast lookup
- **Fuzzy name matching**: Exact + partial substring matching against common names, scientific names, and genus
- **Context injection**: Relevant species data (temp, pH, diet, breeding, personality text) injected into every Gemini prompt
- **`vercel.json`**: Added `includeFiles` config to bundle the catalog into the serverless function

### Frontend Integration
- **`usePoseidon.js` hook**: Manages messages, rate limiting (20/hr), session context assembly from Dexie, offline fallback
- **`PoseidonChatConsole.jsx`**: Rewired from regex worker to Edge Function gateway. Shows avatar, online status, request counter, loading state, confidence scores (pro mode)
- **Local worker preserved**: `poseidonWorker.js` retained as offline fallback

### Spawn Thread Narration (Task #50)
- **`utils/spawnNarration.js`**: Calls Poseidon to generate concise narration lines on grow-out checkpoint events
- **Context-aware**: Includes species name, days since spawn, yield funnel stats, checkpoint type
- **Non-blocking**: Fires after checkpoint save, doesn't block UI
- **Inline display**: Narration lines render in the grow-out timeline with Poseidon avatar and distinct cyan styling
- **Respects toggle**: No API calls when Poseidon is disabled

### Natural Language Search (Task #62)
- **`api/parse-search.js`**: Converts plain-English queries into structured species filters via Gemini
- **`useNaturalSearch.js` hook**: Debounced (600ms), applies parsed filters to `useSpeciesSearch`
- **Examples**: "beginner fish for warm water" → difficulty: Easy, tempMin: 26°C
- **Visual indicators**: 🔱 icon during parsing, cyan explanation chip with Poseidon avatar, one-click clear
- **Local fallback**: Regex-based parser handles common patterns when offline
- **Search placeholder updated**: "Try: 'beginner fish for warm water'"

### Image Alt-Text Generation (Task #55)
- **`api/generate-alt-text.js`**: Accepts image URL or base64, returns Gemini Vision-generated alt text (< 150 chars)
- **`utils/altTextGenerator.js`**: Client utility with localStorage caching, batch processing, fallback descriptions
- **Integrated into upload flow**: `uploadImage()` now returns `{ url, altText, error }`
- **ContentComposer**: Stores alt texts alongside media URLs on post creation
- **CurrentCard/PhotoGrid**: Renders AI-generated alt text on all `<img>` tags
- **Migration `008_media_alt_texts.sql`**: Adds `media_alt_texts jsonb` column to `currents` table

### Marketplace Compatibility Colors
- **Card border glow**: Green (≥80%), Amber (50-79%), Red (<50%) based on tank compatibility score
- **Graded badge**: Shows at all compatibility levels (not just 100%), with color-coded dot and percentage
- **Previously**: Binary — only showed badge at 100% match

### AI Settings & Controls
- **Settings tab**: New "AI Companions" card with independent toggle switches for Poseidon and Echo
- **Poseidon toggle**: Disables all Edge Function calls, spawn narration, natural language search, alt-text generation
- **Echo toggle**: Controls companion entity rendering and gamification reactions
- **localStorage**: `aquadex_poseidon_enabled`, `aquadex_echo_enabled` (default: true)
- **Immediate effect**: No reload required, emits `aquadex:ai-prefs-changed` event

### Visual Identity — Poseidon & Echo Avatars
- **`/poseidon-avatar.jpg`** (519KB): Used in chat console header, message bubbles, landing pages, settings, narration lines
- **`/echo-fry.jpg`** (224KB): Bronze Fry tier
- **`/echo-silver.jpg`** (271KB): Silver Keeper tier
- **`/echo-mid.jpg`** (254KB): Gold Aquarist tier
- **`/echo-evolved.jpg`** (264KB): God-Tier + main Echo avatar
- **Landing pages updated**: index.html (Poseidon + Echo cards), hobbyist.html (Poseidon section + tier images), breeder.html (Poseidon intelligence section)

### Files Created
| File | Purpose |
|------|---------|
| `frontend/api/poseidon.js` | Poseidon AI gateway (Gemini 2.0 Flash) |
| `frontend/api/_lib/speciesIndex.js` | Species catalog loader + fuzzy search for RAG |
| `frontend/api/generate-alt-text.js` | Image alt-text generation (Gemini Vision) |
| `frontend/api/parse-search.js` | Natural language search query parser |
| `frontend/src/hooks/usePoseidon.js` | React hook for Poseidon chat |
| `frontend/src/hooks/useNaturalSearch.js` | Natural language search hook |
| `frontend/src/utils/spawnNarration.js` | Spawn thread narration generator |
| `frontend/src/utils/altTextGenerator.js` | Alt-text generation client utility |
| `frontend/supabase/migrations/008_media_alt_texts.sql` | DB migration for alt text storage |
| `frontend/public/poseidon-avatar.jpg` | Poseidon visual identity |
| `frontend/public/echo-fry.jpg` | Echo Bronze tier image |
| `frontend/public/echo-silver.jpg` | Echo Silver tier image |
| `frontend/public/echo-mid.jpg` | Echo Gold tier image |
| `frontend/public/echo-evolved.jpg` | Echo God-Tier image |

### Files Modified
| File | Changes |
|------|---------|
| `frontend/src/components/PoseidonChatConsole.jsx` | Full rewrite: usePoseidon hook, avatar, loading state, action routing |
| `frontend/src/components/DataPortabilityWidget.jsx` | Added AI Companions settings section |
| `frontend/src/components/BreedGallery.jsx` | Natural language search integration, NL explanation chip |
| `frontend/src/components/MarketplaceBoard.jsx` | Compatibility card colors (green/amber/red glow + graded badge) |
| `frontend/src/components/HatcheryLogs.jsx` | Spawn narration integration + narration display in timeline |
| `frontend/src/components/reef/ContentComposer.jsx` | Alt-text storage on post creation |
| `frontend/src/components/reef/CurrentCard.jsx` | PhotoGrid renders AI alt text |
| `frontend/src/services/mediaUpload.js` | Alt-text generation after upload |
| `frontend/src/services/reefApi.js` | createCurrent accepts mediaAltTexts |
| `frontend/src/workers/poseidonWorker.js` | Preserved as offline fallback |
| `frontend/vercel.json` | Added functions.includeFiles for species catalog |
| `frontend/index.html` | Poseidon + Echo avatar images on landing page |
| `frontend/hobbyist.html` | Poseidon section + Echo tier images |
| `frontend/breeder.html` | Poseidon intelligence section |
| `.env.example` | Added GEMINI_API_KEY documentation |

---

## June 4, 2026 — Production Fixes & Performance Optimizations

Critical deployment fixes, major RPC performance improvements, and UI cleanup across the Aquariums tab.

### Deployment Fixes
- **Database page 404 resolved**: Added `buildCommand: "npm run build"` to `vercel.json` so Vite runs during deployment and `fishbase_master.json` is served correctly from `dist/`
- **Added `/database` rewrite** to Vercel config for routing consistency
- **Fetch error handling**: Added `res.ok` check on the database page so failed responses give a clear error instead of a cryptic JSON parse failure

### Onboarding Fix
- **Persona buttons (Pro/Casual) now always appear**: Fixed a bug where stale `aquadex_casual_mode` in localStorage from an incomplete prior session caused `casualMode` to initialize as non-null, hiding the buttons. Now only trusts stored persona if `aquadex_onboarding_complete` is set.
- **OAuth redirect flow preserved**: Redirect detection now reads directly from localStorage rather than relying on React state that resets on mount

### Performance — Parallelized Blockchain Reads
- **Breed Gallery (`useContractSpecies`)**: Rewrote from sequential `for` loop (N×2 serial RPC calls) to batched `Promise.all` (10 at a time). Reduces load time from 15-20s to 2-4s.
- **Stale-while-revalidate pattern**: Breed Gallery now shows Dexie-cached data instantly on repeat visits while refreshing from chain in the background.
- **Register tab (`MintSpecimen`)**: Species catalog fetch parallelized — all `speciesCatalog(i)` calls fire concurrently instead of sequentially.
- **Spawning tab (`SpawningWizard`)**: Species catalog + specimen ownership checks now batched 10 at a time with `Promise.all`. Previously every single minted specimen was checked one-by-one.

### UI Cleanup — Aquariums Tab
- **Merged Count/Photo into top Quick Actions bar**: Removed the redundant bottom footer bar (Count/Test/Photo) that was blocking content. Those actions now live alongside Feed/Test/Clean/Ask Poseidon in one unified toolbar.
- **Tank detail panel scrolls independently on desktop**: Changed from `position: relative` to `position: sticky` with `maxHeight: calc(100vh - 2rem)` and `overflowY: auto`. Readings no longer stay stuck on screen when scrolling — the panel scrolls within itself.

---

## June 4, 2026 — The Reef: Phase 2 — Schools & Expert Audits + Beta Infrastructure

Phase 2 of The Reef social layer implemented (Tasks 21-31). Schools (Clubs), Expert Audits, and Mentorship pairing are now built. Additionally, major beta infrastructure changes: local-first tank storage, profile UI overhaul, and compact action buttons.

### Beta Infrastructure — Gasless Local-First Architecture
- **Local-first tank registration**: Tanks now save directly to Dexie.js (no on-chain write during beta). Users never see MetaMask or gas fees.
- **Relayer pattern prepared** (`api/relay-transaction.js`): Vercel serverless endpoint for future on-chain writes using a single funded deployer wallet.
- **`useUserTanks` refactored**: Reads from Dexie first (local tanks), then merges any on-chain tanks. Privy-only users see their tanks immediately.
- **Onboarding wizard creates real tank**: Step 4 now saves a tank to Dexie so users see their tank + Echo companion after completing onboarding.
- **`getSigner()` priority**: Privy embedded wallet first, MetaMask fallback. On-chain writes deferred to relayer for beta.

### Header Profile Chip (ConnectWallet overhaul)
- **Profile chip replaces "Connected 0x..."**: Avatar circle with green status dot, display name, tier badge
- **Click to open dropdown**: "View Profile" (navigates to Reef profile) and "Disconnect" options
- **Fixed-position dropdown**: Renders at z-index 9999 with invisible backdrop, no longer clipped by header overflow or tab bar
- **Both modes show username**: Pro mode no longer shows raw wallet address

### UX Polish
- **Compact quick-action buttons**: "Update Count" → "🐟 Count", "Quick Water Test" → "🧪 Test" — smaller, flex-wrap on mobile
- **📷 Photo button added**: Upload/change tank photo directly from tank detail view (compresses and stores to localStorage)
- **Header overflow fix**: Changed from `overflow: hidden` to `overflow: visible` so dropdowns render correctly
- **XP bar border-radius**: Added bottom border-radius to XP bar since header no longer clips it

### Schools (Clubs) — Tasks 21-26
- **Database migration** (`007_schools_and_audits.sql`): 7 new tables — `schools`, `school_members`, `school_challenges`, `school_chat`, `expert_audits`, `audit_requests`, `mentorships`
- **Full RLS policies**: school chat restricted to members, challenges managed by elders/founders, audits publicly readable
- **Notification triggers**: audit received, mentorship request, mentorship accepted, school member count auto-update
- **Supabase Realtime**: `school_chat` added to realtime publication for live messaging
- **CreateSchool wizard**: 3-step form (name/slug/type → description/banner/species → settings)
- **SchoolDirectory**: grid of school cards with type filter, search, "My Schools" section, join button
- **SchoolPage**: full view with tabs (Feed/Members/Challenges/Chat/Settings), role-based member management
- **SchoolChat**: real-time persistent chat with Supabase Realtime subscription, date separators, admin moderation
- **ChallengeCard**: displays progress bar, time remaining, leaderboard, XP rewards
- **Navigation**: "🏫 Schools" button added to ReefFeed header with full routing

### Expert Audits — Tasks 27-30
- **ExpertAuditForm**: scorecard with 4 star-rating categories (Water Quality, Stocking, Husbandry, Aesthetics), commentary field
- **ExpertAuditCard**: gold-bordered display card with score visualization, auditor badge, commentary section
- **Audit request flow**: `audit_requests` table with open/claimed/completed lifecycle
- **XP wiring**: +25 Prestige XP for auditor via `window.triggerXpTracking` on submission; +50 for recipient via server-side notification trigger

### Mentorship — Task 31
- **MentorshipPanel**: accepting mentees toggle (Master+ only), find-a-mentor list, request flow with message
- **Pairing display**: active mentor/mentee pairings shown on profile with end-pairing option
- **1.5× XP multiplier**: info banner shown when mentorship is active
- **Database**: `mentorships` table with pending/active/ended lifecycle, `accepting_mentees` column on profiles

### Services & Hooks
- `schoolsApi.js`: full CRUD for schools, members, chat, challenges
- `auditsApi.js`: full CRUD for audits, audit requests, mentorships
- `useSchools.js`: TanStack Query hooks for school directory, membership, challenges
- `useAudits.js`: TanStack Query hooks for audits, requests, mentorship
- `useSchoolChat.js`: real-time chat hook with Supabase Realtime subscription + optimistic updates

---

## June 4, 2026 — The Reef: Phase 1 Complete + Profile Unification

Phase 1 of The Reef social layer is fully complete (20/20 tasks). Unified profile system, Species Insights, BadgeShelf, and profile polish shipped.

### Unified Profile System
- Display name chosen during onboarding (step 2b, between wallet connect and Echo egg)
- Supabase `profiles` table is the single source of truth for identity
- ConnectWallet header now pulls name from Supabase profile (falls back to generated alias)
- Eliminated duplicate profile issue (Privy auto-alias vs Reef profile)
- `useEnsureProfile` refactored to check-then-fallback instead of always creating

### Profile Polish (Option A)
- **ProfileEdit component**: inline edit form on own profile (name, bio, avatar upload)
- **"Share on The Reef" button**: added to tank detail social tab — navigates to Reef and opens composer
- **Post count**: displayed on profile next to "Tank Updates" heading
- **App.jsx**: listens for `reef_share_tank` event, switches to Reef tab, opens composer

### Species Insights (Task 15)
- **SpeciesInsights component**: category-tagged micro-tips (280 chars) with upvote/downvote
- **5 categories**: Care Tip, Warning, Breeding Note, Compatibility, Behavior
- **InsightCard**: vote column (▲/▼ with net score), category badge, author profile, timestamp
- **Integrated into BreedGallery**: new "💡 Tips" tab (casual) / "Insights" tab (pro) in species detail
- **Database**: `species_insights` table in Supabase with RLS and indexes
- **Ranking**: sorted by upvotes descending (most helpful first)

### BadgeShelf (Task 10)
- **BadgeShelf component**: 17 achievement badges auto-calculated from user stats
- **Badge categories**: Tank milestones (1/5/10), Species milestones (10/50/100), Tier progression (Silver→God-Tier), XP thresholds (500/2000/5000), Social (posts, insights, tankmates)
- **Visual design**: rounded icon boxes, full opacity when unlocked, dimmed + 🔒 when locked
- **Own profile**: shows both unlocked and locked badges (motivation to progress)
- **Other profiles**: shows only unlocked badges
- **Tooltips**: badge name + description on hover

### Files Added
- `src/components/reef/ProfileEdit.jsx`
- `src/components/reef/SpeciesInsights.jsx`
- `src/components/reef/BadgeShelf.jsx`
- `frontend/supabase/migrations/006_species_insights.sql`

### Files Modified
- `src/components/OnboardingWizard.jsx` — added name input step (2b) + Supabase profile creation
- `src/components/ConnectWallet.jsx` — uses Supabase profile name, imports useProfile hook
- `src/components/BreedGallery.jsx` — added Insights tab + SpeciesInsights component
- `src/components/TankList.jsx` — added "Share on The Reef" CTA in social sub-tab
- `src/components/reef/PublicProfile.jsx` — added ProfileEdit, BadgeShelf, post count
- `src/components/reef/ReefFeed.jsx` — listens for reef_open_composer event
- `src/hooks/useReefProfile.js` — refactored useEnsureProfile for unified flow
- `src/App.jsx` — reef_share_tank event listener, tab navigation

---

## June 3, 2026 — The Reef: Social Layer MVP

Complete social layer ("The Reef") shipped — posts, feed, reactions, comments, connections, notifications, profiles.

### Infrastructure
- Provisioned Supabase project (Postgres + Realtime + Storage + Edge Functions)
- Created 7 database tables with RLS policies, indexes, and auto-notification triggers
- Set up `reef-media` storage bucket for photo uploads
- Bridged Privy wallet auth into Supabase sessions via AuthContext
- Extended Dexie.js schema to v10 (feedCache, socialNotifications, draftContent)

### Features
- Tank Currents: post text + up to 4 photos + linked tank + parameter snapshot + species tags + visibility control
- Social Feed: My Feed (from Tankmates/watched tanks) + Explore (all public), infinite scroll
- Reactions: 6 emoji types with optimistic toggle, unique per user/post/emoji
- Comments: threaded (1-level), inline reply UI
- Tankmate Connections: send request with message, accept/decline, mutual follow
- Watch Tank: one-way follow on specific tanks from the feed
- Public Profiles: auto-seeded from Dexie, avatar gradient, stats, Tankmates list, user's posts
- Sonar Notifications: Postgres triggers auto-fire on reactions/comments/requests, bell icon with realtime unread count
- Media Upload: client-side resize (max 2048px, WebP preferred) → Supabase Storage CDN

### Components Added
- `src/components/reef/` — ReefFeed, CurrentCard, ContentComposer, ProfileCard, PublicProfile, ReactionBar, CommentThread, SonarBell, TankmateRequests
- `src/services/` — supabaseClient, reefApi, mediaUpload
- `src/hooks/` — useReefFeed, useReefProfile, useSonar

### Responsive Pass
- CSS breakpoints at 480/640/768px for mobile/tablet/desktop
- Composer fullscreen on mobile, notification bottom sheet, stacked photo grids
- 44px minimum touch targets on coarse pointer devices
- iOS zoom prevention (16px font-size on inputs)
- `prefers-reduced-motion` support

---

## June 3, 2026 — Onboarding Wizard & Privy Embedded Wallets

Full narrative-driven onboarding experience with zero-friction wallet creation.

### Onboarding Wizard (`OnboardingWizard.jsx`)
- 4-step guided walkthrough: Poseidon greeting → Persona selection → Wallet creation → Echo egg → Tank setup
- Poseidon's dialogue adapts to Casual/Pro mode immediately after persona choice
- Echo egg interaction with wobble animation, tap nudge timer, and XP reward
- Background species catalog hydration (1.4MB) loads during wizard — no loading screens
- Transition gating: dashboard only accessible after tank setup complete + catalog ready
- Mid-wizard abandonment handling: clean restart on incomplete OAuth
- Mobile responsive: 48px touch targets, portrait-optimized layout

### Privy Integration (Account Abstraction)
- `@privy-io/react-auth` v3.28 activated with embedded MPC wallets
- Login methods: Email + Google (no browser extension needed)
- `AuthContext.jsx` rewritten: dual-path (Privy primary, MetaMask fallback)
- `useCreateWallet()` hook for auto-provisioning embedded wallets on first auth
- Signer resolver bridges Privy wallet to all existing contract interactions
- `ConnectWallet.jsx` updated: Privy as primary login, MetaMask as Pro-mode option

### Wallet UX Abstraction
- Deterministic fish-themed alias generator (`generateAlias.js`): "Drift-Loach-3483" style
- Casual mode: alias displayed instead of hex address everywhere
- Pro mode: short hex address shown, "Link external wallet" option available

### Settings Additions (`DataPortabilityWidget.jsx`)
- Experience Mode toggle: switch Casual ↔ Pro with confirmation dialog
- Replay Introduction: re-run onboarding wizard without losing data

### Landing Page Updates
- Nav CTA and hero buttons now link to `/app.html` (app entry) instead of waitlist form
- Landing pages no longer set persona — wizard handles persona selection

### Background Catalog Hydration (`useCatalogHydration.js`)
- Fires on wizard mount, completely decoupled from UI
- Exponential backoff retry (3 attempts) on fetch failure
- Skips fetch if Dexie already has >100 species cached

---

## June 1, 2026 — Pro Breeder Operational Readiness (5-Phase)

Comprehensive implementation to make Pro mode ready for serious rack-based breeders.

### Phase 0: Data Integrity & Trust
- Photo persistence in export/import (localStorage sweep into backup JSON)
- Storage quota guards on all photo/metadata writes
- Partial restore feedback (amber warning for failed photo restores)
- Backup schema bumped to v2

### Phase 1: Bulk / Rack-Level Logging
- Scope selector in Quick Log drawer: Single Tank / Entire Rack / Entire Room
- Bulk action panel: 4 action types, live unit count badge, free-text notes
- Saved action templates (localStorage, filtered by type)
- Off-chain instant writes to actionLogs table

### Phase 2: PDF Pedigree Certificate & Facility Summary
- `generatePedigreeCertificate()`: landscape PDF with 3-gen tree, photo, COI, QR verification
- `generateFacilitySummary()`: portrait PDF with rack breakdown, alerts, spawns
- Dependencies: jspdf, qrcode

### Phase 3: Spawn Grow-Out Lifecycle Tracking
- New Dexie table `spawnGrowout` (db v9)
- SpawnGrowoutTracker component: yield funnel, survival rate, checkpoint history
- Checkpoint types: fry_count, cull, sold, loss, moved, note

### Phase 4: Pro-Mode Tone Pass
- XP toasts: "+X reputation" instead of "Loyalty Rewards" in Pro
- Tank action toasts: operational confirmations ("Feeding logged")
- Companion fish hidden in Pro mode
- XP bar quieted (reduced opacity, no badge name)

### Phase 5: QR Code Tank/Rack Linking
- Real generated QR codes (replacing static SVG mock) encoding deep-link URLs
- Click-to-print QR label PDF (76×51mm, scannable)
- TankQRCode canvas component

**Files**: db.js, TankList.jsx, HatcheryLogs.jsx, SpecimenDetailModal.jsx, DataPortabilityWidget.jsx, App.jsx, pdfExport.js, MintSpecimen.jsx, SpawningWizard.jsx, FacilityTreeView.jsx

---

## May 31, 2026 — UX Premium Polish & Accessibility Overhaul

18-item UX audit: clarity, friction reduction, consistency, accessibility. Web2.5 philosophy (blockchain invisible to casual users).

---

## May 29–30, 2026 — Production Launch & Premium UX

### Full Species Catalog On-Chain (v1.3.0)
- 283/283 species seeded to AquadexManager on Base Sepolia
- Seed script with retry logic, batch control, progress reporting

### Premium Header Redesign (v1.2.0)
- 3-zone header: Identity / Mode Switch / Status
- ModeSegmentedControl component, XP bar at bottom strip

### Mobile + Dual-Mode UX Audit (v1.1.0)
- Responsive header, 44px touch targets, swipe-to-dismiss, filter bottom sheets
- Full-screen Poseidon chat on mobile, PIN keypad enlargement

### Privy Social Login & CDP Paymaster Integration
- Session architecture for smart wallet onboarding (env vars pending on Vercel)

---

## May 28, 2026 — Landing Page Copy & Messaging

- Benefit-driven copy across index, hobbyist, and breeder landing pages
- Static HTML only, no React changes

---

## May 27, 2026 — Smart Contract Refactoring & NatSpec

- Gas optimization across all contracts
- NatSpec documentation hardening
- Checks-Effects-Interactions pattern enforcement

---

## May 26, 2026 — Production Onboarding & Gamified Tone

- Copy polish & persona alignment
- Joyful frictionless experience audit
- Global shell verbiage scrub & presentation privacy layer

---

## May 25, 2026 — Curator Bypass & Persistence Hardening

- Removed community DAO voting gate from curation pipeline (curator-direct)
- Hardened Curator Key Authorization flow
- Verified marketplace fee immutability
- Completed Dexie.js offline-first sync lifecycle
- Frontend UI dual-mode verbiage overhaul (Casual vs Pro)

---

## May 24, 2026 — Core Feature Sprint

### Suggest a Species & Easter Eggs
- Nami Approved badge, Magikarp → Gyarados evolution (parameter-gated)
- Suggest Species modal with WoRMS + Gemini AI validation
- Sybil rate-limiter (3 proposals/wallet/24h), fuzzy duplicate check

### Curation Fees & Breeders Council
- Marketplace fee upgraded to 4% (TOTAL_FEE_BPS = 400)
- COUNCIL_MEMBER_ROLE for 3 co-founders
- Fee split: 65% operations / 35% co-founder (3 equal slots)

### Breeder Companion & Regional Leaderboard
- Dexie schema for companion (egg → hatched → tiered evolution)
- CompanionFishEntity with physics-based swimming, tier visual mapping
- Regional God-Tier usurpation logic

### Commit-Reveal Handshake Scheme
- Cryptographic salt + 4-digit PIN for in-person escrow release
- Local-first pending handshake caching

### Expo Mode & Cash Handshake
- GPS zone detection, cash bypass with reduced fees
- Event analytics dashboard (sales velocity, fulfillment splits)
- Anti-gamification timing gates

### Solidity Gas Optimization
- MAX_BATCH_CHECKOUT_SIZE = 6 (DoS protection)
- Array boundary enforcement on purchaseMultipleSpecimens
- Gemini API native JSON schema enforcement

### Breeder Privacy
- Off-chain spatial fuzzing (1-mile/3-mile rings)
- Address leak prevention in map rendering

---

## May 23, 2026 — Foundation Sprint

### Breed Gallery & Marketplace Integration
- Active Listings tab in BreedGallery with compatibility badging
- Geographic proximity sorting (Keccak256 fallback for null zoneHash)
- Box-grouping consolidated checkout (up to 3 per shipping box)
- purchaseMultipleSpecimens() contract function

### Local Pickup Handshake Funnel
- activeSellerFilter state, consolidation banner, seller filter

### Database Migration & Seeding
- seed_from_collectr.js pipeline (Supabase → on-chain → fishbase_master.json)
- IPFS pinning with Pinata (mock hash fallback)

### Performance & Caching
- @tanstack/react-virtual grid virtualization
- Dexie.js offline-first caching layer
- TanStack Query hooks (useSpeciesData, useMarketplaceListings, useUserTanks)
- On-chain event invalidation (SpecimenRegistered, SpecimenListed, etc.)
