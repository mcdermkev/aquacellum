/**
 * Specimen photo resolution (§9.3).
 *
 * THE BUG: specimen photos were base64-stuffed straight into `localStorage` under
 * `aquadex_specimen_photo_<id>`. That shares one ~5MB origin quota with every other
 * photo, is never synced, and is gone on a cache clear — so a buyer who receives a
 * fish on another device sees no photo of the animal they just paid for.
 *
 * The durable table (`tankMedia`) and the CDN bucket (`specimen-photos`) already
 * existed; what was missing was ONE resolver. Seven readers had each invented their
 * own fallback, which is how they drifted: TankList checked Dexie then localStorage,
 * MarketplaceBoard treated the cloud copy as a second carousel entry, and everyone
 * else read the raw key only.
 *
 * So these tests are about the precedence order being singular and honest — absence
 * resolves to `none`, never to a stand-in image — plus source guards that the seven
 * readers actually went through it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Dexie `tankMedia` stand-in ──────────────────────────────────────────────
let mediaRows = [];
let nextMediaId = 1;
let compoundIndexUsed = null;

vi.mock("../db", () => ({
  db: {
    tankMedia: {
      where(index) {
        compoundIndexUsed = index;
        return {
          equals([refType, refId]) {
            const matches = () => mediaRows.filter((r) => r.refType === refType && r.refId === refId);
            return {
              first: async () => matches()[0],
              last: async () => matches()[matches().length - 1],
              toArray: async () => matches(),
            };
          },
        };
      },
      add: async (row) => {
        const id = nextMediaId++;
        mediaRows.push({ id, ...row });
        return id;
      },
      update: async (id, patch) => {
        const row = mediaRows.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        return row ? 1 : 0;
      },
      delete: async (id) => {
        mediaRows = mediaRows.filter((r) => r.id !== id);
      },
    },
  },
}));

// ─── localStorage stand-in (the test env is node, so there isn't one) ─────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
  key: (i) => [...lsStore.keys()][i] ?? null,
  get length() { return lsStore.size; },
};

const {
  SPECIMEN_PHOTO_SOURCE,
  clearHostedSpecimenPhotoUrl,
  deleteSpecimenPhoto,
  hostedSpecimenPhotoUrlKey,
  putSpecimenPhoto,
  readHostedSpecimenPhotoUrl,
  recordHostedSpecimenPhotoUrl,
  resolveSpecimenPhoto,
  specimenPhotoKey,
} = await import("../services/tankMedia");

const ID = 4217;
const HOSTED =
  "https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/specimen-photos/0xaaaa/4217_1731000000.jpg";
const DEXIE_BLOB = "data:image/jpeg;base64,ZGV4aWU=";
const LEGACY_BLOB = "data:image/jpeg;base64,bGVnYWN5";

beforeEach(() => {
  mediaRows = [];
  nextMediaId = 1;
  lsStore.clear();
});

describe("the source enum", () => {
  it("names every step of the precedence order and is frozen", () => {
    expect(SPECIMEN_PHOTO_SOURCE).toEqual({
      HOSTED: "hosted",
      LOCAL: "local",
      LEGACY_LOCAL_STORAGE: "legacyLocalStorage",
      NONE: "none",
    });
    expect(Object.isFrozen(SPECIMEN_PHOTO_SOURCE)).toBe(true);
  });

  it("agrees with the call sites on both localStorage key shapes", () => {
    // The keys the seven readers used, and the one the uploader records into.
    expect(specimenPhotoKey(ID)).toBe(`aquadex_specimen_photo_${ID}`);
    expect(hostedSpecimenPhotoUrlKey(ID)).toBe(`aquadex_specimen_photo_url_${ID}`);
    // A numeric id and its string form must not resolve to different photos.
    expect(specimenPhotoKey("4217")).toBe(specimenPhotoKey(4217));
  });
});

describe("precedence — each step in isolation", () => {
  it("1. hosted: the URL handed in by the caller", async () => {
    const result = await resolveSpecimenPhoto(ID, { hostedUrl: HOSTED });
    expect(result).toEqual({ url: HOSTED, source: SPECIMEN_PHOTO_SOURCE.HOSTED });
  });

  it("1. hosted: the URL recorded by a successful bucket upload", async () => {
    recordHostedSpecimenPhotoUrl(ID, HOSTED);
    expect(readHostedSpecimenPhotoUrl(ID)).toBe(HOSTED);

    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({ url: HOSTED, source: SPECIMEN_PHOTO_SOURCE.HOSTED });
  });

  it("2. local: the durable Dexie row", async () => {
    await putSpecimenPhoto(ID, DEXIE_BLOB);
    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({ url: DEXIE_BLOB, source: SPECIMEN_PHOTO_SOURCE.LOCAL });
    // It really is the durable table, queried on the compound index.
    expect(mediaRows).toHaveLength(1);
    expect(mediaRows[0]).toMatchObject({ refType: "specimen", refId: String(ID) });
    expect(compoundIndexUsed).toBe("[refType+refId]");
  });

  it("3. legacy: the pre-§9.3 localStorage blob", async () => {
    lsStore.set(specimenPhotoKey(ID), LEGACY_BLOB);
    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({
      url: LEGACY_BLOB,
      source: SPECIMEN_PHOTO_SOURCE.LEGACY_LOCAL_STORAGE,
    });
  });

  it("4. none: nothing anywhere resolves to absent, not to a placeholder", async () => {
    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({ url: null, source: SPECIMEN_PHOTO_SOURCE.NONE });
    // The whole point of the "never fabricate" rule: no URL, no empty string that a
    // caller could pass to an <img src>, nothing that renders as a photo of this fish.
    expect(result.url).toBeNull();
  });

  it("4. none: a missing id is absent rather than a lookup for `undefined`", async () => {
    for (const missing of [null, undefined, ""]) {
      expect(await resolveSpecimenPhoto(missing)).toEqual({
        url: null,
        source: SPECIMEN_PHOTO_SOURCE.NONE,
      });
    }
    expect(mediaRows).toHaveLength(0);
  });
});

describe("precedence — the order between the steps", () => {
  it("prefers hosted over both local copies, because it is the one that travels", async () => {
    await putSpecimenPhoto(ID, DEXIE_BLOB);
    lsStore.set(specimenPhotoKey(ID), LEGACY_BLOB);
    recordHostedSpecimenPhotoUrl(ID, HOSTED);

    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({ url: HOSTED, source: SPECIMEN_PHOTO_SOURCE.HOSTED });
  });

  it("prefers an explicitly supplied hosted URL over a stale recorded one", async () => {
    recordHostedSpecimenPhotoUrl(ID, HOSTED);
    const fresher = `${HOSTED}?v=2`;
    const result = await resolveSpecimenPhoto(ID, { hostedUrl: fresher });
    expect(result).toEqual({ url: fresher, source: SPECIMEN_PHOTO_SOURCE.HOSTED });
  });

  it("prefers Dexie over the legacy blob when both exist", async () => {
    lsStore.set(specimenPhotoKey(ID), LEGACY_BLOB);
    mediaRows.push({ id: nextMediaId++, refType: "specimen", refId: String(ID), dataUrl: DEXIE_BLOB });

    const result = await resolveSpecimenPhoto(ID);
    expect(result).toEqual({ url: DEXIE_BLOB, source: SPECIMEN_PHOTO_SOURCE.LOCAL });
  });

  it("reports `local` even though the mirror also wrote the legacy key", async () => {
    // MIRROR_LS is deliberately still on. A write therefore lands in BOTH places, and
    // the source must name the durable one — otherwise the mirror would make every
    // photo look like a legacy leftover.
    await putSpecimenPhoto(ID, DEXIE_BLOB);
    expect(lsStore.get(specimenPhotoKey(ID))).toBe(DEXIE_BLOB);

    const result = await resolveSpecimenPhoto(ID);
    expect(result.source).toBe(SPECIMEN_PHOTO_SOURCE.LOCAL);
  });

  it("does not resolve one specimen's photo for another", async () => {
    await putSpecimenPhoto(ID, DEXIE_BLOB);
    expect(await resolveSpecimenPhoto(ID + 1)).toEqual({
      url: null,
      source: SPECIMEN_PHOTO_SOURCE.NONE,
    });
  });

  it("accepts an inline blob supplied as the recorded copy rather than blanking it", async () => {
    // Listings written before the bucket upload path landed carry a base64 `photoUrl`.
    // It is not a CDN URL, but it is a real photo a remote buyer can see today, so it
    // resolves rather than falling through to nothing.
    const result = await resolveSpecimenPhoto(ID, { hostedUrl: LEGACY_BLOB });
    expect(result.url).toBe(LEGACY_BLOB);
  });
});

describe("deletion", () => {
  it("stops resolving once the durable row, the mirror and the hosted record are gone", async () => {
    await putSpecimenPhoto(ID, DEXIE_BLOB);
    recordHostedSpecimenPhotoUrl(ID, HOSTED);

    await deleteSpecimenPhoto(ID);
    clearHostedSpecimenPhotoUrl(ID);

    expect(mediaRows).toHaveLength(0);
    expect(lsStore.get(specimenPhotoKey(ID))).toBeUndefined();
    expect(readHostedSpecimenPhotoUrl(ID)).toBeNull();
    expect(await resolveSpecimenPhoto(ID)).toEqual({
      url: null,
      source: SPECIMEN_PHOTO_SOURCE.NONE,
    });
  });

  it("would otherwise keep serving a photo the keeper deleted", async () => {
    // Guards the trap this migration introduces: the hosted URL lives in its own key,
    // so deleting the image without clearing that key leaves the photo resolvable.
    recordHostedSpecimenPhotoUrl(ID, HOSTED);
    await deleteSpecimenPhoto(ID);
    expect((await resolveSpecimenPhoto(ID)).source).toBe(SPECIMEN_PHOTO_SOURCE.HOSTED);
  });
});

describe("source guards", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const MEDIA = code("../services/tankMedia.js");
  const READERS = {
    "BreedGallery.jsx": code("../components/BreedGallery.jsx"),
    "EditListingModal.jsx": code("../components/EditListingModal.jsx"),
    "ListSpecimenModal.jsx": code("../components/ListSpecimenModal.jsx"),
    "MarketplaceBoard.jsx": code("../components/MarketplaceBoard.jsx"),
    "SpecimenDetailModal.jsx": code("../components/SpecimenDetailModal.jsx"),
    "TankList.jsx": code("../components/TankList.jsx"),
    "cloudSync.js": code("../services/cloudSync.js"),
  };
  const RELAYER = code("../services/relayer.js");

  /** A raw specimen-photo key built from an id — the pattern being retired. */
  const RAW_KEY = /aquadex_specimen_photo_(url_)?\$\{/;

  it("strips comments, or every absence below is vacuous", () => {
    // Each of these phrases exists ONLY inside an explanatory comment in that file,
    // several of which name the very key/call the guards assert is gone.
    expect(READERS["SpecimenDetailModal.jsx"]).not.toContain("raw `localStorage.getItem`");
    expect(READERS["MarketplaceBoard.jsx"]).not.toContain("no longer a separate");
    expect(READERS["TankList.jsx"]).not.toContain("ad-hoc");
    expect(RELAYER).not.toContain("This was a raw localStorage write");
    // And the stripper did not eat the code.
    expect(MEDIA).toContain("export async function resolveSpecimenPhoto");
  });

  it("routes all seven readers through the resolver and leaves no raw key read", () => {
    for (const [name, src] of Object.entries(READERS)) {
      expect(src, `${name}: raw key`).not.toMatch(RAW_KEY);
      expect(src, `${name}: resolver`).toContain("resolveSpecimenPhoto");
      expect(src, `${name}: import`).toMatch(/from "(\.\.\/services|\.)\/tankMedia"/);
    }
    // Paired positives: each site's actual call, so a file that merely deleted its
    // read cannot pass.
    expect(READERS["BreedGallery.jsx"]).toContain("resolveSpecimenPhoto(s.specimenId)");
    expect(READERS["EditListingModal.jsx"]).toContain("resolveSpecimenPhoto(item.tokenId");
    expect(READERS["ListSpecimenModal.jsx"]).toContain("resolveSpecimenPhoto(specimenInfo.id)");
    expect(READERS["MarketplaceBoard.jsx"]).toContain("resolveSpecimenPhoto(l.tokenId");
    expect(READERS["SpecimenDetailModal.jsx"]).toContain("resolveSpecimenPhoto(activeId)");
    expect(READERS["TankList.jsx"]).toContain("resolveSpecimenPhoto(s.id)");
    expect(READERS["cloudSync.js"]).toContain("resolveSpecimenPhoto(listing.tokenId");
  });

  it("keeps the synchronous render paths synchronous by resolving into state", () => {
    // These three read inside a render body, so the resolver call has to live in an
    // effect. A render function turned `async` would return a Promise and render
    // nothing at all.
    for (const name of ["BreedGallery.jsx", "MarketplaceBoard.jsx", "SpecimenDetailModal.jsx"]) {
      expect(READERS[name], `${name}: state`).toMatch(/useState\(/);
      expect(READERS[name], `${name}: effect`).toMatch(/useEffect\(\(\) => \{/);
    }
    expect(READERS["BreedGallery.jsx"]).toContain("setSpecimenPhotos(");
    expect(READERS["MarketplaceBoard.jsx"]).toContain("setResolvedCardPhotos(");
    expect(READERS["SpecimenDetailModal.jsx"]).toContain("setCustomPhoto(");
  });

  it("keeps the existing placeholder fallbacks, so absent still renders as absent", () => {
    // The resolver returning null must land on the silhouette / master species image
    // that was already there, not on a substitute photo.
    expect(READERS["BreedGallery.jsx"]).toContain("const finalImgSrc = customPhoto || masterPhotoUrl");
    expect(READERS["SpecimenDetailModal.jsx"]).toContain("const finalImgSrc = customPhoto || masterPhotoUrl");
    expect(READERS["MarketplaceBoard.jsx"]).toContain("allPhotos.length > 0");
    for (const name of ["BreedGallery.jsx", "MarketplaceBoard.jsx", "SpecimenDetailModal.jsx"]) {
      expect(READERS[name], `${name}: silhouette`).toContain("SilhouetteSVG");
    }
  });

  it("sends both writers through putSpecimenPhoto instead of setItem", () => {
    expect(RELAYER).not.toMatch(RAW_KEY);
    expect(RELAYER).toContain("putSpecimenPhoto(Number(tokenId), photoDataUrl)");
    expect(RELAYER).toContain('from "./tankMedia"');

    const EDIT = READERS["EditListingModal.jsx"];
    expect(EDIT).not.toContain("localStorage.setItem(`aquadex_specimen_photo_");
    expect(EDIT).toContain("putSpecimenPhoto(tokenId, tempPhotos[0])");
    // Deleting has to clear the hosted record too (see the deletion tests above).
    expect(EDIT).toContain("deleteSpecimenPhoto(tokenId)");
    expect(EDIT).toContain("clearHostedSpecimenPhotoUrl(tokenId)");
    // The upload's public URL is still recorded — just through the one key helper.
    expect(EDIT).toContain("recordHostedSpecimenPhotoUrl(tokenId, result.url)");
  });

  it("leaves the localStorage mirror ON, with the reason recorded", () => {
    // Flipping reads and the mirror in the same release makes a rollback lose every
    // photo written during it. The mirror goes in the NEXT release.
    expect(MEDIA).toContain("const MIRROR_LS = true");

    const raw = readFileSync(
      fileURLToPath(new URL("../services/tankMedia.js", import.meta.url)),
      "utf8"
    );
    expect(raw).toMatch(/reversible/i);
    expect(raw).toMatch(/FOLLOW-UP/);
  });

  it("creates no bucket, migration or Dexie version bump — all of it already exists", () => {
    expect(MEDIA).not.toContain("createBucket");
    expect(MEDIA).not.toMatch(/\.version\(/);
    expect(MEDIA).not.toContain("supabase");
    // The upload path it defers to is the pre-existing one.
    expect(code("../services/photoUpload.js")).toContain('const BUCKET = "specimen-photos"');
  });
});
