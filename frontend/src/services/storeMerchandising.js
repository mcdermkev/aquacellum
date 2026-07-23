/**
 * storeMerchandising.js
 *
 * Storefront merchandising (Task 21A, Tier B): featured collections and
 * customizable store sections. Pure, deterministic, no network — mirrors
 * the addOnPresenter.js/buyerOrderView.js precedent of pushing all
 * presentation logic into a tested module and keeping React/the public
 * page thin.
 *
 * A "section" is a seller-authored, ordered slice of their own storefront:
 * a featured highlight, a named collection, or a custom grouping. Sections
 * never change the listing source of truth — they only arrange references
 * to it (docs/TASK_21A_MERCHANDISING_SPEC.md §3).
 *
 * `listing_refs` are stored as `getListingKey()` values (catalogQuery.js) —
 * e.g. "batch-12" / "single-45" — not raw numeric ids, so a batch and a
 * single listing that happen to share a numeric id can never collide. This
 * module resolves refs against a live listing array via that exact key and
 * activity rule, reusing catalogQuery.js rather than re-deriving either.
 */

import { getListingKey, isListingActive } from "./catalogQuery.js";

// ─── Shape ───────────────────────────────────────────────────────────────────

export const SECTION_TYPES = Object.freeze({
  FEATURED: "featured",
  COLLECTION: "collection",
  CUSTOM: "custom",
});

// Synthetic type for the catch-all "everything not already placed" section
// assembleStorefrontLayout appends. Never persisted — a section row's own
// `type` is always one of SECTION_TYPES above.
export const ALL_LISTINGS_SECTION_TYPE = "all";

const SECTION_TYPE_VALUES = Object.freeze(Object.values(SECTION_TYPES));

export const MAX_SECTIONS = 20;
export const MAX_TITLE_LENGTH = 60;
export const MAX_LISTING_REFS = 100;

// ─── Web2-safe copy (Task 2 language system) ───────────────────────────────
// Every string here is covered by the PROHIBITED_TERMS invariant test in
// storeMerchandising.test.js, matching orderCopy.js's own invariant.

export const SECTION_COPY = Object.freeze({
  addSection: "Add a section",
  addFeatured: "Feature specific listings",
  addCollection: "Create a named collection",
  emptyState: "No sections yet — buyers will see your full catalog until you add one.",
  allListingsTitle: "All listings",
  visibleLabel: "Visible on your store",
  hiddenLabel: "Hidden from your store",
  moveUp: "Move section up",
  moveDown: "Move section down",
  removeSection: "Remove this section",
  saved: "Storefront layout saved.",
  saveFailed: "Could not save your storefront layout. Try again.",
  previewTitle: "Live preview",
});

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize a section row (snake_case DB row or camelCase client draft) into
 * one canonical camelCase shape.
 * @param {Object} row
 * @returns {{id:(string|null), walletAddress:(string|null), type:string, title:string, listingRefs:string[], sortOrder:number, visible:boolean, createdAt:*, updatedAt:*}}
 */
export function normalizeSection(row = {}) {
  const wallet = row.wallet_address ?? row.walletAddress ?? null;
  const refsRaw = row.listing_refs ?? row.listingRefs;
  const sortRaw = row.sort_order ?? row.sortOrder;

  return {
    id: row.id ?? null,
    walletAddress: wallet ? String(wallet).toLowerCase() : null,
    type: SECTION_TYPE_VALUES.includes(row.type) ? row.type : SECTION_TYPES.COLLECTION,
    title: typeof row.title === "string" ? row.title : "",
    listingRefs: Array.isArray(refsRaw) ? refsRaw.filter((r) => typeof r === "string") : [],
    sortOrder: Number.isFinite(Number(sortRaw)) ? Number(sortRaw) : 0,
    visible: row.visible !== false,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a single section draft (the shape the editor and the server's
 * write path both check). Does not mutate; the caller normalizes separately.
 * @param {Object} draft
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validateSectionDraft(draft = {}) {
  if (!draft || typeof draft !== "object") {
    return { ok: false, error: "section must be an object" };
  }

  if (!SECTION_TYPE_VALUES.includes(draft.type)) {
    return { ok: false, error: `type must be one of: ${SECTION_TYPE_VALUES.join(", ")}` };
  }

  const title = draft.title;
  if (title != null && typeof title !== "string") {
    return { ok: false, error: "title must be a string" };
  }
  if (typeof title === "string" && title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` };
  }

  const refs = draft.listingRefs ?? draft.listing_refs;
  if (refs != null) {
    if (!Array.isArray(refs)) {
      return { ok: false, error: "listingRefs must be an array" };
    }
    if (refs.length > MAX_LISTING_REFS) {
      return { ok: false, error: `listingRefs must be ${MAX_LISTING_REFS} or fewer` };
    }
    if (!refs.every((r) => typeof r === "string")) {
      return { ok: false, error: "listingRefs must contain only strings" };
    }
  }

  return { ok: true, error: null };
}

/**
 * Validate a full sections payload (the array a seller submits in one save).
 * @param {Object[]} sections
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validateSectionsPayload(sections) {
  if (!Array.isArray(sections)) {
    return { ok: false, error: "sections must be an array" };
  }
  if (sections.length > MAX_SECTIONS) {
    return { ok: false, error: `at most ${MAX_SECTIONS} sections are allowed` };
  }
  for (const draft of sections) {
    const result = validateSectionDraft(draft);
    if (!result.ok) return result;
  }
  return { ok: true, error: null };
}

// ─── Layout assembly ─────────────────────────────────────────────────────────

function compareSections(a, b) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const ka = String(a.id ?? "");
  const kb = String(b.id ?? "");
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Produce the renderable storefront layout: featured sections first, then
 * collections/custom sections (by sort_order), then a catch-all "All
 * listings" section of everything not already placed. Each section resolves
 * its `listingRefs` against the live `listings` array (via getListingKey),
 * drops inactive/missing listings (isListingActive), and drops now-empty
 * sections entirely. Deterministic for identical inputs; never mutates
 * `listings` or `sections` and never changes what's active/for sale — this
 * is presentation-only arrangement of the existing listing source of truth.
 *
 * @param {Object} profile - the breeder profile (reserved for future
 *   profile-driven layout rules; not currently read)
 * @param {Object[]} [listings] - the live listing set (any shape
 *   getListingKey/isListingActive understand)
 * @param {Object[]} [sections] - section rows/drafts (snake_case or camelCase)
 * @returns {{id:string, type:string, title:string, listings:Object[]}[]}
 */
export function assembleStorefrontLayout(profile, listings = [], sections = []) {
  const activeByKey = new Map();
  for (const item of listings || []) {
    if (!isListingActive(item)) continue;
    activeByKey.set(getListingKey(item), item);
  }

  const normalizedSections = (sections || [])
    .map(normalizeSection)
    .filter((s) => s.visible)
    .sort(compareSections);

  const placedKeys = new Set();
  const featured = [];
  const rest = [];

  for (const section of normalizedSections) {
    const resolved = [];
    for (const ref of section.listingRefs) {
      const item = activeByKey.get(ref);
      if (!item) continue; // dropped: inactive or missing
      resolved.push(item);
      placedKeys.add(getListingKey(item));
    }
    if (resolved.length === 0) continue; // drop now-empty sections

    const out = { id: section.id, type: section.type, title: section.title, listings: resolved };
    if (section.type === SECTION_TYPES.FEATURED) featured.push(out);
    else rest.push(out);
  }

  const remaining = [];
  for (const item of listings || []) {
    if (!isListingActive(item)) continue;
    if (placedKeys.has(getListingKey(item))) continue;
    remaining.push(item);
  }

  const ordered = [...featured, ...rest];
  if (remaining.length > 0) {
    ordered.push({
      id: "all-listings",
      type: ALL_LISTINGS_SECTION_TYPE,
      title: SECTION_COPY.allListingsTitle,
      listings: remaining,
    });
  }

  return ordered;
}
