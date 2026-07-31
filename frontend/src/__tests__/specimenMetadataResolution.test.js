/**
 * Reading a certificate's document back (§9.14).
 *
 * THE GAP: `SpecimenDetailModal` read `localStorage.getItem('aquadex_specimen_metadata_<id>')`
 * directly. A raw key, device-local, lost on a cache clear — and invisible to a buyer
 * who received the certificate on another device, which is the case the whole pedigree
 * stream exists to serve. Meanwhile the document already had a durable home: §9.9/§9.19
 * publish it to the `specimen-metadata` bucket and record the URL on
 * `specimens.ipfsMetadataUri`.
 *
 * Two things are asserted, and the second is the one that would not occur to a reviewer:
 *
 *   1. Precedence is hosted → local cache → none, each REPORTED rather than blended, so
 *      the UI can say which copy it got instead of implying they are equivalent.
 *   2. A breeder-supplied (`external`) URI is reported and **never fetched**. Following
 *      it would send the viewer's IP and headers to a server the SELLER controls, every
 *      time a buyer opened the certificate — a tracking side-channel handed to the
 *      counterparty, on the exact surface where somebody decides whether to trust them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({
          data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/specimen-metadata/${path}` },
        }),
      }),
    },
  },
}));

const {
  METADATA_SOURCE,
  METADATA_STATUS,
  localMetadataKey,
  resolveSpecimenMetadata,
} = await import("../services/specimenMetadata");

const ID = 77;
const HOSTED_URI =
  "https://proj.supabase.co/storage/v1/object/public/specimen-metadata/0xaaaa/77.json";
const HOSTED_DOC = { name: "Neon Tetra", description: "hosted copy", attributes: [] };
const CACHED_DOC = { name: "Neon Tetra", description: "local copy", attributes: [] };

const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
  get length() { return lsStore.size; },
};

/** A fetch that records every URL it was asked for. */
function trackingFetch(result) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (result instanceof Error) throw result;
    return result;
  };
  impl.calls = calls;
  return impl;
}

const okJson = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  lsStore.clear();
});

describe("precedence", () => {
  it("prefers the HOSTED document — the only copy a buyer's device can see", async () => {
    lsStore.set(localMetadataKey(ID), JSON.stringify(CACHED_DOC));
    const fetchImpl = trackingFetch(okJson(HOSTED_DOC));

    const result = await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: HOSTED_URI,
      metadataStatus: METADATA_STATUS.PUBLISHED,
      fetchImpl,
    });

    expect(result).toEqual({ document: HOSTED_DOC, source: METADATA_SOURCE.HOSTED, uri: HOSTED_URI });
    expect(fetchImpl.calls).toEqual([HOSTED_URI]);
  });

  it("falls back to the local cache when the hosted fetch fails", async () => {
    // Offline, still uploading (`pending`), or a failed publish. The local copy is the
    // honest next-best, not an error.
    lsStore.set(localMetadataKey(ID), JSON.stringify(CACHED_DOC));
    const result = await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: HOSTED_URI,
      metadataStatus: METADATA_STATUS.PUBLISHED,
      fetchImpl: trackingFetch(new Error("offline")),
    });
    expect(result).toMatchObject({ document: CACHED_DOC, source: METADATA_SOURCE.LOCAL_CACHE });
  });

  it("falls back on a non-ok response too, not just a thrown one", async () => {
    lsStore.set(localMetadataKey(ID), JSON.stringify(CACHED_DOC));
    const result = await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: HOSTED_URI,
      metadataStatus: METADATA_STATUS.PUBLISHED,
      fetchImpl: trackingFetch({ ok: false, json: async () => ({}) }),
    });
    expect(result.source).toBe(METADATA_SOURCE.LOCAL_CACHE);
  });

  it("uses the local cache for a certificate minted before documents were published", async () => {
    lsStore.set(localMetadataKey(ID), JSON.stringify(CACHED_DOC));
    const fetchImpl = trackingFetch(okJson(HOSTED_DOC));
    const result = await resolveSpecimenMetadata({ specimenId: ID, fetchImpl });
    expect(result).toEqual({ document: CACHED_DOC, source: METADATA_SOURCE.LOCAL_CACHE, uri: null });
    // No URI, so nothing was fetched at all.
    expect(fetchImpl.calls).toEqual([]);
  });

  it("reports NONE when there is no document anywhere, rather than an empty one", async () => {
    const result = await resolveSpecimenMetadata({ specimenId: ID });
    expect(result).toEqual({ document: null, source: METADATA_SOURCE.NONE, uri: null });
    // The caller must render this as absent. An `{}` here would render as a
    // certificate with blank fields, which reads as data.
    expect(result.document).toBeNull();
  });

  it("treats a corrupt cache entry as no document rather than throwing", async () => {
    lsStore.set(localMetadataKey(ID), "{not json");
    const result = await resolveSpecimenMetadata({ specimenId: ID });
    expect(result.source).toBe(METADATA_SOURCE.NONE);
  });
});

describe("a breeder-supplied URI is reported, never followed", () => {
  it("does NOT fetch an external URI", async () => {
    const fetchImpl = trackingFetch(okJson({ evil: true }));
    const result = await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: "https://breeder.example/mydoc.json",
      metadataStatus: METADATA_STATUS.EXTERNAL,
      fetchImpl,
    });

    expect(fetchImpl.calls).toEqual([]);
    expect(result.document).toBeNull();
    expect(result.source).toBe(METADATA_SOURCE.EXTERNAL);
    // The URI still travels, so the UI can offer it as a link the reader chooses.
    expect(result.uri).toBe("https://breeder.example/mydoc.json");
  });

  it("does not fetch a foreign URL even if the status claims it is published", async () => {
    // Defence in depth: the decision is made on the URL, not only on a status field
    // that a stale local row could get wrong.
    const fetchImpl = trackingFetch(okJson({ evil: true }));
    const result = await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: "https://breeder.example/mydoc.json",
      metadataStatus: METADATA_STATUS.PUBLISHED,
      fetchImpl,
    });
    expect(fetchImpl.calls).toEqual([]);
    expect(result.document).toBeNull();
  });

  it("only fetches URLs inside our own bucket", async () => {
    // A lookalike host must not pass. The check is on the bucket path segment.
    const fetchImpl = trackingFetch(okJson(HOSTED_DOC));
    await resolveSpecimenMetadata({
      specimenId: ID,
      metadataUri: "https://evil.example/storage/v1/object/public/other-bucket/0xaaaa/77.json",
      metadataStatus: METADATA_STATUS.PUBLISHED,
      fetchImpl,
    });
    expect(fetchImpl.calls).toEqual([]);
  });
});

describe("source guards", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const MODAL = code("../components/SpecimenDetailModal.jsx");
  const SERVICE = code("../services/specimenMetadata.js");

  it("strips comments, or the absence below is vacuous", () => {
    // This phrase exists only inside the modal's explanatory comment, which names the
    // very call being guarded against.
    expect(MODAL).not.toContain("used to read `localStorage` directly");
    expect(MODAL).toContain("resolveSpecimenMetadata(");
  });

  it("the modal no longer reads the metadata key itself", () => {
    expect(MODAL).not.toContain("aquadex_specimen_metadata_");
    expect(MODAL).toContain("setMetadataSource(");
    expect(MODAL).toContain("setMetadataUri(");
  });

  it("the modal says which copy it got instead of blending them", () => {
    expect(MODAL).toContain("METADATA_SOURCE.LOCAL_CACHE");
    expect(MODAL).toContain("METADATA_SOURCE.EXTERNAL");
  });

  it("an offered external link cannot leak the referrer or pass trust", () => {
    const idx = MODAL.indexOf("Breeder-hosted document");
    expect(idx).toBeGreaterThan(-1);
    const block = MODAL.slice(idx, idx + 900);
    expect(block).toContain('rel="noopener noreferrer nofollow"');
    expect(block).toContain('target="_blank"');
  });

  it("the resolver reaches the network only through an injectable fetch", () => {
    // So this file can prove the external case is not fetched.
    expect(SERVICE).toContain("fetchImpl");
    expect(SERVICE).toContain("isOwnHostedUri");
  });
});
