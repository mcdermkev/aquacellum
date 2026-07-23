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

## Task 21D — Hardening + accessibility audit pass (Tier B, no review gate)

Ran the audit checklist from `docs/TASK_21D_PWA_HARDENING_SPEC.md` §2 against
the infrastructure above (which already works — this was verification +
targeted fixes, not a rebuild) and added the one net-new feature (high-contrast
mode). **Honesty note:** actual install/update/offline/push/screen-reader
behavior needs a real device + browser + assistive technology to fully verify;
what follows is what could be checked by reading code/config plus the concrete
fixes made. Items marked ⚠️ NEEDS MANUAL VERIFICATION were not (and cannot be)
exercised in this environment.

### Install — ✅ pass, no changes needed
- `beforeinstallprompt` capture in `PwaManager.jsx` is gated behind
  `!isStandalone()` (checks both `display-mode: standalone` and iOS's
  `navigator.standalone`), so the prompt is suppressed once installed.
- iOS hint (`showIosHint`) only sets when `isIosDevice() && !isStandalone()`
  and the dismissal is remembered in `localStorage` (`aquadex_ios_install_hint_dismissed`).
- Manifest `scope: '/'`, `start_url: '/app'` — `/store/*`, `/app/*`, and every
  marketplace route fall inside scope; nothing needed narrowing/widening.
- ⚠️ NEEDS MANUAL VERIFICATION: real Android/desktop Chrome `beforeinstallprompt`
  firing, actual "Add to Home Screen" on a real iOS device, and confirming the
  installed app opens at `/app` with no browser chrome.

### Update — ✅ pass, no changes needed
- `registerType: 'prompt'` + `useRegisterSW` wired correctly in `PwaManager.jsx`;
  `updateServiceWorker(true)` on "Reload" triggers `sw.js`'s `SKIP_WAITING`
  message handler → `self.skipWaiting()`.
- Update checks fire on load, on window `focus`, on `visibilitychange` →
  `visible`, and every 30 minutes for long-lived tabs — all present and
  correctly wired to `registration.update()`.
- ⚠️ NEEDS MANUAL VERIFICATION: that a real deploy actually flips `needRefresh`
  promptly and that reload doesn't leave a stale shell (the `injectManifest`
  precache + `skipWaiting` combination should prevent this, but only a live
  deploy proves it).

### Offline — ✅ pass (one real bug found and fixed elsewhere, see Push below)
- App-shell precache + `StaleWhileRevalidate` runtime JS caching are configured
  correctly in `sw.js`; `/api/*` is explicitly `NetworkOnly` (never serves stale
  authenticated data offline).
- `MarketplaceBoard.jsx` and `StorefrontPage.jsx` both track `navigator.onLine`
  and render an explicit offline banner over cached data — offline never look
  like a blank screen or a raw fetch error on those surfaces.
- The Task 10 cart is Dexie-backed (`cartStore.js`) and reads/writes locally
  first, syncing to the server only best-effort — usable offline by design.
- The Task 18 buyer order cache (`relayGetOrders`/Dexie `marketOrders`) is the
  same local-first pattern.
- **Pending-handoff verification language:** checked the cash/pickup handoff
  path (`HandshakeVerification.jsx`, `relaySettleHandshake`) — success/"settled"
  toasts only render **after** the relay call resolves with `result.success`;
  there is no optimistic "complete" state shown before that network
  confirmation, which matches the plan's "pending verification, not complete"
  requirement. There isn't a dedicated *offline* state for this flow (a fully
  offline device just gets the relay's own error), so a genuinely offline
  handoff attempt surfaces as an error rather than a distinct "pending
  verification" banner — worth a small follow-up if beta testers hit this in
  a low-signal venue setting, but it does not violate the "never show complete
  before verification" rule.
- ⚠️ NEEDS MANUAL VERIFICATION: actually going offline mid-session on a device
  and exercising cart checkout, order viewing, and a cash handoff attempt.

### Push — 🐛 real bug found and fixed
- `supabase/functions/order-notifications/index.ts` (the Edge Function that
  fires on every `orders` UPDATE/INSERT) was deep-linking every marketplace
  push notification (new order, dispatched, released, disputed, resolved,
  refunded — 9 call sites) to **`/marketplace?tab=orders`**, a URL from the
  pre-Phase-1 multi-page-HTML era. Since Phase 1/2 of this migration,
  `marketplace.html` is the static public browse page with no tab concept and
  the real order surface is `/app/orders` (the React Router SPA). Every
  marketplace push notification's deep link was silently broken (would land on
  the public browse page, not the buyer/seller's actual order). **Fixed**: all
  9 occurrences now deep-link to `/app/orders`.
  - This function was not touched by the Phase 1 migration (which only updated
    `js/shared-nav.js` and in-app navigation calls) — this is exactly the kind
    of stale-link regression a URL migration leaves behind in server-side code
    outside the audited client bundle.
- **Smaller gap noted, not fixed (icon assets don't exist yet):** the same
  function references `icon: "/icons/order-new.png"` /
  `order-shipped.png`/`order-complete.png`/`order-alert.png`/`order-refund.png`
  — none of these files exist in `frontend/public/icons/` (only the app-icon
  set: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon-180.png`). Browsers fall back to a default icon when the
  referenced image 404s, so this degrades gracefully (no broken notification),
  but the intended per-event iconography never actually renders. Left as a
  follow-up rather than fabricating five new icon assets in a hardening pass —
  flagging here so it's tracked.
- `sw.js`'s `notificationclick` handler correctly reads `event.notification.data.url`
  (which now carries the fixed `/app/orders` path) and either focuses an
  existing client + posts a `NOTIFICATION_CLICK` message, or opens a new
  window at that URL.
- ⚠️ NEEDS MANUAL VERIFICATION: an actual push round-trip (subscribe → trigger
  an order status change → notification arrives → click → lands on
  `/app/orders`) on a real device/browser with push permission granted.

### Perf — ✅ pass, no changes needed
- Marketplace listing images already lazy-load via `LazyImage.jsx`
  (`IntersectionObserver`, `rootMargin: "300px"`, shimmer placeholder while
  loading) — not a raw `<img>` per card.
- `MarketplaceBoard.jsx` virtualizes the listing grid with
  `@tanstack/react-virtual` (`useVirtualizer`) rather than rendering every
  listing DOM node at once.
- `vite.config.js`'s `manualChunks` already splits `react-vendor` and
  `icons-vendor` out of the app entry chunk (Phase 4b, done); all nine main
  tabs in `App.jsx` are `React.lazy`-loaded per-tab chunks; `ethers` is a
  UMD-global shim, not bundled.
- No obvious regression found; nothing flagged for follow-up here.

### Accessibility sweep — 2 real gaps found and fixed, findings below
Ten modal-like surfaces (`AcclimationChecklist`, `ArrivalModal`,
`BatchListingWizard`, `EditListingModal`, `FeedbackWidget`, `ListSpecimenModal`,
`OfferModal`, `ProductDetailModal`, `SpecimenDetailModal`, `WhatsNewModal`,
plus `CartDrawer` via its sliding-drawer variant) already compose the shared
accessible `Modal.jsx` (`role="dialog"`, `aria-modal`, focus trap, Escape-to-close,
focus return on close). Two older, form/camera-heavy surfaces predated that
component and had none of this:
- **`ShippingRateModal.jsx`** (buyer address/rate picker at checkout) — was a
  bare `<div>` overlay with no dialog role, no Escape handler, no focus
  management, and an unlabeled `✕` close button. **Fixed**: added
  `role="dialog"`/`aria-modal`/`aria-label`, an Escape-to-close keydown
  listener scoped to `isOpen`, initial focus into the dialog on open, and
  `aria-label="Close shipping options"` on the close button. Did not migrate
  it onto the shared `<Modal>` component itself (would mean restructuring a
  form-heavy layout with live rate-fetching state — out of scope for a
  hardening pass; the fix gives it the same *contract* `Modal` provides).
- **`HandshakeVerification.jsx`** (pickup/cash QR handoff + camera scanner) —
  same gaps (no dialog role/Escape/focus management, unlabeled close button).
  **Fixed** identically; left the camera/scan state untouched.
- Both fixes are covered by source-guard tests
  (`src/components/a11yAudit.catalog.test.js`).
- Spot-check contrast pass (`meetsContrastAA` from `utils/a11y.js`,
  checked manually against the documented tokens in
  `docs/BRAND_KIT.md` — `--text-primary #f8fafc` / `--text-secondary #94a3b8`
  on `--bg-primary #080c14` and glass surfaces):

  | Surface | Text/bg pair | AA (normal text, 4.5:1)? |
  |---|---|---|
  | Cart drawer (`CartDrawer.jsx`) | `--text-primary` on `--bg-primary` | Pass (contrast ≈ 17.9:1) |
  | Orders list (`CheckoutSummary.jsx`) | `--text-secondary` on `--bg-primary` | Pass (≈ 8.4:1) |
  | Storefront (`StorefrontPage.jsx`) | `--text-muted #7d8fa3` on `--bg-primary` | **Borderline** (≈ 5.4:1, passes 4.5:1 but with less margin — fine for body text, avoid using `--text-muted` for anything below ~14px) |
  | Breeder Terminal (`BreederTerminal.jsx`) | `--text-primary` on glass cards (`--glass-bg` over `--bg-primary`) | Pass (glass overlay only slightly lightens the effective background) |
  | Checkout (`ShippingRateModal.jsx`) | `#fff` on `#0f1b2a` (component-local, not tokenized) | Pass (≈ 16.8:1) |

  This was a manual token-value check, not an automated per-pixel audit (no
  rendered DOM available in this environment) — treat as directional, not a
  certified WCAG pass. ⚠️ NEEDS MANUAL VERIFICATION with a real contrast
  checker against rendered pages, plus screen-reader (VoiceOver/NVDA/TalkBack)
  passes over the fixed modals and the new high-contrast toggle.

### Net-new: high-contrast mode toggle — done
- `src/hooks/useHighContrast.js` — mirrors `useFontSettings.js`'s shape
  exactly: a `localStorage`-persisted boolean (`aquadex_high_contrast`),
  applied via a root `data-contrast="high"` attribute on
  `document.documentElement`. The load/persist/apply functions each take an
  injectable storage/target so they're unit-testable without a DOM (this
  repo's vitest runs in a `node` environment).
- Applied app-wide via a root-level `useHighContrast()` call in `App.jsx`,
  next to the existing `useFontSettings()` call — same pattern, so the
  preference is active immediately on load, not only while the Settings tab
  is open.
- `src/components/HighContrastToggle.jsx` — a real `<button role="switch"
  aria-checked aria-label>` (keyboard-operable natively, ≥44px target),
  `announce()`s the new state on toggle. Mounted in the Settings tab next to
  `FontSizeSettings` (the accessibility cluster).
- **CSS discrepancy vs. the spec's assumption:** the spec's §0 context claimed
  `index.css`/`storefront.css` "already has `prefers-contrast`/
  `prefers-reduced-motion` rules." Verified `prefers-reduced-motion` does
  exist (several blocks in `index.css`, `storefront.css`); **`prefers-contrast`
  did not exist anywhere in the codebase** — only the reduced-motion query was
  real. Added both the OS-level `@media (prefers-contrast: more)` rule and the
  manual `[data-contrast="high"]` rule together in `index.css`, sharing the
  same raised-contrast token values (stronger `--text-*`, less transparent/less
  blurred `--glass-*`, thicker glass-card borders, and a visible 3px white
  focus ring on every interactive element) — so this toggle is the first place
  either form of high-contrast support exists in the app, not a composition of
  a pre-existing rule.
- Tests: `src/hooks/useHighContrast.test.js` (persist/apply logic +
  root-level-application source-guards), plus toggle keyboard/labeling
  source-guards in the same file.

### Summary
| Area | Result |
|---|---|
| Install | ✅ Pass — no code changes needed |
| Update | ✅ Pass — no code changes needed |
| Offline | ✅ Pass — cart/orders/cash-handoff behavior all correct |
| Push | 🐛 Fixed — 9 stale `/marketplace?tab=orders` deep links → `/app/orders`; noted (not fixed) 5 missing per-event icon assets |
| Perf | ✅ Pass — lazy images + virtualized grid + code-split chunks already in place |
| Accessibility | 🐛 Fixed — 2 modal-like surfaces lacked dialog semantics/focus management/Escape; added a spot-check contrast table |
| High-contrast mode | ✅ Built — hook + toggle + CSS (both OS-level and manual), applied app-wide |

**What still needs manual device/browser/AT testing** (cannot be verified from
code alone): real install prompts on Android/desktop/iOS, a live deploy's
update-prompt timing, going genuinely offline mid-session, an actual push
subscribe→notify→click round trip, and a screen-reader pass (VoiceOver/NVDA/
TalkBack) over the two newly-fixed modals and the high-contrast toggle. A full
cross-device/AT matrix is Task-24-style scope, not this hardening pass.

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

### Task 21D additions
- `frontend/src/hooks/useHighContrast.js` — high-contrast mode hook (new)
- `frontend/src/hooks/useHighContrast.test.js` — unit tests (new)
- `frontend/src/components/HighContrastToggle.jsx` — Settings-tab toggle (new)
- `frontend/src/App.jsx` — root-level `useHighContrast()` call + `<HighContrastToggle>` mount in Settings
- `frontend/src/styles/index.css` — added `@media (prefers-contrast: more)` + `[data-contrast="high"]` rulesets
- `frontend/src/components/ShippingRateModal.jsx` — added dialog semantics, Escape-to-close, focus management, labeled close button
- `frontend/src/components/HandshakeVerification.jsx` — same a11y fixes as above
- `frontend/src/components/a11yAudit.catalog.test.js` — source-guards for both a11y fixes (new)
- `frontend/src/components/PwaManager.test.js` — install/update source-guards (new)
- `supabase/functions/order-notifications/index.ts` — fixed 9 stale `/marketplace?tab=orders` push deep links → `/app/orders`
