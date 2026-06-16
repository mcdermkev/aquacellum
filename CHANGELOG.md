# Changelog

All notable changes to AquaDex are documented here.

---

## [Unreleased] — 2026-06-16

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
