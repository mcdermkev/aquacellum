# Changelog

All notable changes to AquaDex are documented here.

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
