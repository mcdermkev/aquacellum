# Vercel Environment Variables Checklist

Verify all of these are set in **Vercel Dashboard → Project Settings → Environment Variables**.

Variables marked with `VITE_` prefix are exposed to the browser bundle.
Variables without `VITE_` are server-side only (API routes).

## CRITICAL — Required for core features to work

| Variable | Purpose | Set? |
|----------|---------|------|
| `VITE_PRIVY_APP_ID` | Privy authentication (email/Google login) | `cmprm8kqd000l0cl54w0e9jn3` |
| `VITE_CDP_PAYMASTER_URL` | EIP-4337 gas sponsorship (on-chain writes) | Coinbase CDP bundler URL |
| `VITE_SUPABASE_URL` | Cloud sync + social features | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Cloud sync + social features (browser) | Supabase anon key |
| `SUPABASE_URL` | Server-side Supabase (webhooks, checkout) | Same as VITE_ version |
| `SUPABASE_SERVICE_KEY` | Server-side Supabase (service role) | Supabase service role key |
| `RELAYER_PRIVATE_KEY` | On-chain transaction sponsor (relay API) | Deployer private key (no 0x prefix) |
| `RPC_URL` | Base Sepolia RPC for server functions | `https://sepolia.base.org` |
| `MANAGER_ADDRESS` | AquadexManager contract | `0x351ca8f34D94F29F6f865Afa419A636324473DeF` |

## IMPORTANT — Required for Poseidon AI to work

| Variable | Purpose | Set? |
|----------|---------|------|
| `GEMINI_API_KEY` | Poseidon AI gateway (Gemini 2.5 Flash) | Google AI Studio API key |
| `GCP_PROJECT_ID` | Vertex AI project (fallback path) | `aquacellum` |
| `GCP_LOCATION` | Vertex AI region | `us-central1` |

> Note: Either `GEMINI_API_KEY` OR (`GCP_SERVICE_ACCOUNT_JSON` + `GCP_PROJECT_ID`) is needed.
> The Gemini API key path is simpler for Vercel. If using service account, paste the full
> JSON as a single line into `GCP_SERVICE_ACCOUNT_JSON`.

## OPTIONAL — Marketplace/Payments (not needed for beta invite)

| Variable | Purpose | Set? |
|----------|---------|------|
| `STRIPE_SECRET_KEY` | Stripe payments (marketplace) | sk_test_... |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client-side | pk_test_... |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | whsec_... |
| `MARKETPLACE_ADDRESS` | AquadexMarketplace contract | Contract address |
| `STRIPE_CONNECT_RETURN_URL` | Seller onboarding redirect | URL |
| `STRIPE_CONNECT_REFRESH_URL` | Seller onboarding refresh | URL |
| `CHECKOUT_SUCCESS_URL` | Post-checkout redirect | URL |
| `CHECKOUT_CANCEL_URL` | Checkout cancel redirect | URL |

## OPTIONAL — Video/Livestream (not needed for beta invite)

| Variable | Purpose | Set? |
|----------|---------|------|
| `MUX_TOKEN_ID` | Video uploads and playback | Mux access token ID |
| `MUX_TOKEN_SECRET` | Video API authentication | Mux token secret |
| `MUX_WEBHOOK_SECRET` | Mux webhook verification | Mux signing secret |
| `FRONTEND_ORIGIN` | CORS for Mux direct uploads | `https://aquadex.io` |

## OPTIONAL — Other features

| Variable | Purpose | Set? |
|----------|---------|------|
| `VITE_VAPID_PUBLIC_KEY` | Push notifications (Sonar) | VAPID public key |
| `VAPID_PRIVATE_KEY` | Push notifications (server) | VAPID private key |
| `VITE_MAPBOX_TOKEN` | TideMap GPS events | Mapbox public token |

## Frontend Build Variables (VITE_ prefix)

These are baked into the Vite build at deploy time:

| Variable | Value |
|----------|-------|
| `VITE_MANAGER_ADDRESS` | `0x351ca8f34D94F29F6f865Afa419A636324473DeF` |
| `VITE_MARKETPLACE_ADDRESS` | `0x9E9ca82766ce0B36c88aF1eDc093d4e01826BBBf` |
| `VITE_CHAIN_ID` | `84532` |
| `VITE_RPC_URL` | `https://sepolia.base.org` |
| `VITE_BLOCK_EXPLORER` | `https://sepolia.basescan.org` |

---

## Post-Deploy Verification

After setting all variables and deploying:

1. Hit `/api/poseidon-health` — check that:
   - `status` is `"configured"` (Poseidon AI is working)
   - `relayer.status` is `"healthy"` (relayer wallet has ETH)
   - `relayer.balanceEth` is above `0.01`

2. Test the login flow — sign up with a test email, verify wallet gets created

3. Test tank registration — create a tank, check it syncs to Supabase

4. If relayer balance is low, send testnet ETH to the relayer address shown
   in the health endpoint response (use Base Sepolia faucet)
