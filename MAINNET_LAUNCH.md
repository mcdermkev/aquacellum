# Aquacellum / AquaDex — Mainnet Launch Checklist

**Status:** Draft — planning document
**Current state:** Live closed beta on **Base Sepolia** (testnet, chain ID `84532`)
**Target state:** Production launch on **Base Mainnet** (chain ID `8453`)

This doc inventories everything that needs to change, be rotated, or be removed to go from the current testnet/beta deployment to a real mainnet launch. It's organized so each section can become its own set of tasks. Items are grouped by risk: contracts and secrets first (hardest to reverse), then app config, then demo/beta code cleanup.

---

## 1. Smart Contracts — Redeploy to Base Mainnet

None of the contracts currently have a mainnet network configured, and testnet addresses/roles are hardcoded in multiple places outside of `.env`. Redeploying is effectively a fresh deployment, not an upgrade — there's no proxy pattern in use.

### 1.1 Contracts inventory

| Contract | File | Role |
|---|---|---|
| `AquadexStorage` | `contracts/AquadexStorage.sol` | Base storage layer — enums (`CareLevel`, `SpecimenStatus`, `TankType`, etc.), no logic |
| `AquadexManager` | `contracts/AquadexManager.sol` | ERC-721 specimens, species catalog, tank registration, spawning. Single-address `curator` role (`onlyCurator`), not a multisig |
| `AquadexMarketplace` | `contracts/AquadexMarketplace.sol` | Escrow marketplace, `AccessControl`-based roles (`FIAT_RELAYER_ROLE`, `COUNCIL_MEMBER_ROLE`), 4% fee split to 5 hardcoded treasury/founder addresses |
| `AquadexCompanion` | `contracts/AquadexCompanion.sol` | "Echo" companion NFT — `hatch()`, `evolve()` gated by relayer role |
| `AquadexGovernance` | `contracts/AquadexGovernance.sol` | Species-proposal voting (`proposeSpecies`, `vote`, `executeProposal`) |

### 1.2 Add a mainnet network to Hardhat

`hardhat.config.js` currently only defines `baseSepolia`. Add a `base` (mainnet) network block:

```js
base: {
  type: "http",
  chainType: "generic",
  url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
  chainId: 8453,
  accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : "remote",
},
```

And register BaseScan mainnet in `chainDescriptors` (8453 → `https://basescan.org`, API `https://api.basescan.org/api`).

### 1.3 Decisions needed before deploying (don't reuse testnet values)

- **Curator address (`AquadexManager`)** — currently a single EOA. For mainnet, strongly consider a Gnosis Safe multisig instead of a single private key, since this role can add/edit the entire species catalog.
- **Marketplace `DEFAULT_ADMIN_ROLE` / `FIAT_RELAYER_ROLE`** — constructor takes `_kevin` and grants both admin and fiat-relayer roles to it (see `AquadexMarketplace.sol` constructor). On mainnet the fiat relayer should be a dedicated backend wallet (see §2.3), **not** the deployer/admin key, and admin should ideally be a multisig.
- **Fee-split treasury addresses** — `marineConservationTreasury`, `ecosystemTreasury`, and the "kevin"/"steve"/"coFounder" addresses in `deployed-addresses-sepolia.json` are dev wallets used for testing the 4% fee split. Real treasury addresses (ideally multisigs) must be decided and passed into the mainnet deploy script — don't copy these from the testnet JSON.
- **Companion relayer role** — `AquadexCompanion.evolve()`/state updates are relayer-gated. Confirm which wallet holds this role on mainnet and that it's distinct from the deployer key (see §2.3 relayer key reuse issue).

### 1.4 Deployment script

Write a new `scripts/deploy-base-mainnet.js` rather than reusing `deploy-seed.js` — that script mixes deployment with test-data seeding (sample species, test listings), which must never run against mainnet. Base it on `deploy-base-sepolia.js` and `deploy-companion.js`, but:
- Strip any seeding calls.
- Take treasury/curator/relayer addresses from environment variables or a JSON config, not literals.
- Write output to `deployed-addresses-base-mainnet.json` (keep the testnet file around for reference, don't overwrite it).

### 1.5 Post-deploy setup (mirrors what was done for testnet)

- Grant `FIAT_RELAYER_ROLE` to the production relayer wallet (see `scripts/grant-relayer-role.js` / `scripts/setup-new-marketplace.js` for the pattern — write a mainnet equivalent).
- Call `setApprovalForAll` on `AquadexManager` for the new marketplace contract.
- Run `scripts/verify-fee-split.js` (or a mainnet variant) to confirm the 4% split lands on the correct treasury addresses before any real money moves.
- Verify all 5 contracts on BaseScan (mainnet) via `hardhat-verify`.

### 1.6 Contract-level risk notes

- No literal TODOs/FIXMEs found in the Solidity source. Testnet-ness lives in deploy scripts and frontend config, not in the contracts themselves — that's good, it means the contracts don't need code changes, only a redeploy with correct constructor args.
- `AquadexManager`'s curator is a single address with broad catalog-editing power — worth a final gut check on whether that's acceptable for mainnet or should move to the governance contract / multisig before real users are trading real value against this catalog.
- No automated Solidity test run exists in CI (see §6). Before mainnet deploy, run the existing test scripts (`test-aquadex.js`, `test_marketplace_escrow.js`, `test_marketplace_shipping.js`, `test-shipping-and-handshake.js`, `test-e2e-flows.js`) against a mainnet fork or fresh testnet deploy one more time as a final regression pass.

---

## 2. Secrets & Environment Config — Rotate Everything

The current `.env` and `frontend/.env` contain **live-looking testnet secrets that must not be reused on mainnet**. Since `.env` files are gitignored (confirmed), these aren't leaked in git history, but the values themselves need to change for production regardless.

### 2.1 Chain / RPC config

| Variable | Current (testnet) | Mainnet value needed |
|---|---|---|
| `VITE_CHAIN_ID` / `CHAIN_ID` | `84532` | `8453` |
| `VITE_RPC_URL` / `RPC_URL` / `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Base mainnet RPC (public `https://mainnet.base.org` or a paid provider like Alchemy/Infura for reliability) |
| `VITE_BLOCK_EXPLORER` | `https://sepolia.basescan.org` | `https://basescan.org` |
| `VITE_MANAGER_ADDRESS`, `VITE_MARKETPLACE_ADDRESS`, `VITE_COMPANION_ADDRESS`, `MANAGER_ADDRESS`, `MARKETPLACE_ADDRESS` | Sepolia addresses | New mainnet deployment addresses (from §1.4) |
| `VITE_CDP_PAYMASTER_URL` | `.../rpc/v1/base-sepolia/...` | Needs a **Base mainnet** Coinbase Developer Platform paymaster endpoint + funded paymaster policy — this is a new CDP config, not just a URL swap |

Also hardcoded (not in `.env`, so editing `.env` alone won't fix these): `frontend/src/config/appConfig.js` has `CONTRACT_ADDRESS` and `MARKETPLACE_ADDRESS` as literal fallback constants, separate from the `VITE_*` env vars. Update this file too.

### 2.2 Privy (wallet auth)

`VITE_PRIVY_APP_ID` currently points to a dev/test Privy app. Create (or confirm) a production Privy app configured for mainnet, with the correct allowed origins (your production domain) and embedded-wallet chain set to Base mainnet.

### 2.3 Relayer key — fix before mainnet, not just rotate

`frontend/.env` shows `RELAYER_PRIVATE_KEY` is **the same value as the root `.env` `PRIVATE_KEY`** (the deployer wallet). This means the contract deployer, the curator/admin, and the transaction relayer are currently one wallet. For mainnet:
- Generate a **new, dedicated relayer wallet** used only for relaying — never the deployer key.
- Fund it with only what it needs for gas (not tied to admin/treasury funds).
- Grant it `FIAT_RELAYER_ROLE` explicitly (don't give it admin).
- Keep the deployer/admin key offline or in a multisig once deployment is done.

### 2.4 Stripe — switch from test to live mode

`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` are `sk_test_.../pk_test_...`. For mainnet:
- Switch to live keys (`sk_live_...`/`pk_live_...`) from the Stripe dashboard (toggle out of test mode).
- Create a new **live** webhook endpoint pointing at the production URL and update `STRIPE_WEBHOOK_SECRET`.
- Re-run Stripe Connect onboarding for real sellers — `STRIPE_CONNECT_RETURN_URL`/`STRIPE_CONNECT_REFRESH_URL` need to point at the production domain.
- Confirm `MARKETPLACE_ADDRESS` used by the Stripe fiat-settlement relay matches the new mainnet marketplace contract.

### 2.5 Supabase — activate the JWT bridge (carried over from beta audit)

This was explicitly deferred during beta (BETA_READINESS_AUDIT.md §3.4): the app currently runs Supabase in "anon" mode with wallet address passed via headers, which effectively bypasses RLS — any user can spoof another wallet's address. `SUPABASE_JWT_SECRET` is present in `frontend/.env` but the comment in the file confirms: *"Without it, the app falls back to header-based RLS (less secure)."*

**This must be resolved before mainnet**, not deferred again — testnet beta data has low stakes, but mainnet means real assets and potentially real payment data. Deploy the JWT bridge Edge Function and confirm RLS policies actually enforce per-wallet isolation, ideally with a real production Supabase project (a fresh one, not the beta project) so beta test data doesn't mix with production users.

### 2.6 Other secrets to rotate/re-provision for a production project

- `GEMINI_API_KEY` / `GCP_SERVICE_ACCOUNT_JSON` / `GCP_PROJECT_ID` — confirm production Vertex AI/Gemini quota and billing project, not a personal dev project.
- `VAPID_PRIVATE_KEY` / `VITE_VAPID_PUBLIC_KEY` — fine to keep or regenerate; low risk, but regenerate if ever shared for testing.
- `VITE_MAPBOX_TOKEN` — confirm production Mapbox usage tier/limits for real user volume.
- `VITE_DISCORD_FEEDBACK_WEBHOOK` — this is a **browser-exposed** Discord webhook URL (anyone can view it in the bundle and spam your Discord channel). Low severity, but worth moving the feedback POST server-side via a Vercel API route before mainnet so the webhook URL isn't public.
- `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` / `MUX_WEBHOOK_SECRET` — confirm production Mux environment, not the dev/test environment.

### 2.7 CORS allowlist

`frontend/api/_lib/cors.js` hardcodes allowed origins (`aquacellum.com`, `aquadex.fish`, `aquadex.io`, Vercel preview URLs, localhost). Confirm which domain(s) are the actual production domain before launch and remove any origins that shouldn't be trusted in production (e.g. decide if `*.vercel.app` previews should still be trusted against a mainnet backend with real funds flowing through the relayer — probably restrict this for production).

### 2.8 Rate limiting — upgrade before scaling

`frontend/api/_lib/rateLimiter.js` is explicitly documented as in-memory, per-instance, "sufficient for beta" with a small user base. Its own comment recommends upgrading to Vercel KV (Redis) for production. Current limits: 50 tx/hr per user (relay), 30 queries/hr per IP (Poseidon) — re-evaluate these numbers for real usage patterns, and move to persistent cross-instance storage before mainnet traffic.

---

## 3. Demo / Beta / Test Code to Remove or Gate Off

### 3.1 Frontend UI — beta messaging

| Component | File | Action needed |
|---|---|---|
| `BetaBanner` | `frontend/src/components/BetaBanner.jsx` | Remove from `App.jsx` (rendered at line ~820) or replace with a production announcement banner. Currently tells users data isn't private and XP can be manipulated — not something to ship to mainnet users. |
| `WhatsNewModal` | `frontend/src/components/WhatsNewModal.jsx` | `CURRENT_VERSION = "0.9.1"`, changelog entries labeled "Beta Polish & Security Hardening" — rewrite copy for a mainnet launch announcement, bump version. |
| `FeedbackWidget` | `frontend/src/components/FeedbackWidget.jsx` | Writes to a Supabase table literally named `beta_feedback` and Discord embed says "Beta Feedback". Decide: keep as general feedback (rename table/copy) or replace with a support/ticket flow. |
| `FoundersDashboard` | `frontend/src/components/FoundersDashboard.jsx` | Internal analytics dashboard gated by `isFounderWallet()`. Fine to keep for mainnet (it's access-controlled), but audit `FOUNDER_WALLETS`/`FOUNDER_WALLET_PATTERNS` in `appConfig.js` below. |

### 3.2 Hardcoded wallet allowlists — `frontend/src/config/appConfig.js`

- `FOUNDER_WALLETS` — 3 hardcoded addresses gating the internal dashboard. Confirm these are still the correct addresses for production access (one is explicitly labeled "legacy" — clean that up).
- `FOUNDER_WALLET_PATTERNS` — prefix/suffix fuzzy matching as a fallback. This is fragile (a new wallet could coincidentally match) — consider removing in favor of exact-match only for mainnet.
- `STOREFRONT_BETA_WALLETS` — currently just spreads `FOUNDER_WALLETS` with a placeholder comment for beta testers. Decide the real mainnet access model: open to all sellers, or still allowlisted? If opening up, remove this gate entirely from wherever it's checked.
- `CONTRACT_ADDRESS` / `MARKETPLACE_ADDRESS` constants — hardcoded Sepolia addresses (separate from `.env`, see §2.1). Must be updated in code.

### 3.3 Scripts to retire (do not run against mainnet)

These are testnet/dev-only and should not be run against production, and ideally archived or deleted from the active `scripts/` path to avoid accidental misuse:

| Script | Why it's demo/test-only |
|---|---|
| `create-test-seller.js` | Creates a Stripe **test-mode** Connected Account for a hardcoded wallet + a personal-looking test email |
| `seed-test-data.js`, `seed-additional-data.js`, `seed-rich-dev-mode.js`, `seed-species-catalog.js` | Seed sample tanks/specimens/listings/species for dev — `seed-rich-dev-mode.js` even hardcodes local Hardhat default addresses |
| `deploy-seed.js` | Mixes real deployment with test-data seeding in one script — don't reuse for mainnet deploy (see §1.4) |
| `preflight-stripe-test.js`, `simulate-webhook.js`, `settle-fiat-direct.js` | Stripe test-mode helper scripts |
| `test-aquadex.js`, `test-e2e-flows.js`, `test-phase6.js`, `test-planetcatfish.mjs`, `test-shipping-and-handshake.js`, `test_marketplace_escrow.js`, `test_marketplace_shipping.js` | Test scripts — keep for CI/regression use, just don't point them at mainnet contracts |
| `grant-relayer-role.js`, `setup-new-marketplace.js` | Hardcode the **old** Sepolia marketplace address — write fresh mainnet-specific versions rather than editing these in place |

Scripts that are fine to keep as-is (data tooling, not environment-specific): `extract-fishbase-data.mjs`, `fetch-species-images.cjs`, `fill-*-gaps.mjs`, `fill-species-data.cjs`, `import-collectr.js`, `merge-*.mjs`, `scrape-seriously-fish.mjs`, `map-supabase-images.js`, `setup-supabase-tables.js`.

### 3.4 Data files

- `deployed-addresses-sepolia.json` — keep for historical reference, but make sure nothing in the frontend or API routes reads from it by default; the new `deployed-addresses-base-mainnet.json` (or env vars) should be the source of truth.
- Root `.env.example` still documents testnet defaults (`VITE_CHAIN_ID=84532`, Sepolia RPC/explorer, testnet contract addresses as example values). Update the example file's defaults once mainnet addresses exist, so new contributors don't copy testnet values by habit.

---

## 4. Known Security Items Carried Over From Beta (must resolve, not just document)

The beta audit (`BETA_READINESS_AUDIT.md`) deliberately deferred two items with the reasoning "acceptable for a small closed beta group." That reasoning does not hold for mainnet:

1. **Supabase anon-mode / RLS bypass** (§2.5 above) — must be fixed, not banner-documented.
2. **Client-side XP/gamification manipulation** — `frontend/src/utils/xp.js` stores XP in `localStorage`, fully editable via DevTools. The beta plan was "snapshot + reset all XP before first loyalty reward distribution" and "verify server-side before rewards." If loyalty rewards or leaderboards carry real value at mainnet launch, server-side XP validation (the `validate-xp-event` Edge Function groundwork already exists per `docs/GAMIFICATION_SPEC.md` and `supabase/functions/validate-xp-event/`) should be the source of truth before real rewards are issued, not client `localStorage`.
3. **In-memory rate limiting** — see §2.8, needs a persistent store for production scale.
4. **CORS allowlist** — see §2.7, needs a review pass for the real production domain(s).

---

## 5. CI/CD Gap

`.github/workflows/ci.yml` only runs `npm ci` / lint / vitest / build inside `frontend/` — it never compiles or tests the Solidity contracts. Before mainnet deploy, either:
- Add a job that runs `npx hardhat compile` and the existing contract test scripts, or
- At minimum, run the full test suite manually one final time against a mainnet fork and record the results as part of the launch sign-off.

---

## 6. Suggested Launch Sequence

1. **Freeze scope** — decide final treasury addresses, curator/admin ownership model (multisig vs EOA), and relayer wallet separation (§1.3, §2.3).
2. **Provision fresh production infrastructure** — new Supabase project (or hardened existing one with JWT bridge live), live Stripe mode, production Privy app, production CDP paymaster policy, production Vertex AI project.
3. **Deploy contracts to Base mainnet** using a clean deploy script (§1.4), verify on BaseScan, run post-deploy role/approval setup (§1.5).
4. **Update all env vars and hardcoded config** (§2, §3.2) — do this as a single reviewed change, not piecemeal, so nothing points at a mix of testnet and mainnet resources.
5. **Strip beta UI and test-only scripts** (§3.1, §3.3).
6. **Re-run full regression pass**: existing test scripts + manual smoke test of the core loop (onboard → tank → mint specimen → marketplace listing → purchase, both crypto and fiat paths → Poseidon chat).
7. **Verify RLS/JWT bridge is actually enforcing isolation** with two real test accounts before opening signups.
8. **Flip DNS/domain to production build, monitor relayer wallet balance and rate-limit dashboards closely for the first 48 hours.**

---

*This document is a planning checklist, not an implementation log. Check items off as they're completed and link to the corresponding PRs/commits.*
