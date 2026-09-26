# Steve Showcase Owner Builder and Media Rollout

**Status:** Tier A implementation specification  
**Target:** `https://aquacellum.com` only (no Vercel Preview)  
**Payments:** Stripe test mode only  
**Owner wallet expected:** `0x41e562ee88825ad8d79b48311a30742ac276c9eb`  
**Public slug:** `ggstevericefishnj`

## 1. Goal

Build Steve's production showcase from tanks that are actually present on his authenticated Aquacellum account, then attach only Steve-approved photos and videos through owner-bound, target-bound, revocable media flows. The workflow must never fabricate tank, cohort, inventory, listing, or ownership identifiers and must not put Privy tokens, wallet signatures, service keys, storage keys, Mux identifiers, or signed URLs in source control or logs.

## 2. Verified live checkpoint

Read-only checks established:

- Steve's public store resolves to wallet `0x41e562ee88825ad8d79b48311a30742ac276c9eb`.
- The store currently has zero active listings.
- `/showcase/ggstevericefishnj` has no published room; the public data endpoint returns the expected private/missing `404`.
- The configured Base Sepolia manager (`0x0741D50d49e7374b855b532c17aD36aBF8AF3b3e`) reports zero on-chain tanks for Steve's wallet.
- Aquacellum's beta tank loader is local-first. Steve's real tanks are therefore expected in the Dexie database on the browser/device where he created or imported them.
- No authenticated showcase owner-builder UI exists. The reviewed server API exists, but it is not consumed by React.
- Production has the showcase S3/media variable names and `PRIVY_APP_ID`, but does not currently list `SHOWCASE_APP_ORIGIN`, `SHOWCASE_CHAIN_ID`, or `SHOWCASE_PUBLISH_ALLOWLIST`.
- The generic Mux uploader is not safe for showcase publication: it accepts a caller-supplied wallet, creates public playback IDs, performs best-effort webhook verification, lacks exact room/tank binding, and cannot revoke playback when a room becomes private.

Consequences:

1. Steve must use the main-site authenticated builder on the browser containing his local tanks.
2. No server-side script can truthfully discover those local tanks before Steve signs in.
3. The first safe release is a private owner workflow; public publication is a later explicit action.
4. MP4s must not be copied into `public/` or passed through the generic Mux uploader.

## 3. Launch phases

### Phase A — Authenticated tank and private-room builder

Build a Steve-first section at `/app/breeder-terminal?section=showcase`.

The section must:

1. Require `ready && authenticated && account` from Privy.
2. Show the current wallet and hard-block launch actions unless it equals Steve's expected wallet.
3. Obtain a fresh Privy access token for every `/api/showcase-owner` request.
4. Call `bootstrap` and `room-read` before any mutation.
5. Read only active raw Dexie tanks whose normalized `ownerAddress` equals the authenticated wallet.
6. Let Steve explicitly select and confirm the seven intended tanks; never select by label automatically.
7. Convert the confirmed tanks into the reviewed schema-v3 identity package with stable persisted UUID mappings and browser/server-identical JCS SHA-256 values.
8. Enroll, import, finalize, and candidate-stage the selected tanks through the existing owner API.
9. Stop on identity conflicts. Only `room-read.available[].eligible === true` tanks may be placed.
10. Retrieve an existing lifetime room or create one exactly once after an authenticated read confirms absence.
11. Keep the room private while editing and use current CAS revisions for every mutation.
12. Place the verified tanks using Steve-approved labels/slugs and render the exact server `publication-preview`.
13. Keep a visible "Make private" rollback control whenever a room is non-private.

Phase A does not create marketplace inventory or listings. Commerce buttons remain absent until real Steve-owned active listings exist.

### Phase B — Owner-bound still media

Use the existing room-hero pipeline for one approved hero image. Add a bounded owner-authorized private derivative reader so Steve can review the processed hero while the room remains private; do not temporarily publish the room to preview media.

After the hero seam is working, extend the reviewed image model with a room gallery or exact placement-target image attachment before claiming per-tank photography. Static `/morphs/steve/*` files remain reference images and must not silently become product or tank media.

Requirements:

- `jpg`, `jpeg`, `png`, or `webp` only; 1 byte–8 MiB.
- Steve selects the local file and affirms publication permission.
- Stage creates an owner/room-bound exact-object intent.
- Direct PUT uses exactly the returned method and signed headers and never includes the Privy bearer token.
- Finalize performs server-side HEAD validation and durable processing.
- Publish requires approved state, metadata stripping, both derivatives, alt text, and focal point.
- Private preview is owner-authorized and no-store.
- Making the room private denies anonymous bytes immediately; revoke permanently denies and schedules deletion.

### Phase C — Owner-bound room video gallery

Add a separate room-level gallery for up to 20 MP4 clips. Do not widen the image tables and do not add per-tank video in the first release.

The video lifecycle must be separately persisted and must mirror the image pipeline's authority model:

- immutable `(owner_id, room_id, asset_id)` binding;
- private source upload intent and quota reservation before upload capability;
- MP4 only, maximum 60 seconds, maximum 250 MiB, bounded dimensions/codecs;
- server-observed size/checksum and durable ingest job;
- Mux asset with **signed** playback policy only;
- strict raw-body webhook HMAC verification, freshness window, constant-time compare, and replay ledger;
- webhook correlation requiring stored internal asset UUID, random/HMAC correlation, and provider IDs to agree;
- bounded public DTO that never exposes Mux asset/playback IDs;
- same-origin playback-token endpoint that freshly confirms the room and asset are public and returns no-store signed Mux URLs valid for at most 60 seconds;
- room-private and revoke operations deny all new playback tokens; revoke/reset also queue provider/source deletion;
- late/out-of-order webhook events cannot resurrect revoked media.

The existing generic Reef/Mux upload behavior must not be used as the showcase authority path.

## 4. Source tank-to-media plan

These are proposed review assignments, not publication approval and not canonical tank IDs.

| Intended placement | Proposed line | Still candidate | Video candidate | Status |
| --- | --- | --- | --- | --- |
| Breeder Tub 1 | Saffire Pink / Pink Saffire | `/morphs/steve/pink-saffire.jpg`; source `Pink Saffire/IMG_20260907_165711_163.jpg`; proof `IMG_20260901_145442_070.jpg` | none confirmed | Naming and target-use approval required |
| Breeder Tub 2 | Gradio / Gladio | `/morphs/steve/gladio.jpg`; source `Gladio/IMG_20260907_170316_865.jpg` | `VID_20260901_115451_294.mp4` | Naming and target-use approval required |
| Breeder Tub 3 | Echos of the Moon | `/morphs/steve/echos-of-the-moon.jpg`; source `Echos of the moon/IMG_20260907_170845_166.jpg` | none identified | Target-use approval required |
| Breeder Tub 4 | Shinkai | `/morphs/steve/shinkai.jpg`; source `Shinkai/IMG_20260907_171554_111.jpg` | `VID_20260901_115510_666.mp4` | Target-use approval required |
| Breeder Tank 1 | Red Emperor RLF / Long Fin Red Emperor | extracted frame `frames/VID_20260901_115510_665.jpg` or `frames/VID_20260901_115520_609.jpg` | `VID_20260901_115510_665.mp4` or `_115520_609.mp4` | Naming, clip selection, and target-use approval required |
| Breeder Tub 5 | Aurora Lame / Blue Aurora Lame | extracted frame `frames/VID_20260901_115521_576.jpg` | `VID_20260901_115521_576.mp4` | Naming and target-use approval required |
| Show Pond | Mixed Medaka | `IMG_20260901_145511_983.jpg` or `IMG_20260901_145512_024.jpg` | `VID_20260901_115511_370.mp4` | Hero/clip selection and target-use approval required |

Duplicate clips marked `skip` in `docs/steves work/STEVE_MEDIA_MAPPING.csv` must not be imported.

## 5. Required implementation boundaries

### Browser service

Create `src/services/showcaseOwnerApi.js` with a module-level Privy token getter registered by `AuthContext`. It must:

- POST exact JSON to `/api/showcase-owner?action=<action>`;
- fetch a fresh access token per request;
- never persist or log tokens;
- normalize closed error envelopes;
- support `AbortSignal` and bounded request timeout;
- never auto-replay room creation or publication after an ambiguous response.

### Browser identity adapter

Create `src/services/showcaseDatasetV3.js`. It must:

- read owner-scoped raw Dexie rows only;
- reject schema-v2 backup files as showcase evidence;
- persist stable dataset/entity UUID mappings before the first request;
- emit exact schema-v3 rows, aliases, chunks, manifest, and identity package;
- use RFC 8785-compatible canonicalization and `crypto.subtle.digest`;
- preserve operation IDs and exact request bodies across safe retries;
- fail closed if local durable mapping is missing while the server reports an existing active dataset.

Do not use the merged/synthetic `useUserTanks` output as identity evidence.

### Owner UI

Create `src/components/breeder/ShowcaseOwnerBuilder.jsx` and integrate it into the Breeder Terminal. The component is a state machine, not a direct Supabase client.

Required states:

- auth loading / sign-in required / wrong wallet;
- bootstrapping / wallet link required / identity ready;
- tank selection / confirmation;
- enrolling / chunk upload / finalizing / verifying / conflict;
- room absent / private editable / must make private / revision stale;
- hero permission / upload / processing / approved / attached;
- preview loading / preview ready / publication blocked;
- approval required / publishing / published / unpublishing.

### Private still preview

Add an owner-authenticated, owner-bound derivative read path. It must authorize the verified owner against the exact asset/room and return only an approved processed derivative with no-store headers. Anonymous authorization remains unchanged and must continue requiring a public/unlisted room.

### Video

Video is a separate Tier A migration/API/client phase. The detailed invariants in Phase C are mandatory. The first bounded video target is the room gallery; per-placement video requires a later design for placement removal, transfer, and tank visibility.

## 6. Environment gates

Before wallet proof or publication can work in Production, set and review:

- `SHOWCASE_APP_ORIGIN=https://aquacellum.com`
- `SHOWCASE_CHAIN_ID=84532`
- `SHOWCASE_PUBLISH_ALLOWLIST=<Steve Privy subject or exact expected wallet>`

These are authorization-sensitive production changes and require explicit confirmation immediately before application. Stripe keys and mode must not be changed.

For video, confirm Mux signed-playback signing credentials and strict webhook configuration separately. Existing `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, and `MUX_WEBHOOK_SECRET` names alone are not proof that signed playback is configured.

## 7. Publication sequence

1. Deploy the reviewed owner builder with the room still private.
2. Steve signs in on the main site using the browser/device containing his tanks.
3. Confirm the connected wallet exactly matches the expected store wallet.
4. Bootstrap and retrieve any existing lifetime room/dataset before creation/enrollment.
5. Steve explicitly maps seven local tanks to the seven intended placements.
6. Import and verify selected tanks; stop on conflicts.
7. Create or update the private room and placements.
8. Steve selects/approves the still hero; upload, process, attach, and privately preview it.
9. Add approved gallery images/videos only after their reviewed pipelines are deployed.
10. Review the exact private publication projection with Steve.
11. Apply the three production showcase environment gates after explicit approval.
12. Publish using the latest room revision.
13. Verify anonymous room/media, store links, and private rollback.
14. Create marketplace listings later from real cohorts and current inventory; only then link commerce to placements.

## 8. Acceptance criteria

### Ownership and identity

- Signed-out, MetaMask-only, wrong-wallet, and missing-token sessions cannot mutate showcase state.
- Every owner request resolves authority from the verified Privy subject; no request body chooses an owner.
- Only active raw tanks belonging to the current normalized wallet are selectable.
- Entity UUIDs and operation IDs are stable across retries.
- No tank is placeable until the server reports it verified, eligible, and conflict-free.
- Room creation occurs at most once after authenticated absence is confirmed.

### Private editing and publication

- All edits occur while private and use current revisions.
- Anonymous room and media paths remain `404` throughout private construction.
- Preview renders the exact server projection, not local form state.
- Publication requires a fresh preview, no blockers, explicit Steve approval, allowlist authorization, and latest revision.
- Making the room private remains available even if the publish allowlist is removed.

### Still media

- Only a Steve-selected and permission-confirmed supported image is staged.
- The direct upload has exact owner/room binding and no bearer token on the storage PUT.
- Metadata-stripped approved derivatives are required before attachment.
- Owner private preview does not make anonymous bytes readable.
- Private/revoke transitions deny anonymous reads; revoke queues deletion.

### Video

- All showcase videos use signed playback policy and exact owner/room binding.
- Invalid/stale/replayed webhooks perform no unauthorized transition.
- No public DTO exposes provider IDs or credentials.
- Every playback token request freshly checks room and asset publication state.
- Private/revoke removes token access; revoked assets cannot be resurrected by late events.
- All 17 non-duplicate source clips fit within the bounded 20-item room gallery, subject to Steve's individual approval.

### Commerce and payments

- The showcase may publish without commerce.
- No listing key, cohort, or inventory count is fabricated.
- Commerce appears only for active listings owned by Steve's verified wallet.
- Stripe remains in test mode; no live-mode activation or live charge occurs.

## 9. Explicit non-goals

- No direct table seeding or service-role browser access.
- No Vercel Preview deployment for Steve.
- No automatic media publication based on folder names or best-guess classification.
- No hardcoded Steve inventory in `marketplace.html`.
- No use of generic public Mux playback for showcase video.
- No per-tank video until room-gallery authorization and revocation are proven.
- No inspection or modification of `supabase/migrations/20260830120000_morph_subspecies.sql`.
