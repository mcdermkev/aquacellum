# PWA Migration — Progress & Handoff

Status checkpoint for the multi-page-HTML → installable PWA migration of the
Aquadex frontend (`frontend/`). Phases 0–4 are **done, built, and verified**.
Use this doc to resume in a new chat.

> TL;DR: The app shell (`/app`) is now a single React Router SPA, the legacy
> standalone HTML pages are retired, and the app is an installable PWA with real
> PNG icons and a ~1 MB install footprint. Phase 4b vendor-splitting and all three
> deferred product features (grow-out tracker, morph registration, acclimation
> checklist) are now done too. Remaining work is optional cold-install precaching
> plus the known limitations below.

---

## How to resume

- Workspace: `c:\Users\mcder\Desktop\fish-dex-protocol`, frontend lives in `frontend/`.
- Build/verify: `npm run build` in `frontend/` (PWA SW + manifest generate into `dist/`).
- Dev: `npm run dev` (Vercel dev) or `npm run dev:vite`. **Note:** the service
  worker is production-only (`devOptions.enabled: false`), so PWA/offline behavior
  only shows in a built/preview or deployed build, not in `vite` dev.
- npm installs in this repo need `--legacy-peer-deps` (pre-existing Privy/viem peer
  conflict). Node 22 is the declared engine; dev machine runs Node 24 (harmless warning).

---

## Done

### Phase 0 — Page taxonomy
Classified every `.html` entry. The `/app` React app (entry `app.html` →
`src/main.jsx` → `src/App.jsx`) is the real, actively-maintained app. The
standalone root `.html` pages were separate legacy/public implementations.

### Phase 1 — Consolidated to a React Router SPA
- Installed `react-router-dom@6`. `main.jsx` wraps `<App/>` in `<BrowserRouter>`.
- `App.jsx`: tab state is now **derived from the URL** (`/app/<tab>`), not
  `useState` + hash. Added `goToTab(tab)` (preserves `?view=` query) and a
  one-time redirect from legacy `/app#tab` hash links. `viewParam` derived from
  `location.search`. All navigation handlers converted from `setActiveTab` +
  `pushState` to `goToTab`. `VALID_TABS` lives in `src/config/appConfig.js`:
  `tanks, breeder, directory, gallery, map, orders, incoming, reef, settings, founders, storefront`.
- `js/shared-nav.js`: re-pointed links into `/app/*` for everything with a tab
  equivalent (tanks→/app/tanks, breeder-tools→/app/breeder, marketplace→/app/directory,
  reef-social→/app/reef, orders→/app/orders, breeders→/app/map, breeds→/app/gallery,
  incoming→/app/incoming, my-store→/app/storefront, settings→/app/settings).
- `vite.config.js`: dev rewrite `/app` + `/app/*` → `/app.html`.
- `vercel.json`: added `/app/:path* → /app.html` rewrite (prod deep links) +
  redirects (permanent:false) from legacy clean URLs into `/app/*`.

### Phase 2 — Retired legacy standalone app pages
Audited each against the React app. **Deleted 7 files** (no working logic lost):
`tanks.html, orders.html, my-store.html, settings.html, reef-social.html,
breeder-tools.html, incoming.html`. Removed their `vite.config.js` rollup inputs.
Fixed inbound links (`reef.html` ×2 → `/app/reef`, `hobbyist.html` → `/app/tanks`).

### Phase 3 — PWA layer
- `vite-plugin-pwa@0.21` with **`injectManifest`** strategy (custom SW so the
  existing Web Push handlers survive). Combined SW source: **`src/sw.js`**.
  Deleted the old `public/sw.js` (its push handlers were moved into `src/sw.js`).
- SW behavior: precache app shell; navigation fallback to `/app.html` for `/app/*`
  (`allowlist:[/^\/app/]`, `denylist:[/^\/api\//]`); `CacheFirst` for
  `/fishbase_master.json` + images; **`/api/*` is `NetworkOnly`**; `SKIP_WAITING`
  handler; push/notificationclick/pushsubscriptionchange preserved.
- **Safety decision:** Supabase REST reads are intentionally NOT SW-cached (many
  are user-scoped JWT data). Offline data resilience is handled at the app layer
  via Dexie/IndexedDB.
- `app.html`: theme-color, Apple standalone meta, apple-touch-icon, `viewport-fit=cover`.
- `src/components/PwaManager.jsx`: registers SW via `virtual:pwa-register/react`,
  shows update prompt (`registerType: 'prompt'`), install button
  (`beforeinstallprompt`), and iOS Add-to-Home-Screen hint. Mounted in `main.jsx`.

### Phase 4 — Icon + precache polish
- **Icons:** `sharp` + `scripts/generate-pwa-icons.mjs` rasterize
  `public/aquacellum-mark.svg` → `public/icons/`: `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (70% safe-zone), `apple-touch-icon-180.png`. Manifest +
  `app.html` updated. Re-run the script if the brand mark changes.
- **Precache:** code-split 9 tab components to `React.lazy` (entry bundle
  3.9 MB → 2.8 MB; tabs are separate chunks). `injectManifest` globs are now
  shell-only; `src/sw.js` has a `StaleWhileRevalidate` `app-assets` route so JS
  chunks runtime-cache on first use. **Install footprint: 9.4 MB → ~1 MB.**

---

## Remaining work

### Optional polish (Phase 4b)
- ~~Vendor splitting~~ **DONE.** `vite.config.js` now has a
  `rollupOptions.output.manualChunks` that pulls the stable, eagerly-loaded
  vendors out of the app entry chunk: `react-vendor` (react, react-dom,
  scheduler, react-router, react-router-dom, @tanstack) and `icons-vendor`
  (@phosphor-icons). Entry `app-*.js` dropped 2,846 kB → 2,729 kB and the vendor
  code now caches across deploys (app code invalidates far more often). Privy,
  supabase, and the lazy tab chunks were already split; ethers is a UMD-global
  shim so it isn't bundled.
- Optional: precache the entry chunk + critical vendor so a *cold install* (offline
  before first load) works. Current setup relies on first online visit to populate
  the `app-assets` runtime cache (fine for the normal install-after-use flow).

### Deferred product features (build on the clean SPA)
Captured from the retired mockups; all were non-functional demos (no logic lost):
1. ~~**Grow-out checkpoint tracker**~~ **DONE.** A working tracker already
   existed inline in `HatcheryLogs.jsx` (per-species hatchery view). Extracted it
   to a standalone reusable component (`src/components/SpawnGrowoutTracker.jsx`,
   exports `SpawnGrowoutTracker` + `GROWOUT_TYPES`) and surfaced it in Breeder
   Tools via a new **Grow-Out** sub-section (`src/components/GrowOutSection.jsx`)
   that lists the wallet's spawns (Dexie `spawns`, newest-first) and renders a
   tracker per spawn. Checkpoints persist to the existing `spawnGrowout` table;
   no schema change. Funnel/survival %/XP (`addXp(5,…)`)/Poseidon narration all
   reused unchanged. `HatcheryLogs` now imports the extracted component.
2. ~~**Breed-morph registration**~~ **DONE (Supabase-backed + curator review).**
   Breeder Tools **Morphs** sub-section (`src/components/MorphRegistration.jsx`).
   Submissions persist to **Supabase** (`morph_submissions` table) — moved off
   the original local-only Dexie store so reviews actually reach a curator.
   - Reads + inserts are client-side via the shared `supabase` client
     (`src/services/morphSubmissionsApi.js`). Form: base species, morph name,
     trait type, description, proof URL; client-side rate-limit (5/day) + dedupe;
     awards `MORPH_REGISTERED` XP (30).
   - **Curator review loop:** the curator (detected via on-chain
     `contract.curator()`, same pattern as `CheckoutSummary`/`BreedGallery`) sees
     a 🛡️ review panel listing the whole queue with Verify/Reject buttons.
   - Status flips go through a **service-role route** (`api/update-morph-status.js`)
     that re-verifies the caller is the on-chain curator before writing — RLS
     can't express "curator" since it has no Supabase JWT claim (same reason
     `xp_events` writes route through `/api/validate-xp`).
   - **Setup required:** run `supabase/migrations/20260628_morph_submissions.sql`
     in the Supabase SQL editor. The status route needs `SUPABASE_URL`,
     `SUPABASE_SERVICE_KEY`, a manager address (`VITE_MANAGER_ADDRESS`), and an
     RPC URL (`VITE_RPC_URL`) in the Vercel env.
   - **Dev caveat:** the review *flip* calls `/api/update-morph-status`, which
     only runs under `npm run dev` (vercel dev) or a deployment — not under
     `npm run dev:vite`. Submitting + seeing the queue works in `dev:vite`;
     testing Verify/Reject needs the API route running.
   - *Hardening follow-up:* the route checks `callerWallet == curator()` but does
     not yet verify a signature/Privy token proving wallet control (the curator
     address is public). Add signed-proof verification before relying on it in
     an adversarial setting. Production RLS can also swap the dev-open insert
     policy for the wallet-scoped JWT policy (commented in the migration).
3. ~~**Timed acclimation checklist**~~ **DONE.** New `AcclimationChecklist.jsx`
   modal (built on the shared `Modal`) launched from a cyan **💧 Acclimate**
   button on each card in `IncomingSpecimens` (specimens + batches). Three timed
   steps — float 15m → drip 30m → net & release — with a live 1s countdown +
   progress bar. Progress persists to **non-indexed** fields on the specimen
   (`db.specimens`) / order (`db.marketOrders`) record (`acclimationStepIndex`,
   `acclimationStepStartedAt`, `acclimationStartedAt`, `acclimationCompletedAt`),
   so the timer resumes across close/reopen/reload — **no schema bump**. Pro
   "skip timer" escape hatch; awards `ACCLIMATION_COMPLETED` XP (20) once on
   finish; card shows **✅ Acclimated** when done.

### Known limitations / follow-ups
- **iOS push** requires the app be installed to home screen; push uses the combined
  SW + needs `VITE_VAPID_PUBLIC_KEY` env + a server push endpoint.
- `database`, `poseidon`, `leaderboard` have **no `/app` tab** yet — still standalone
  pages (`shared-nav` funnels everything else into the SPA). Decide later whether to
  build tabs for them.
- Security note from the Phase 2 audit: the standalone pages embedded the Supabase
  anon key inline (public by design); consider key rotation as part of beta hardening.

---

## Key files touched
- `frontend/src/main.jsx` — BrowserRouter + PwaManager mount
- `frontend/src/App.jsx` — router-driven tabs + lazy tab imports
- `frontend/src/components/PwaManager.jsx` — SW update + install prompts (new)
- `frontend/src/sw.js` — combined Workbox + push service worker (new)
- `frontend/js/shared-nav.js` — links re-pointed into `/app/*`
- `frontend/vite.config.js` — VitePWA config + `/app/*` dev rewrite + vendor `manualChunks`
- `frontend/vercel.json` — `/app/*` rewrite + legacy redirects
- `frontend/app.html` — PWA/iOS meta + icons
- `frontend/scripts/generate-pwa-icons.mjs` — icon generator (new)
- `frontend/public/icons/*` — generated PNG icons (new)
- `frontend/src/components/SpawnGrowoutTracker.jsx` — extracted reusable grow-out tracker (new)
- `frontend/src/components/GrowOutSection.jsx` — Breeder Tools Grow-Out sub-section (new)
- `frontend/src/components/MorphRegistration.jsx` — Breeder Tools Morphs sub-section, Supabase-backed + curator review panel (new)
- `frontend/src/services/morphSubmissionsApi.js` — Supabase CRUD for morph submissions (new)
- `frontend/api/update-morph-status.js` — service-role, curator-verified status flip (new)
- `supabase/migrations/20260628_morph_submissions.sql` — morph_submissions table + RLS (new)
- `frontend/src/components/AcclimationChecklist.jsx` — timed float→drip→release modal (new)
- `frontend/src/components/BreederTools.jsx` — added Grow-Out + Morphs sub-sections
- `frontend/src/components/IncomingSpecimens.jsx` — added 💧 Acclimate action + checklist mount
- `frontend/src/components/SpawningWizard.jsx` — case-insensitive tank/specimen loads, symmetric parent filtering, inline "create a new tank"
- `frontend/src/components/HatcheryLogs.jsx` — now imports the extracted tracker
- `frontend/src/utils/xp.js` — added `ACCLIMATION_COMPLETED` (20) + `MORPH_REGISTERED` (30) XP actions
- Deleted: `frontend/public/sw.js` + 7 legacy `*.html` pages
