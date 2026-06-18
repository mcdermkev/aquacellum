# Changelog

All notable changes to AquaDex are documented here.

---

## [Unreleased] — 2026-06-18

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
