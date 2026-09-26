/**
 * listingCardPhoto.js — the photo a BATCH listing card shows.
 *
 * Singles resolve through `resolveSpecimenPhoto` (services/tankMedia.js), keyed by
 * specimen id. A batch has no specimen record, so the only copy that travels with
 * it is the listing's own `photoUrl` (or `imageUrl` from older writers). Returning
 * null means "no photo of this listing" and the caller shows the species image —
 * nothing is substituted.
 *
 * Accepts only URLs an <img> should load: https:, same-origin root-relative paths,
 * and inline data:image/ blobs (legacy listings). Anything else is ignored.
 */

const SAFE = /^(https:\/\/|\/(?!\/)|data:image\/)/i;

/**
 * @param {{ photoUrl?: unknown, imageUrl?: unknown } | null | undefined} listing
 * @returns {string|null}
 */
export function batchCardPhoto(listing) {
  for (const candidate of [listing?.photoUrl, listing?.imageUrl]) {
    if (typeof candidate !== "string") continue;
    const url = candidate.trim();
    if (url && SAFE.test(url)) return url;
  }
  return null;
}
