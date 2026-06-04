# Aquadex Protocol — Development Changelog

All dated development actions, feature implementations, and infrastructure changes.
For the current project specification, see [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md).

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
