# Base Testnet Deployment Checklist
## Aquadex Protocol - Base Sepolia Deployment Guide

---

## 📋 Overview
Tasks are marked as either **[YOU]** (requires your action) or **[KIRO]** (handled by Kiro).
Completed items are marked ✅. Pending items are marked ⬜.

---

## Phase 1: Pre-Deployment Setup — ✅ COMPLETED (May 29, 2026)

### 1.1 Get Base Sepolia Testnet ETH
**[YOU]** ✅ **DONE**

Wallet `0xc42eD9F8Fc56F89380a8eD337169899f425Dc934` funded with Base Sepolia ETH.
Balance at deployment time: **~0.190 ETH**

---

### 1.2 Set Up Environment Variables
**[KIRO]** ✅ **DONE — May 29, 2026**

Created `.env` at project root with:
- `PRIVATE_KEY` — Kevin's deployer wallet (placeholder replaced by Kevin)
- `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org` (public RPC, no API key needed)
- `ETHERSCAN_API_KEY` — unified Etherscan V2 key (value stored in `.env` only)

`.gitignore` also created to ensure `.env` is never committed to git.

---

### 1.3 Refactor Smart Contracts for Testnet
**[KIRO]** ✅ **DONE — May 29, 2026**

Two contracts were modified before deployment:

**`contracts/AquadexStorage.sol`**
- Hardcoded Kevin's wallet (`0xc42eD9F8Fc56F89380a8eD337169899f425Dc934`) as the designated primary curator in the constructor.
- Enforces `onlyCurator` access control for all catalog actions regardless of deployer.

**`contracts/AquadexMarketplace.sol`**
- Refactored `_distributeFees()` to the testnet fee split architecture:
  - **65% Operations** → Kevin's wallet (testnet holding environment, covers both Marine Conservation + Ecosystem buckets)
  - **35% Co-Founders** → 3-way equal split: Kevin (slot 1) + Steve `0xb5CD5d87de773d226aa9B1a26f89a613f7395Dd0` (slot 2) + Kevin (slot 3 placeholder), dust goes to slot 3

**`AquadexGovernance.sol`** — intentionally excluded from this launch phase (DAO held for future milestone).

---

### 1.4 Update Hardhat Configuration
**[KIRO]** ✅ **DONE — May 29, 2026**

`hardhat.config.js` fully rewritten for **Hardhat v3.4.5** (breaking changes from v2):
- Added `type: "http"` and `chainType: "generic"` (required by Hardhat v3)
- Base Sepolia network: Chain ID `84532`, public RPC
- Verification via `verify.etherscan.apiKey` (Hardhat v3 API — not the old `etherscan.*` key)
- `chainDescriptors[84532]` registered with BaseScan API and browser URLs
- `@nomicfoundation/hardhat-verify` plugin installed and added to plugins array
- `dotenv` installed and imported for `.env` loading

---

### 1.5 Create Deployment Script
**[KIRO]** ✅ **DONE — May 29, 2026**

Created `scripts/deploy-base-sepolia.js`:
- Uses Hardhat v3 `network.create()` pattern for ethers access
- Deploys in correct order: AquadexManager → AquadexMarketplace
- Logs all fee split addresses to console for verification
- Saves deployed addresses to `deployed-addresses-sepolia.json`
- Prints BaseScan links and verification commands on completion

---

## Phase 2: Smart Contract Deployment — ✅ COMPLETED (May 29, 2026)

### 2.1 Compilation Check
**[KIRO]** ✅ **DONE — May 29, 2026**

```
Compiled 4 Solidity files with solc 0.8.24 (evm target: cancun)
```
All contracts passed. Force recompile run to refresh ABI artifacts after Storage constructor change.

---

### 2.2 Deploy to Base Sepolia
**[KIRO + YOU]** ✅ **DONE — May 29, 2026**

Kevin added private key to `.env` and Kiro executed the deployment.

**Deployment output:**
```
Deployer  : 0xc42eD9F8Fc56F89380a8eD337169899f425Dc934
ETH Balance at deploy: 0.190265532551757703 ETH
```

### 🟢 LIVE CONTRACT ADDRESSES — BASE SEPOLIA

| Contract | Address |
|---|---|
| **AquadexManager** | `0x351ca8f34D94F29F6f865Afa419A636324473DeF` |
| **AquadexMarketplace** | `0x16168B514144e0380610b78d904a4de51ba03Ca3` |
| **Curator (Kevin)** | `0xc42eD9F8Fc56F89380a8eD337169899f425Dc934` |
| **Network** | Base Sepolia (Chain ID: 84532) |

**View on BaseScan:**
- Manager → https://sepolia.basescan.org/address/0x351ca8f34D94F29F6f865Afa419A636324473DeF
- Marketplace → https://sepolia.basescan.org/address/0x16168B514144e0380610b78d904a4de51ba03Ca3

Addresses also saved to `deployed-addresses-sepolia.json` in project root.

---

### 2.3 Verify Contracts on BaseScan
**[KIRO]** ✅ **DONE — May 29, 2026**

Verified on Blockscout (BaseScan V1 API deprecated, V2 migration required):
- **AquadexManager** → https://base-sepolia.blockscout.com/address/0x351ca8f34D94F29F6f865Afa419A636324473DeF#code
- **AquadexMarketplace** → https://base-sepolia.blockscout.com/address/0x16168B514144e0380610b78d904a4de51ba03Ca3#code

---

## Phase 3: Seed Initial Data — ✅ COMPLETED (May 29, 2026)

### 3.1 Seed Species Catalog
**[KIRO]** ✅ **DONE — May 29, 2026**

**Full catalog seeded: 283 / 283 species on-chain.**

Seeded the complete `fishbase_master.json` catalog to Base Sepolia in batches of 50 using `scripts/seed-species-catalog.js`:

| Batch | Species Range | Result | Time |
|-------|--------------|--------|------|
| Initial | 1–20 | 20/20 ✅ | — |
| Batch 1 | 21–70 | 50/50 ✅ | 146s |
| Batch 2 | 71–120 | 50/50 ✅ | 146s |
| Batch 3 | 121–170 | 50/50 ✅ | 225s |
| Batch 4 | 171–220 | 50/50 ✅ | ~150s |
| Batch 5 | 221–270 | 50/50 ✅ | ~150s |
| Batch 6 | 271–283 | 13/13 ✅ | ~40s |

- **On-chain `nextSpeciesId`**: 284
- **Total failures**: 0
- **ETH consumed for seeding**: ~0.0003 ETH
- **Remaining balance after all seeding**: 0.1899 ETH

Species images (46 total) migrated from `migration_assets/` to `frontend/public/species-images/` with local paths.

**Seed script improvements** (`scripts/seed-species-catalog.js`):
- Removed hardcoded batch limit of 20 — now seeds all remaining by default
- Added `BATCH_SIZE` env var for controlled batch runs
- Added retry logic (3 attempts per TX with exponential backoff)
- Added progress reporting every 25 species
- Added timing stats and failure logging to `seed-failures.json`
- Configurable `TX_DELAY` (default 2000ms) and `MAX_RETRIES` (default 3)

---

### 3.2 Create Test Listings
**[KIRO]** ✅ **DONE — May 29, 2026**

Created end-to-end test data on Base Sepolia:
- **3 Tanks**: Living Room Display (200L), Breeding Rack Unit 1 (80L), Quarantine Tub (40L)
- **10 Specimens**: 2 Convict Cichlids, 1 Betta, 3 Neon Tetras, 2 Guppies, 1 Goldfish, 1 Angelfish
- **3 Marketplace Listings**: Neon Tetra (0.001 ETH), Guppy (0.002 ETH), Angelfish (0.005 ETH)
- Marketplace approved for all specimen transfers via `setApprovalForAll`

---

## Phase 4: Frontend Configuration — ✅ COMPLETED (May 29, 2026)

### 4.1 Update Contract Addresses
**[KIRO]** ✅ **DONE — May 29, 2026**

Updated `frontend/src/App.jsx` — two address constants replaced:
```js
// Before (local Hardhat node)
const CONTRACT_ADDRESS    = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const MARKETPLACE_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

// After (Base Sepolia live)
const CONTRACT_ADDRESS    = "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const MARKETPLACE_ADDRESS = "0x16168B514144e0380610b78d904a4de51ba03Ca3";
```
All components receive addresses as props from these two constants — no other files needed changing.

---

### 4.2 Update Network Configuration & Provider
**[KIRO]** ✅ **DONE — May 29, 2026**

Full rewrite of `frontend/src/utils/smartAccount.js`:
- Removed hardcoded `localhost:8545` RPC
- Removed embedded Hardhat Account #0 private key (security fix)
- Removed auto-gas-sponsoring logic (not applicable on real network)
- `getProvider()` now returns `BrowserProvider(window.ethereum)` when MetaMask is present, falls back to read-only `JsonRpcProvider("https://sepolia.base.org")` for catalog reads without a wallet
- Added `getSigner()` — returns MetaMask signer, auto-switches chain if needed
- Added `switchToBaseSepolia()` — calls `wallet_switchEthereumChain` (chain ID `0x14A34` / 84532), auto-adds chain via `wallet_addEthereumChain` if not in wallet yet
- Exported `BASE_SEPOLIA_CHAIN_ID`, `BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_CHAIN_PARAMS` constants

Full rewrite of `frontend/src/components/ConnectWallet.jsx`:
- Real MetaMask connection via `eth_requestAccounts`
- Checks `eth_chainId` on connect — auto-prompts switch to Base Sepolia
- Listens to `accountsChanged` and `chainChanged` MetaMask events
- Shows "Wrong Network" warning banner with one-click switch button if user is on wrong chain
- Restores session on page reload (checks `eth_accounts` silently on mount)
- Shows shortened address (`0xABCD…1234`) when connected
- Shows "Install MetaMask" link if no `window.ethereum` detected

---

### 4.3 Update ABI Files
**[KIRO]** ✅ **DONE — May 29, 2026**

Extracted fresh ABI arrays from compiled artifacts and wrote to frontend:
- `artifacts/contracts/AquadexManager.sol/AquadexManager.json` → `frontend/src/abi/AquadexManager.json`
- `artifacts/contracts/AquadexMarketplace.sol/AquadexMarketplace.json` → `frontend/src/abi/AquadexMarketplace.json`

Note: Artifacts are full Hardhat objects; only the `.abi` array was extracted since the frontend imports them as plain ABI arrays.

---

### 4.4 Frontend Environment File
**[KIRO]** ✅ **DONE — May 29, 2026**

Created `frontend/.env` with `VITE_` prefixed variables:
```
VITE_MANAGER_ADDRESS=0x351ca8f34D94F29F6f865Afa419A636324473DeF
VITE_MARKETPLACE_ADDRESS=0x16168B514144e0380610b78d904a4de51ba03Ca3
VITE_CHAIN_ID=84532
VITE_RPC_URL=https://sepolia.base.org
VITE_BLOCK_EXPLORER=https://sepolia.basescan.org
```

---

### 4.5 Frontend Build Verification
**[KIRO]** ✅ **DONE — May 29, 2026**

```
vite v8.0.13 building client environment for production...
✓ 7 modules transformed.
✓ built in 121ms
```
Clean build. No errors.

---

## Phase 5: Frontend Deployment — ✅ COMPLETED (May 29, 2026)

### 5.1 Deploy to Vercel
**[KIRO]** ✅ **DONE — May 29, 2026**

**BLOCKER RESOLVED**: Fixed "Cannot access 'B' before initialization" error caused by ethers v6 circular dependencies.

**Solution implemented:**
- Configured Vite to mark `ethers` as external (not bundled)
- Load ethers from CDN (`https://cdn.jsdelivr.net/npm/ethers@6.16.0/+esm`) in `app.html`
- Modified `smartAccount.js` to access ethers via `window.ethers`
- App now loads ethers before React initialization to ensure availability

**Deployment results:**
- Build succeeded: 833KB main bundle (down from 1218KB)
- Deployed to production: `https://aquacellum.com`
- Landing pages (`/`, `/hobbyist`, `/breeder`) working
- React app at `/app` now loads without circular dependency errors

**Files modified:**
- `frontend/vite.config.js` — added `external: ['ethers']` and `optimizeDeps.exclude`
- `frontend/app.html` — added CDN script to load ethers before app
- `frontend/src/utils/smartAccount.js` — access ethers via `window.ethers`

---

### 5.2 Configure Environment Variables on Vercel
**[YOU]** ✅ **DONE — June 1, 2026**

`GEMINI_API_KEY` added to Vercel Dashboard environment variables. AI species suggestion feature operational.

---

## Phase 5.5: Production Bug Fixes — ✅ COMPLETED (May 29, 2026)

### Critical Fixes Applied
**[KIRO]** ✅ **DONE — May 29, 2026**

| Issue | Root Cause | Fix |
|---|---|---|
| App crash on load (TDZ error) | `activeTank` used before `useState` declaration in TankList.jsx | Moved state declaration above first usage |
| Fish Finder blank screen | `searchTerm` used before `useSpeciesSearch` hook in BreedGallery.jsx | Moved hook call above the useEffect that references it |
| Fish Finder crash on card click | `useMemo` called inside `if (selectedBreed)` conditional | Moved useMemo to top level (Rules of Hooks) |
| `activeSearchList is not defined` | Variable removed but still referenced | Replaced with `filteredSpecies` |
| `fetchSpecies is not defined` | Function removed but still referenced | Replaced with `refetchContractSpecies` |
| 429 Rate Limiting | Public RPC `sepolia.base.org` has very low limits | Switched to FallbackProvider with 3 RPC endpoints (PublicNode, BlockPi, Base) |
| Species images broken (CORB) | Supabase bucket returning 400 | Migrated 46 images to local `public/species-images/` |
| Circular dependency crash | BreedGallery ↔ MarketplaceBoard cross-imports | Extracted shared SVGs to `SilhouetteSVG.jsx` |
| React 19 TDZ in production | React 19.2.6 internal scheduler breaks in Vite 5 bundling | Downgraded to React 18.3.1 |
| ethers bundling crash | ethers v5 circular deps break Rollup | Externalized via UMD script + compat shim |

### UX Improvements Applied
- Species Care Guide moved to top of detail view
- Collapsible filter drawer (hidden by default, toggle with animation)
- Hero image banner on species detail pages
- Mobile: horizontal scroll tab bar with fade indicators
- Mobile: full-screen bottom sheet for tank details
- Mobile: sticky action buttons in tank sheet

---

## Phase 6: Testing & Verification — ✅ COMPLETED (June 1, 2026)

### 6.1 Test Core Flows
**[KIRO]** ✅ **DONE — June 1, 2026**

Automated E2E test script (`scripts/test-e2e-flows.js`) executed on Base Sepolia:
- ✅ View species catalog (283 species confirmed)
- ✅ Register a tank (Tank ID=4, "E2E Test Tank", 150L)
- ✅ Mint a specimen (Token #11, Species: Convict Cichlid)
- ✅ Create a marketplace listing (0.001 ETH)
- ✅ Token transferred to marketplace escrow
- ✅ Purchase listing (burner wallet as buyer)
- ✅ Token ownership transferred to buyer
- ✅ Listing deactivated after purchase

**8/8 tests passed.** Purchase TX: `0xf0ca282004d93b4c0d992d6863319bd1b4c91d5406b8cf03dc73f3cacedf40d4`

Script uses a randomly-generated burner wallet funded on-the-fly from Kevin's wallet — no second private key needed.

---

### 6.2 Check Contracts on BaseScan
**[YOU]** ✅ **DONE — June 1, 2026**

Contracts verified and transactions visible on Blockscout:
- https://base-sepolia.blockscout.com/address/0x351ca8f34D94F29F6f865Afa419A636324473DeF#code
- https://base-sepolia.blockscout.com/address/0x16168B514144e0380610b78d904a4de51ba03Ca3#code

E2E test transactions confirmed on-chain (purchase, escrow, transfer all visible in explorer).

---

## Phase 7: Documentation & Handoff — ⬜ PENDING

### 7.1 Update README
**[KIRO]** ✅ **DONE — June 1, 2026**

Rewrote `frontend/README.md` with:
- Live demo link (aquacellum.com)
- Deployed contract addresses + BaseScan links
- Three testnet ETH faucet options (Alchemy, QuickNode, Superchain)
- Local development instructions
- Marketplace testing guide (two MetaMask accounts)
- Key file reference table
- Tech stack summary

---

## 📊 Progress Summary

| Phase | Status | Date |
|---|---|---|
| Phase 1 — Pre-Deployment Setup | ✅ Complete | May 29, 2026 |
| Phase 2 — Smart Contract Deployment | ✅ Complete | May 29, 2026 |
| Phase 2.3 — Contract Verification | ✅ Complete (Blockscout) | May 29, 2026 |
| Phase 3.1 — Seed Species Catalog | ✅ Complete (283 species) | May 29, 2026 |
| Phase 3.2 — Seed Test Data | ✅ Complete | May 29, 2026 |
| Phase 4 — Frontend Configuration | ✅ Complete | May 29, 2026 |
| Phase 5 — Frontend Deployment | ✅ Complete | May 29, 2026 |
| Phase 5.5 — Production Bug Fixes | ✅ Complete | May 29, 2026 |
| Phase 6 — Testing & Verification | ✅ Complete | June 1, 2026 |
| Phase 7 — Documentation | ✅ Complete | June 1, 2026 |

---

## 💰 Actual Gas Costs (May 29, 2026)

| Item | Cost |
|---|---|
| AquadexManager deployment | ~0.0001 ETH |
| AquadexMarketplace deployment | ~0.0001 ETH |
| Species catalog seeding (283 TXs) | ~0.0003 ETH |
| Test data seeding (tanks, specimens, listings) | ~0.0001 ETH |
| **Total spent** | **~0.0006 ETH** |
| **Remaining balance** | **~0.1899 ETH** |

Plenty of testnet ETH remaining for user testing and additional transactions.

---

## 🔑 Key Files Created / Modified (May 29, 2026)

| File | Action |
|---|---|
| `.env` | Created — environment config with RPC + API keys |
| `.gitignore` | Created — protects `.env` from git commits |
| `hardhat.config.js` | Rewritten — Hardhat v3 syntax, Base Sepolia, verification |
| `contracts/AquadexStorage.sol` | Modified — curator hardcoded to Kevin's wallet |
| `contracts/AquadexMarketplace.sol` | Modified — fee split refactored for testnet |
| `scripts/deploy-base-sepolia.js` | Created — full deployment orchestrator |
| `deployed-addresses-sepolia.json` | Created — live contract addresses output |
| `frontend/src/App.jsx` | Modified — contract addresses updated to Base Sepolia live |
| `frontend/src/utils/smartAccount.js` | Rewritten — Base Sepolia RPC, MetaMask BrowserProvider, chain switching, CDN ethers access |
| `frontend/src/components/ConnectWallet.jsx` | Rewritten — real MetaMask connect, chain ID check, auto-switch |
| `frontend/src/abi/AquadexManager.json` | Updated — fresh ABI from compiled artifacts |
| `frontend/src/abi/AquadexMarketplace.json` | Updated — fresh ABI from compiled artifacts |
| `frontend/.env` | Created — VITE_ prefixed env vars for addresses and network |
| `frontend/vite.config.js` | Modified — marked ethers as external to avoid bundling circular dependencies |
| `frontend/app.html` | Modified — load ethers from CDN before React app initialization |
