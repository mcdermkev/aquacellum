# Aquadex Protocol — Development Changelog

All dated development actions, feature implementations, and infrastructure changes.
For the current project specification, see [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md).

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
