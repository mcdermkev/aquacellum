# Vercel Environment Variables Checklist

Verify all of these are set in **Vercel Dashboard → Project Settings → Environment Variables**.

Variables marked with `VITE_` prefix are exposed to the browser bundle.
Variables without `VITE_` are server-side only (API routes).

## CRITICAL — Required for core features to work

| Variable | Purpose | Set? |
|----------|---------|------|
| `VITE_PRIVY_APP_ID` | Browser Privy authentication provider | Privy application ID |
| `PRIVY_APP_ID` | Server Privy JWT audience/JWKS trust root | Same intended Privy application; server-only input |
| `VITE_CDP_PAYMASTER_URL` | EIP-4337 gas sponsorship (on-chain writes) | Coinbase CDP bundler URL |
| `VITE_SUPABASE_URL` | Cloud sync + social features | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Cloud sync + social features (browser) | Supabase anon key |
| `SUPABASE_URL` | Server-side Supabase (webhooks, checkout) | Same project as VITE_ version |
| `SUPABASE_SERVICE_KEY` | Server-side Supabase (service role) | Supabase service role key |
| `SUPABASE_JWT_SECRET` | Supabase auth-bridge JWT signing | Supabase project JWT secret |
| `RELAYER_PRIVATE_KEY` | On-chain transaction sponsor (relay API) | Deployer private key (no 0x prefix) |
| `RPC_URL` | Base Sepolia RPC for server functions | `https://sepolia.base.org` |
| `MANAGER_ADDRESS` | AquadexManager contract | `0x351ca8f34D94F29F6f865Afa419A636324473DeF` |

`PRIVY_APP_ID` must be present in every environment that serves authenticated APIs. Server routes do not fall back to `VITE_PRIVY_APP_ID` or a hard-coded application ID. Record confirmation without copying secrets or access tokens.

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
| `MARKETPLACE_ADDRESS` | AquadexMarketplace contract | `0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e` |
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
| `VITE_MARKETPLACE_ADDRESS` | `0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e` |
| `VITE_CHAIN_ID` | `84532` |
| `VITE_RPC_URL` | `https://sepolia.base.org` |
| `VITE_BLOCK_EXPLORER` | `https://sepolia.basescan.org` |

---

## Post-Deploy Verification

After setting all variables and deploying:

1. Confirm `PRIVY_APP_ID` exists server-side and equals the intended Privy token audience. Do not paste the value into logs or verification evidence.
2. Exercise `/api/mint-session`: a valid token wallet succeeds; a different body wallet returns 403; a token without a wallet cannot use a body wallet; an environment missing `PRIVY_APP_ID` returns 503.
3. Hit `/api/poseidon-health` and check that Poseidon and relayer status are healthy.
4. Test the login flow with a test account and confirm its embedded wallet is created.
5. Test tank registration and confirm it syncs to the intended Supabase project.
6. If relayer balance is low, fund the relayer from the Base Sepolia faucet.

## Fish Room private media pipeline (deployment-gated)

Keep `SHOWCASE_MEDIA_ENABLED=false` until the database migration, private-bucket catalog probe, Azure worker smoke test, worst-case image corpus, revocation test, and dead-job alert all pass.

| Variable | Purpose |
|----------|---------|
| `SHOWCASE_MEDIA_ENABLED` | Explicit production capability gate; exact value `true` enables stage/finalize/publish |
| `SHOWCASE_STORAGE_S3_ENDPOINT` | Supabase Storage S3 endpoint; HTTPS, server-only |
| `SHOWCASE_STORAGE_S3_REGION` | Exact Supabase S3 region |
| `SHOWCASE_STORAGE_S3_ACCESS_KEY_ID` | Server-only key used only to presign exact five-minute source PUTs |
| `SHOWCASE_STORAGE_S3_SECRET_ACCESS_KEY` | Server-only S3 signing secret; never exposed/logged |

The Azure Container Apps worker requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as secrets. Do not put S3 credentials in the worker: it uses service-role Storage operations and service-only leased-job RPCs. Record deployment ID/region/revision and pass/fail evidence without copying any secret or object key.
