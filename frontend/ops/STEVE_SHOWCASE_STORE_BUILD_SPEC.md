# Steve Showcase + Marketplace Store Build Spec

**Tier:** A — ownership, authorization, inventory, purchase paths, and publication are correctness-critical.  
**Working branch:** `feature/steve-showcase-store`, based on deployed release `e67b45c5eb979018a19588017d298d7c29c80384`.  
**Rollout target:** the main site at `https://aquacellum.com` only; Steve will not use a Vercel Preview deployment.  
**Stripe mode:** test mode only; this rollout must not enable live mode or create live charges.  
**Main-site mutation gate:** no room creation, listing creation, wallet linkage, media upload, commerce linkage, deployment, or publication until the authenticated Steve checkpoint in §8.

## 1. Outcome

Build one coherent public path for Steve:

- Marketplace discovery: `https://aquacellum.com/marketplace.html`
- Steve store: `https://aquacellum.com/store/ggstevericefishnj`
- Steve showcase: `https://aquacellum.com/showcase/ggstevericefishnj`

The marketplace remains the authoritative sales surface. The showcase presents Steve's room/tubs and may link each tub to one active marketplace batch listing. A listing must disappear from the showcase commerce projection automatically if it becomes inactive or its seller wallet is no longer actively verified for the showcase owner.

There is no Vercel Preview step for Steve. The owner publication preview referenced below is a bounded, authenticated read of the proposed public projection inside the main-site owner workflow; it is not a separate deployment environment and does not publish the room.

## 2. Known main-site identity and payment mode

Public main-site data currently reports:

- Store slug: `ggstevericefishnj`
- Display name: `ggstevericefishnj`
- Seller wallet: `0x41e562ee88825ad8d79b48311a30742ac276c9eb`
- Location: Toms River, New Jersey
- Active listings: 0
- Merchandising sections: 0
- Stripe mode: test

The wallet is an observed public storefront value, not sufficient proof of showcase ownership or test-mode Stripe Connect control. Steve must authenticate normally on the main site and prove/link this same wallet before any showcase commerce link is created. Stripe must remain in test mode; live payout readiness is not a requirement for this rollout, but the test-mode Connect and checkout path must be confirmed before test purchases are exposed.

## 3. Seller-provided listing content

The completed `STEVE_LISTINGS_INTAKE.xlsx` contains seven pickup offerings. Whitespace may be normalized, but names, prices, pack sizes, fulfillment, and husbandry claims must not otherwise be changed without Steve's approval.

| Source name | Proposed display name | Pack | USD | Pickup tub |
|---|---|---:|---:|---|
| medaka saffire pink | Saffire Pink Medaka | 4 | $75 | Breeder Tub 1 |
| medaka gradio | Gradio Medaka | 2 | $80 | Breeder Tub 2 |
| medaka echos of the moon | Echos of the Moon Medaka | 2 | $60 | Breeder Tub 3 |
| medaka shinkai | Shinkai Medaka | 4 | $50 | Breeder Tub 4 |
| medaka red emperor rlf | Red Emperor RLF Medaka | 2 | $75 | Breeder Tank 1 |
| aurora lame | Aurora Lame Medaka | 2 | $50 | Breeder Tub 5 |
| mixed | Mixed Medaka | 4 | $40 | Show Pond |

Shared source facts:

- Common name: Japanese Rice Fish
- Scientific name: *Oryzias latipes*
- Fulfillment: local pickup
- Pickup area: Toms River, NJ
- Care note: "Hardy, no heater needed; can outdoor overwinter, breeds easily"

The intake workbook does **not** establish live pack count, source cohort/spawn IDs, test-mode Connect readiness, current availability, or accurate product-photo filenames. Those remain required before listings become active.

## 4. Seller-provided morph/reference content

The local Steve media intake contains 62 JPEGs and 17 MP4s. Four reviewed read-only reference images have exact source provenance and existing public copies:

| Reference label | Public reference | Exact local source |
|---|---|---|
| Echos of the Moon | `/morphs/steve/echos-of-the-moon.jpg` | `docs/steves work/steves fish/Echos of the moon/IMG_20260907_170845_166.jpg` |
| Gladio | `/morphs/steve/gladio.jpg` | `docs/steves work/steves fish/Gladio/IMG_20260907_170316_865.jpg` |
| Pink Saffire | `/morphs/steve/pink-saffire.jpg` | `docs/steves work/steves fish/Pink Saffire/IMG_20260907_165711_163.jpg` |
| Shinkai | `/morphs/steve/shinkai.jpg` | `docs/steves work/steves fish/Shinkai/IMG_20260907_171554_111.jpg` |

These are references only. Source provenance does not establish registry verification, pedigree, ownership, product-photo approval, current inventory, or publication permission. Exact naming and photo-to-offering mapping still require Steve's confirmation.

Two stills are candidate Show Pond room heroes—`IMG_20260901_145511_983.jpg` and `IMG_20260901_145512_024.jpg`—but neither is approved for publication. `VID_20260901_115511_370.mp4` is the strongest video hero candidate, but all MP4 publication is explicitly deferred: the existing generic Mux route is not owner/target-bound for listing or showcase commerce, while the reviewed showcase media pipeline accepts images and emits revocable WebP derivatives only. No MP4 may be copied to `public/`, attached to a listing, or projected from the showcase until a separate authenticated, owner-bound, target-bound, webhook-correlated, revocable video design is implemented and reviewed.

The workbook filenames do not match several actual local files, and naming conflicts remain for `Gradio/Gladio`, `Saffire Pink/Pink Saffire`, and `Red Emperor RLF/Long Fin Red Emperor`. Red Emperor, Aurora Lame, Mixed, and exact product-photo mappings remain unresolved.

## 5. Local code scope

### 5.1 Public showcase window

Add the reviewed anonymous `showcase-room` action to the consolidated storefront function and add the `/showcase/:path*` page rewrite. The endpoint must:

- call only `showcase_public_room` through the service role;
- preserve identical 404 behavior for missing/private/conflict-blocked rooms;
- never query showcase base tables;
- return no-store responses;
- keep room slugs normalized and validated by the database projection.

### 5.2 Public media rendering

Render `room.hero` when present using `/api/showcase-media/<assetId>/hero` and its server-provided alt/focal point. Never expose bucket names, object keys, or signed Storage URLs. Keep listing photos as per-tank commerce imagery only.

### 5.3 Store/showcase navigation

Use the shared slug `ggstevericefishnj`:

- the showcase may show a **Shop Steve's store** link only after the matching public storefront detail endpoint resolves;
- the store may show a **View showcase** link only after the matching showcase endpoint resolves;
- no hardcoded claim that a room or inventory exists before those probes succeed;
- marketplace discovery remains driven by the existing public storefront discovery API.

### 5.4 Content tooling

Prepare a non-secret launch manifest from the completed workbook. It may prefill normalized copy and expected tub-to-offering mapping, but it must not contain:

- Privy access tokens;
- wallet signatures/nonces;
- service-role keys;
- fabricated listing IDs, cohort IDs, tank UUIDs, specimen UUIDs, inventory counts, or Stripe status.

Any population helper must call the existing authenticated owner/listing surfaces. It must not insert directly into showcase tables or bypass wallet/listing authorization with a service key.

### 5.5 Testable public trust boundaries

Keep anonymous room/media handlers in a dependency-injected module so tests invoke the real method, input, RPC, Storage, checksum, and response-header branches without a live service key. Keep browser URL/slug/path guards in a shared pure module consumed by both public pages. The regression suite must execute these guards and pin the SQL ownership/revocation and migration-order contracts; static catalog checks alone are insufficient.

### 5.6 Marketplace presentation rule

`marketplace.html` remains generic and data-driven. It already renders allowlisted `photoUrl`/`imageUrl` values from active public listings and active storefront avatar/banner media. Do not add a Steve-specific fake listing array, editorial card that implies inventory, or direct `docs/` media path. Steve appears with approved imagery only after authenticated seller workflows create real active listings/profile media; the existing public marketplace and store readers then discover it automatically.

## 6. Main-site data and publication sequence

1. Steve signs in through the normal Privy flow on `https://aquacellum.com`.
2. Confirm his session wallet is exactly the intended seller wallet.
3. Confirm Stripe Connect and checkout are functional in **test mode**; do not enable live mode or require live payout readiness.
4. Link the seller wallet to the showcase owner through `wallet-claim-link` or EIP-191 wallet proof.
5. Confirm Steve has no existing lifetime showcase room before `room-create`.
6. Confirm canonical verified tanks/cohorts exist; never invent publication-authoritative entities.
7. Create seven real batch listings from real cohorts and current sellable inventory through authenticated main-site seller surfaces.
8. Upload and verify one exact product photo per offering with Steve's publication permission.
9. Retrieve the existing room or create the private room once using final slug `ggstevericefishnj`.
10. Place the seven verified tubs/tank/pond entities while private.
11. Link each placement to its active Steve-owned batch listing using current placement revisions.
12. Upload/process/publish an approved still room hero through the private media pipeline.
13. Run the owner publication preview inside the authenticated main-site workflow and review every public field, test price, pack size, image, and CTA. This is not Vercel Preview and does not publish.
14. Publish using the latest room revision only after Steve approves that main-site owner preview.
15. Verify main-site marketplace discovery, store, showcase, product routes, Stripe test checkout, and rollback-to-private behavior.

## 7. Acceptance criteria

### Public storefront

- `marketplace.html` discovers Steve's active storefront on the main site.
- `/store/ggstevericefishnj` returns 200 and renders only active Steve-owned listings.
- Exactly the seller-approved offerings are shown with correct pack size, test-mode USD price, photo, and local-pickup status.
- Each listing links to its canonical `/app/products/batch-<id>` route.
- Checkout revalidates active listing, price, quantity, seller, test-mode Connect readiness, and fulfillment.
- Checkout creates only Stripe test-mode sessions; no live charge or live-mode activation occurs.

### Public showcase

- `/showcase/ggstevericefishnj` returns 200 only after publication.
- Private, missing, or conflict-blocked rooms remain indistinguishable 404 responses.
- The approved room hero renders through the authorization proxy and becomes unreadable after revoke/private rollback.
- Every public placement belongs to Steve, is verified/conflict-free, and shows only seller-approved facts.
- Every commerce CTA resolves to an active listing owned by Steve's actively verified wallet.
- Deactivating a listing or revoking wallet linkage removes the showcase CTA without exposing another seller's listing.

### Navigation and safety

- Store ↔ showcase links appear only when their corresponding public endpoint resolves.
- No browser role gains direct access to showcase tables or private media buckets.
- No service-role secret, Privy token, wallet proof, object key, or private address enters source control or logs.
- Room creation is attempted at most once and only after an authenticated read confirms no existing room.
- Publication can be rolled back to private without the rollout allowlist.
- Steve is never directed to a Vercel Preview deployment; his authenticated review occurs on the main site while the room remains private.

### Validation

- Targeted endpoint, page-rendering, commerce-ownership, publication-gate, and media-revocation tests pass.
- Vite production build passes.
- ESLint has zero errors for changed files.
- `git diff --check` passes.
- The main site remains unchanged until the explicit authenticated population/deployment checkpoint.

## 8. Required authenticated main-site checkpoint

Before any main-site population or direct deployment, obtain or confirm all of the following with Steve present on `https://aquacellum.com`:

1. He can sign in to the existing `ggstevericefishnj` profile on the main site.
2. The connected wallet is `0x41e562ee88825ad8d79b48311a30742ac276c9eb`, or an explicit migration decision is made before proceeding.
3. Stripe remains in test mode, and Steve's test-mode Connect/checkout path is confirmed; live payout readiness is out of scope.
4. Current pack inventory/count for each of the seven offerings.
5. Real cohort/spawn record for each batch listing.
6. Exact product photo mapping and permission to publish each image.
7. Naming confirmation for `Saffire/Pink Saffire`, `Gradio/Gladio`, and `Red Emperor RLF`.
8. Confirmation that he has no existing showcase room, or retrieval of the existing room instead of creating another.
9. Exact canonical tank IDs for the seven named tubs/tank/pond.
10. Explicit approval of the authenticated owner publication preview on the main site while the room is still private.
11. Explicit authorization for direct main-site deployment/population and subsequent publication.

Without this checkpoint, the safe deliverable is local code plus a launch manifest—not fabricated inventory, a direct main-site seed, or a deployment. No Vercel Preview deployment is part of this rollout.
