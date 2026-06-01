# Base Grant Overview

**What has been built:**
- Glass‑morphic landing page (dark mode, neon branding) deployed as `index.html` with Vercel rewrites.
- Multi‑page Vite configuration (`index.html` + `app.html`) and successful production build (`npm run build`).
- Core smart contracts deployed on local testnet:
  - `AquadexManager` (spawn logging & specimen minting).
  - `AquadexMarketplace` (batch listings, dual‑channel escrow, hand‑shake verification).
  - `AquadexGovernance` (DAO proposal flow, token‑governed catalog updates).
- Dual‑channel fulfillment UI:
  - Shipping workflow (`purchaseBatch`).
  - In‑person handshake workflow (`purchaseInPerson` + PIN verification).
- Front‑end component library:
  - `ConnectWallet`, `TankList`, `MintSpecimen`, `SpecimenLineage`, `MarketplaceBoard`, `BreedGallery`, `LocalBreederMap`.
- End‑to‑end integration tests covering escrow splits, refunds, and hand‑shake verification.
- CI/CD pipeline on Vercel with clean URL routing and production deployment.

**Current stage:**
- **Step 01 – Idea: Base Batches** – Completed (MVP interface & Base Sepolia contracts).
- **Step 02 – Pre‑seed & Seed: Ecosystem Fund** – Completed (Mainnet beta on Base L2, Coinbase verifications).
- **Step 03 – Growth: Coinbase Ventures** – Completed (Protocol scaling, DAO governance, dual‑channel fulfillment).
- **Next milestone:** **Step 04 – Private Fundraise: Echo** (preparing private raise to fund telemetry hardware & dev tooling).

*All milestones are tracked in `task.md` and the proposal aligns with the 6‑stage builder journey.*
