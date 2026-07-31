/**
 * specimenMetadata.js — the specimen metadata document, and the one gate on what
 * may be written to a certificate's on-chain metadata URI.
 *
 * Closes docs/BREEDER_STATE_MODEL.md §9.9.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * `AquadexManager.tokenURI(tokenId)` returns `specimens[tokenId].ipfsMetadataUri`
 * **verbatim**. That is the ERC-721 metadata entry point — the value any external
 * wallet, explorer, or marketplace reads to describe the certificate. Whatever
 * goes in that field IS the token's public metadata claim, and it is also emitted
 * in the `SpecimenRegistered` event.
 *
 * What was being written:
 *
 *   - Register:  "ipfs://bafybeidflm24zspeciemensample/meta.json" — a hardcoded
 *                form default, IDENTICAL on every specimen ever registered.
 *   - Spawning:  "ipfs://bafkreispawnlogscompiledmetadata" + Math.random()… — a
 *                CID invented at submit time.
 *
 * Neither is a real content identifier. Both are the wrong length for a CIDv1
 * (59+ chars; these are 29 and ~37), nothing was ever pinned, and both resolve
 * to nothing. So every certificate carried a confident, permanent, on-chain
 * pointer to a document that does not exist — and paid gas for the bytes.
 *
 * THE RULE: an empty URI is honest; a fabricated one is not. `tokenURI` returning
 * "" is a well-understood "no metadata published" signal that viewers handle.
 * A dead ipfs:// link is an assertion that turns out to be false.
 *
 * WHERE THE DOCUMENT LIVES (§9.19, resolved as option c): the existing PUBLIC
 * Supabase Storage project, not IPFS. Chosen over Pinata — which is this
 * project's IPFS provider for seeding but has no credentials provisioned for the
 * app — because it needs no new provider, reuses the storage already serving
 * specimen photos, and makes `tokenURI` resolve today. The tradeoff is stated
 * plainly: this is centralized and mutable, so it is provenance *hosting*, not
 * provenance *proof*. Switching to IPFS later changes only which URI
 * `publicMetadataUri` returns; nothing else moves.
 *
 * And the publish stays OFF the critical path — see the note above
 * `publicMetadataUri` for why that's possible without guessing.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient";

// The honest "no metadata document published" value. `tokenURI` returns this
// as-is and viewers treat it as absent, which is the truth.
export const METADATA_URI_NONE = "";

/**
 * URIs that were previously fabricated by the app. Kept as an explicit denylist
 * so they can never come back via stale form state, a copied value, or a
 * well-meaning "restore the default" change.
 */
export const FABRICATED_URI_MARKERS = Object.freeze([
  "bafybeidflm24zspeciemensample",
  "bafkreispawnlogscompiledmetadata",
]);

/**
 * Is this a plausibly-real IPFS content identifier?
 *
 * Not a full multihash validation — a shape and length check, which is enough to
 * reject hand-written placeholders. Real identifiers are fixed-length:
 *   - v0: "Qm" + 44 base58 chars  (46 total)
 *   - v1: "b"  + 58+ base32 chars (59+ total, lowercase)
 *
 * Both previously-fabricated values fail on length alone.
 */
export function isPlausibleCid(cid) {
  if (typeof cid !== "string") return false;
  const value = cid.trim();
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) return true;
  if (/^b[a-z2-7]{58,}$/.test(value)) return true;
  return false;
}

/**
 * Validate a metadata URI for on-chain publication.
 *
 * @param {string|null|undefined} value
 * @returns {{ ok: boolean, uri: string, error: string|null }}
 *   `ok` is true for both a valid URI and a deliberately empty one — empty is a
 *   legitimate answer, not a failure. `uri` is always safe to write.
 */
export function validateMetadataUri(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: true, uri: METADATA_URI_NONE, error: null };

  const lower = raw.toLowerCase();

  if (FABRICATED_URI_MARKERS.some((marker) => lower.includes(marker))) {
    return {
      ok: false,
      uri: METADATA_URI_NONE,
      error: "That's a placeholder from an older version, not a real document. Leave it blank unless you have a pinned file.",
    };
  }

  if (lower.startsWith("ipfs://")) {
    // Strip the scheme, then take the CID (an optional /path may follow).
    const [cid] = raw.slice("ipfs://".length).split("/");
    if (!isPlausibleCid(cid)) {
      return {
        ok: false,
        uri: METADATA_URI_NONE,
        error: "That doesn't look like a complete IPFS content identifier. Leave it blank unless you have a pinned file.",
      };
    }
    return { ok: true, uri: raw, error: null };
  }

  if (lower.startsWith("https://")) {
    try {
      const parsed = new URL(raw);
      if (!parsed.hostname) throw new Error("no host");
      return { ok: true, uri: raw, error: null };
    } catch {
      return { ok: false, uri: METADATA_URI_NONE, error: "That isn't a valid web address." };
    }
  }

  return {
    ok: false,
    uri: METADATA_URI_NONE,
    error: "Use an ipfs:// or https:// address, or leave it blank.",
  };
}

/**
 * Coerce a value to something safe to publish. Invalid input becomes empty
 * rather than being written through — fail to "no claim", never to a false one.
 */
export function normalizeMetadataUri(value) {
  return validateMetadataUri(value).uri;
}

/**
 * Build the specimen metadata document.
 *
 * One builder replacing two hand-rolled shapes (the Register form's and the
 * Spawning wizard's `mockMetadata`). Shape is ERC-721-conventional
 * `{ name, description, attributes: [{ trait_type, value }] }`, and the existing
 * readers stay compatible:
 *   - `SpecimenDetailModal` renders `attributes` generically, skipping
 *     Sire ID / Dam ID / Containment Tank ID (which it shows itself).
 *   - `utils/pdfExport.js` filters attributes whose `trait_type` starts with
 *     "Snapped" for the water-parameters block — so that prefix is a contract.
 *
 * Every value is stringified: mixed types in this array previously made the
 * consumers defensive for no reason.
 *
 * @returns {{ name: string, description: string, attributes: Array<{trait_type: string, value: string}> }}
 */
export function buildSpecimenMetadata({
  commonName = "Specimen",
  speciesId = null,
  sireId = 0,
  damId = 0,
  tankId = 0,
  registrationDate = null,
  sex = null,
  breederStockTag = "",
  name = null,
  description = null,
  extraAttributes = [],
} = {}) {
  const attributes = [
    { trait_type: "Sire ID", value: refValue(sireId) },
    { trait_type: "Dam ID", value: refValue(damId) },
    { trait_type: "Containment Tank ID", value: refValue(tankId) },
    {
      trait_type: "Registration Date",
      value: registrationDate || new Date().toLocaleDateString(),
    },
  ];

  if (sex) attributes.push({ trait_type: "Sex", value: String(sex) });
  if (breederStockTag) {
    attributes.push({ trait_type: "Breeder Stock Tag", value: String(breederStockTag) });
  }

  for (const attr of Array.isArray(extraAttributes) ? extraAttributes : []) {
    if (!attr || !attr.trait_type) continue;
    attributes.push({ trait_type: String(attr.trait_type), value: String(attr.value ?? "") });
  }

  return {
    name: name || `${commonName} Specimen`,
    description:
      description ||
      `Registered birth certificate${speciesId != null ? ` — species ${speciesId}` : ""}.`,
    attributes,
  };
}

/** "None" for an absent reference, so a 0 never reads as certificate #0. */
function refValue(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? String(n) : "None";
}

// ─── Publishing (§9.19, option c) ───────────────────────────────────────────
//
// The document is served from the existing PUBLIC Supabase Storage project
// rather than pinned to IPFS. Chosen deliberately over Pinata: it needs no new
// provider or credential, it's the same storage already serving specimen photos,
// and it makes `tokenURI` actually resolve today. The tradeoff is honest — this
// is centralized and mutable, not content-addressed, so it is provenance
// *hosting*, not provenance *proof*. Moving to IPFS later only changes which URI
// this module returns.
//
// WHY THIS CAN BE NON-BLOCKING: the bucket is public and the object path is
// deterministic, so `getPublicUrl` is a pure string operation — no network call.
// The final URL is therefore knowable BEFORE the upload happens, which lets the
// certificate write stay local-first and fire-and-forget (its defining property)
// while still putting a correct, resolvable URI on-chain.

export const METADATA_BUCKET = "specimen-metadata";

/**
 * Deterministic object path. The owner prefix is required for uniqueness —
 * serials are per-device sequential, so two breeders both have specimen #1 — and
 * it is what the storage policy checks for write ownership.
 *
 * No timestamp or hash in the path: this URL goes on-chain permanently, so it
 * must be stable and re-derivable for a retry.
 */
export function metadataObjectPath(ownerAddress, specimenId) {
  const owner = String(ownerAddress || "").toLowerCase();
  return `${owner}/${Number(specimenId)}.json`;
}

/**
 * The public URL the document WILL live at, computed without a network call.
 *
 * Returns empty when storage isn't configured — critical, because
 * `supabaseClient` falls back to a `placeholder.supabase.co` URL and writing
 * that on-chain would be exactly the fabricated-pointer bug this module exists
 * to prevent.
 */
export function publicMetadataUri(ownerAddress, specimenId) {
  if (!isSupabaseConfigured()) return METADATA_URI_NONE;
  if (!ownerAddress || !Number.isFinite(Number(specimenId))) return METADATA_URI_NONE;
  try {
    const { data } = supabase.storage
      .from(METADATA_BUCKET)
      .getPublicUrl(metadataObjectPath(ownerAddress, specimenId));
    const url = data?.publicUrl || "";
    // Run it back through the gate so a misconfigured project can't leak a bad
    // value into the one field that reaches the chain.
    return normalizeMetadataUri(url);
  } catch {
    return METADATA_URI_NONE;
  }
}

/**
 * Upload the document to its deterministic path.
 *
 * `upsert: true` because a retry must be able to re-publish to the same URL —
 * the URI is already committed on-chain, so the path can never move. The storage
 * policy restricts writes to the caller's own wallet prefix, so upsert cannot be
 * used to overwrite another breeder's document.
 *
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function publishSpecimenMetadata({ ownerAddress, specimenId, document }) {
  if (!isSupabaseConfigured()) return { success: false, error: "Storage not configured" };
  if (!ownerAddress || specimenId == null || !document) {
    return { success: false, error: "Missing owner, specimen id, or document" };
  }

  try {
    const path = metadataObjectPath(ownerAddress, specimenId);
    const body = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });

    const { error } = await supabase.storage.from(METADATA_BUCKET).upload(path, body, {
      contentType: "application/json",
      upsert: true,
      cacheControl: "300",
    });

    if (error) {
      if (error.message?.includes("not found") || error.statusCode === 404) {
        return { success: false, error: "Metadata bucket not provisioned" };
      }
      return { success: false, error: error.message || "Upload failed" };
    }

    return { success: true, url: publicMetadataUri(ownerAddress, specimenId) };
  } catch (err) {
    return { success: false, error: err.message || "Upload failed" };
  }
}

/**
 * Re-publish documents whose upload never landed.
 *
 * The URI is already on-chain and the object path is deterministic, so a retry
 * writes to exactly the same URL — there is no drift risk and no need to touch
 * the chain again. Rebuilds the document from the stored local record rather than
 * caching a copy, so a retry can't republish stale content.
 *
 * Called from the login sync pass. Safe to call repeatedly.
 *
 * @param {string} ownerAddress
 * @returns {Promise<{attempted: number, published: number}>}
 */
export async function retryPendingMetadataPublishes(ownerAddress) {
  if (!isSupabaseConfigured() || !ownerAddress) return { attempted: 0, published: 0 };

  const owner = String(ownerAddress).toLowerCase();
  let attempted = 0;
  let published = 0;

  try {
    const { db } = await import("../db");
    const rows = await db.specimens
      .filter((s) =>
        (s.ownerAddress || "").toLowerCase() === owner &&
        (s.metadataStatus === METADATA_STATUS.FAILED || s.metadataStatus === METADATA_STATUS.PENDING)
      )
      .toArray();

    for (const row of rows) {
      attempted += 1;
      const document = buildSpecimenMetadata({
        commonName: row.commonName || "Specimen",
        speciesId: row.speciesId,
        sireId: row.sireId,
        damId: row.damId,
        tankId: row.currentTankId,
        sex: row.gender,
        breederStockTag: row.breederStockTag,
      });
      const res = await publishSpecimenMetadata({
        ownerAddress: owner,
        specimenId: row.id,
        document,
      });
      await db.specimens.update(row.id, {
        metadataStatus: res.success ? METADATA_STATUS.PUBLISHED : METADATA_STATUS.FAILED,
      });
      if (res.success) published += 1;
    }
  } catch (e) {
    console.warn("[SpecimenMetadata] Retry pass failed:", e?.message);
  }

  if (published > 0) {
    console.info(`[SpecimenMetadata] Published ${published}/${attempted} pending documents.`);
  }
  return { attempted, published };
}

// ─── Reading a certificate's document back (§9.14) ──────────────────────────
//
// `SpecimenDetailModal` read `localStorage.getItem('aquadex_specimen_metadata_<id>')`
// directly — a raw key, device-local, lost on a cache clear, and invisible to a buyer
// who received the certificate on another device. Meanwhile the document already has
// a durable home: this module publishes it to the `specimen-metadata` bucket and
// records the URL on `specimens.ipfsMetadataUri`.
//
// So this is the read side of what §9.9/§9.19 built, and the localStorage copy becomes
// a fallback for certificates registered before it existed rather than the source.
//
// ── WHY AN EXTERNAL URI IS NOT FETCHED ──────────────────────────────────────
//
// `METADATA_STATUS.EXTERNAL` means the breeder supplied their own URI and we neither
// host nor manage it. Fetching it here would send the VIEWER's IP and headers to a
// server the *seller* controls, every time a buyer opened the certificate — a
// tracking side-channel handed to the counterparty, on the surface where somebody
// decides whether to trust them. It is also unbounded content of unknown type.
//
// So an external URI is reported, never followed: the caller gets
// `{ source: "external", uri }` and can render a link the reader chooses to click.
// A `null` document with a URI is a real state, not a failure.

/** Where a resolved metadata document came from. Never guessed. */
export const METADATA_SOURCE = Object.freeze({
  /** Fetched from our own bucket at the URI recorded on the certificate. */
  HOSTED: "hosted",
  /** The local pre-§9.9 copy. Honest, but device-scoped. */
  LOCAL_CACHE: "localCache",
  /** A breeder-supplied URI. Reported, deliberately NOT fetched. */
  EXTERNAL: "external",
  /** No document anywhere. */
  NONE: "none",
});

/** The legacy localStorage key. Exported so the migration and tests agree on it. */
export function localMetadataKey(specimenId) {
  return `aquadex_specimen_metadata_${Number(specimenId)}`;
}

/** Is this a URL in the bucket we publish to? Only these are safe to auto-fetch. */
function isOwnHostedUri(uri) {
  if (typeof uri !== "string" || !uri) return false;
  // Deliberately a path check against our own bucket rather than a host allowlist:
  // the project URL varies by environment, but the bucket segment does not.
  return uri.includes(`/storage/v1/object/public/${METADATA_BUCKET}/`);
}

function readLocalCache(specimenId) {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(localMetadataKey(specimenId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    // A corrupt cache entry is not a document. Fall through rather than throwing
    // inside a detail overlay.
    return null;
  }
}

/**
 * Resolve a certificate's metadata document.
 *
 * Precedence, and each step is reported so the UI can say which it got:
 *
 *   1. **Hosted** — fetched from our bucket, when the certificate records a URI we
 *      published. This is the one that works on a device that never minted the fish.
 *   2. **Local cache** — the pre-§9.9 localStorage copy.
 *   3. **External** — reported with its URI, never fetched. See the note above.
 *   4. **None**.
 *
 * Nothing is fabricated: an unreachable hosted document falls through to the local
 * copy, and if that is absent too the result is `{ document: null, source: "none" }` —
 * which the caller must render as absent, not as an empty certificate.
 *
 * @param {object} args
 * @param {number|string} args.specimenId
 * @param {string} [args.metadataUri] - `specimens.ipfsMetadataUri`
 * @param {string} [args.metadataStatus] - a METADATA_STATUS value
 * @param {Function} [args.fetchImpl] - injectable for tests
 * @returns {Promise<{document: object|null, source: string, uri: string|null}>}
 */
export async function resolveSpecimenMetadata({
  specimenId,
  metadataUri = "",
  metadataStatus = METADATA_STATUS.NONE,
  fetchImpl,
} = {}) {
  const uri = normalizeMetadataUri(metadataUri) || null;

  if (uri && metadataStatus === METADATA_STATUS.EXTERNAL) {
    // Reported, not followed.
    return { document: null, source: METADATA_SOURCE.EXTERNAL, uri };
  }

  if (uri && isOwnHostedUri(uri)) {
    const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (doFetch) {
      try {
        const response = await doFetch(uri, { headers: { Accept: "application/json" } });
        if (response?.ok) {
          const document = await response.json();
          if (document && typeof document === "object") {
            return { document, source: METADATA_SOURCE.HOSTED, uri };
          }
        }
      } catch {
        // Offline, still uploading (`PENDING`), or a failed publish. The local copy
        // below is the honest next-best, not an error.
      }
    }
  }

  const cached = readLocalCache(specimenId);
  if (cached) return { document: cached, source: METADATA_SOURCE.LOCAL_CACHE, uri };

  return { document: null, source: METADATA_SOURCE.NONE, uri };
}

/** Lifecycle of a certificate's metadata document. */
export const METADATA_STATUS = Object.freeze({
  /** No document — `tokenURI` is intentionally empty. */
  NONE: "none",
  /** A URI was published on-chain; the document upload hasn't confirmed yet. */
  PENDING: "pending",
  /** Document is live at its URI. */
  PUBLISHED: "published",
  /** Upload failed; retryable — the URI and path are deterministic. */
  FAILED: "failed",
  /** The breeder supplied their own URI; we don't host or manage it. */
  EXTERNAL: "external",
});
