# Base Ecosystem Grant — Aquadex Protocol (Aquacellum)

## Project Summary

Aquadex is a decentralized biological provenance framework and peer-to-peer marketplace built on Base. It enables hobbyist fishkeepers and professional breeders to catalog aquatic species, track specimens as ERC-721 tokens, manage breeding lineage on-chain, and trade live fish through escrow-protected marketplace flows — all through a dual-persona interface that adapts between a friendly hobbyist logbook and a professional breeder terminal.

The protocol combines on-chain immutable provenance with local-first operational tools, an AI-powered assistant (Poseidon), and curated species personality content to create an engaging yet scientifically rigorous platform.

**Live testnet deployment:** https://aquacellum.com  
**Network:** Base Sepolia (Chain ID: 84532)

---

## What Has Been Built (Testnet — May–June 2026)

### Smart Contracts (Solidity 0.8.24, verified on Blockscout)

- **AquadexManager** — Species catalog (283 species seeded on-chain), tank registry, ERC-721 specimen minting, spawn/lineage logging with Sire/Dam ancestry tracking
- **AquadexMarketplace** — Dual-channel escrow marketplace:
  - Standard specimen listings with instant purchase
  - Shipping escrow (lock → dispatch with tracking → 3-day safety window → buyer confirms → release)
  - In-person handshake (commit-reveal PIN verification for local pickup)
  - Event-zone mode with reduced 2% fees for expo/meetup transactions
  - Batch listings from spawn events (quantity-tracked juvenile sales)
  - 4% protocol fee with transparent split (65% operations / 35% founders 3-way)
  - Dispute resolution flow (buyer disputes → curator arbitrates)
- **AquadexGovernance** — DAO proposal/vote/execute framework using specimen NFTs as voting tokens (deployed, parked for future activation)
- **AquadexStorage** — Shared state layer with on-chain metric scaling (temp ×10, pH ×10, salinity ×10000, nitrogen ×100)

### Frontend Application (React 18 + Vite, deployed on Vercel)

**25 components, 8 custom hooks, 10 utility modules**

**Dual-Mode Interface:**
- **Casual Hobbyist Mode** — Friendly copy, gamified XP/companion system, consumer badges, hidden blockchain details, emoji-rich
- **Professional Breeder Mode** — Operational language, full token IDs/hashes, facility hierarchy, suppressed gamification, clinical terminal aesthetic

**Core Features (all implemented and deployed):**
- Species catalog browser with Fuse.js search, virtual scroll, collapsible filters, and species detail panels with care guides
- Tank management with sub-tabs (About / Specimens / Parameters / Observations / Social Feed)
- Specimen minting (ERC-721) with species validation
- Marketplace board with active listings
- Consolidated shipping checkout (groups listings by seller, up to 3 per box)
- Handshake verification UI (PIN commit-reveal for in-person trades)
- Spawning wizard (4-step flow: pair selection → telemetry → genetic markers → offspring allocation)
- Spawn grow-out tracker (Eggs → Fry → Alive → Sold → Lost/Culled yield funnel)
- Facility tree view (hierarchical Facility → Room → Rack → Unit)
- Local breeder proximity map (fuzzed coordinates for privacy)
- Pedigree certificate PDF export (landscape, 3-gen ancestry tree, COI badge, QR code)
- Data export/import (full Dexie DB backup in JSON)
- MetaMask wallet connection with auto chain-switching to Base Sepolia

**Gamification System (Casual Mode):**
- Hobbyist XP + Prestige XP dual-track progression
- Breeder Companion fish (egg → hatched → Bronze → Silver → Gold → Master → God-Tier evolution)
- Regional leaderboard with God-Tier usurpation mechanic
- Expo double-XP events

### Poseidon — AI-Powered Assistant

Poseidon is an in-app conversational assistant that bridges natural language to local database operations and on-chain actions. It runs in a dedicated Web Worker for non-blocking performance.

**Implemented capabilities:**
- **Tank setup via NLP** — "Set up a new 20 gallon freshwater tank at 76°F" → parses volume, temperature, pH, salinity, and creates a fully configured tank record
- **Husbandry logging** — "Fed the fish" / "Cleaned the glass" / "Ran a water test" → logs action entries with timestamps
- **Dual-persona responses** — Casual mode: friendly emoji-rich assistant. Pro mode: clinical terminal output ("ECOLOGICAL AUTO-PILOT TERMINAL")
- **Echo companion reactions** — Triggers visual animations on the Breeder Companion fish (mood changes, glow effects, swim speed) based on conversation context
- **Medical safety intercept** — Detects disease/illness keywords and safely declines with "consult a veterinarian" guidance
- **Easter eggs** — Polite-user detection triggers special companion animations

**Architecture:** Rule-based intent parser (Web Worker) → action dispatcher (poseidonBridge.js) → Dexie.js local database transactions. Designed for future upgrade to LLM-backed responses.

### AI Species Validation (Serverless)

A Vercel serverless function (`/api/suggest-species`) provides AI-powered species catalog curation:
- **WoRMS API integration** — Validates scientific names against the World Register of Marine Species
- **Gemini 1.5 Flash audit** — Verifies temperature ranges, pH ranges, care level accuracy, and taxonomic spelling via structured JSON output
- **Deterministic fallback** — If Gemini is unavailable, applies range-based sanity checks locally

### Species Personality Content System

A curated dual-voice content layer that gives each species a distinct character in both Casual and Pro modes:

**What's built:**
- `getPersonality()` safety helper — graceful fallback for species without content (no crashes, no empty boxes)
- Rendering in species cards (vibeLine tagline) and detail panels (flavorText intro)
- Full content pipeline: batch drafting → Markdown review sheets → parse script → merge script → live UI
- Style Guide v1 governing all content (12-word vibeLine ceiling, 2–4 sentence flavorText, real biology only)

**Progress:** 50 of 326 species have reviewed personality content (Batches 01–02 merged). Remaining 276 species in pipeline (14 batches). Feature degrades gracefully — species without personality show the standard ecology tagline.

### Infrastructure

- **Local-first architecture** — Dexie.js v9 offline database (species, listings, tanks, actionLogs, userProfile, breederCompanion, pendingHandshakes, spawnGrowout)
- **CI/CD** — Vercel with clean URL routing and multi-page Vite config
- **Fallback RPC** — 3-endpoint FallbackProvider (PublicNode, BlockPi, Base) for rate-limit resilience
- **Ethers v6 via CDN** — Externalized to avoid Rollup circular dependency issues
- **Mobile-first** — Full responsive audit implemented (44px touch targets, bottom sheets, swipe gestures, safe-area insets)

---

## Testnet Verification (Completed June 1, 2026)

All core contract flows verified on Base Sepolia with automated scripts:

| Flow | Status | TX Evidence |
|------|--------|-------------|
| Species catalog read (283 species) | ✅ Verified | — |
| Tank registration | ✅ Verified | On-chain |
| Specimen minting (ERC-721) | ✅ Verified | On-chain |
| Marketplace listing + purchase | ✅ Verified | `0xf0ca28...` |
| 4% fee split (65/35, 3-way founder) | ✅ Verified to the wei | Steve received exact expected share |
| Shipping escrow (lock → dispatch → release) | ✅ Verified | `0xe9caa2...` |
| In-person PIN handshake (commit-reveal) | ✅ Verified | `0x46f182...` |
| Batch listing quantity tracking | ✅ Verified | 5 → 3 after 2 sold |

---

## Grant Funding Request

### Current Stage
- **Builder Journey Step:** Idea → Base Batches (testnet MVP complete, all flows verified)
- **What we're applying for:** Ecosystem Fund grant to cover security audit + mainnet deployment

### Budget Breakdown

| Item | Estimated Cost | Notes |
|------|---------------|-------|
| **Smart contract security audit** | $8,000–$12,000 | Competitive audit (Code4rena or CodeHawks) for 4 contracts (~600 LOC Solidity) |
| **Mainnet deployment + gas** | $500–$1,000 | Contract deployment + initial species catalog seeding on Base mainnet |
| **Immunefi bug bounty pool** | $2,000–$5,000 | Ongoing post-launch security coverage |
| **Infrastructure (12 months)** | $1,200 | Vercel Pro, RPC provider (Alchemy/QuickNode), domain |
| **Total ask** | **$12,000–$23,000** | |

### Why an Audit is Required Before Mainnet

The AquadexMarketplace contract holds user funds in escrow during trades. A vulnerability could result in:
- Locked funds that can never be released
- Unauthorized escrow drainage
- Fee distribution bypass

Our contracts follow best practices (CEI pattern, custom errors, AccessControl), but professional review is industry standard before handling real value. The testnet verification above demonstrates the protocol works correctly — an audit confirms it works *securely*.

---

## Milestones & Deliverables

### Milestone 1: Security Audit (Weeks 1–4)
- Submit contracts to competitive audit platform
- Address all critical/high findings
- Publish audit report publicly
- Set up Immunefi bug bounty program

### Milestone 2: Mainnet Deployment (Weeks 5–6)
- Deploy audited contracts to Base mainnet
- Seed initial species catalog (283 species)
- Update frontend to point to mainnet
- Verify contracts on BaseScan

### Milestone 3: Public Beta Launch (Weeks 7–8)
- Open registration for hobbyists and breeders
- First real marketplace listings
- Community onboarding (Discord, documentation)
- Monitor fee collection and escrow flows
- Complete species personality content (all 326 species)

### Milestone 4: Governance & AI Expansion (Weeks 9–12)
- Deploy AquadexGovernance to mainnet
- Enable community-driven species catalog proposals
- Upgrade Poseidon from rule-based to LLM-backed responses
- Account abstraction integration (Coinbase Smart Wallet / gasless transactions)

---

## Team

| Role | Person | Wallet |
|------|--------|--------|
| Project Director / Curator | Kevin McDermott | `0xc42eD9F8Fc56F89380a8eD337169899f425Dc934` |
| Co-Founder | Steve | `0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0` |
| Co-Founder (Slot 3) | TBD | Placeholder → Kevin's wallet on testnet |

---

## Links

- **Live Demo:** https://aquacellum.com
- **Contracts (Base Sepolia):**
  - AquadexManager: [`0x351ca8f34D94F29F6f865Afa419A636324473DeF`](https://base-sepolia.blockscout.com/address/0x351ca8f34D94F29F6f865Afa419A636324473DeF)
  - AquadexMarketplace: [`0x16168B514144e0380610b78d904a4de51ba03Ca3`](https://base-sepolia.blockscout.com/address/0x16168B514144e0380610b78d904a4de51ba03Ca3)
- **Source:** Private repository (available for audit review)
