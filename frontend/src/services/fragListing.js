/**
 * fragListing.js — coral frag listings.
 *
 * A frag listing is a quantity-based marketplace listing (`isBatch: true`, same
 * `batch-<id>` route, stock and checkout path as a fry batch) marked with
 * `listingKind: "coral_frag"` and carrying a nested `frag` object in the
 * `aquadex_listings.data` blob. No base-table migration: the blob already holds
 * the whole listing, and the public view projects a reviewed subset of `frag`
 * (20261001_public_view_frag.sql, mirrored by PUBLIC_FRAG_FIELDS below).
 *
 * Everything here is pure so the modal, the board, the detail view and the
 * tests all agree on one shape. Values that come back off the wire are
 * re-cleaned by `fragFromListing`, never trusted as stored.
 */

import { deriveCareFields } from "../utils/speciesCarePrefill.js";
import { PUBLIC_FRAG_DATA_FIELDS } from "./publicListingProjection.js";

export const FRAG_LISTING_KIND = "coral_frag";

/** How the seller measured the frag. Polyps/heads are counts; cm/in are lengths. */
export const FRAG_SIZE_UNITS = Object.freeze(["polyps", "heads", "cm", "in"]);
const COUNT_UNITS = new Set(["polyps", "heads"]);

/** What the frag is attached to. */
export const FRAG_MOUNTS = Object.freeze(["plug", "disc", "rock", "none"]);

/** Where the colony came from. */
export const FRAG_ORIGINS = Object.freeze(["aquacultured", "maricultured", "wild"]);

export const FRAG_SIZE_UNIT_LABELS = Object.freeze({
  polyps: "Polyps",
  heads: "Heads",
  cm: "Centimeters",
  in: "Inches",
});
export const FRAG_MOUNT_LABELS = Object.freeze({
  plug: "Frag plug",
  disc: "Frag disc",
  rock: "Rubble / rock",
  none: "Unmounted",
});
export const FRAG_ORIGIN_LABELS = Object.freeze({
  aquacultured: "Aquacultured (tank-grown)",
  maricultured: "Maricultured (ocean farm)",
  wild: "Wild colony",
});

export const GROWN_UNDER_MAX = 80;
const URL_MAX = 2048;
const SIZE_MAX = 1000;

/**
 * The `frag` subkeys the public view exposes to anonymous readers. Owned by
 * publicListingProjection.js (the public boundary), whose test parses the view
 * migration and fails on drift.
 *
 * `grownUnder` is deliberately NOT public: it is seller free text, withheld for
 * the same reason `description` is (unmoderated for anonymous display). Signed-in
 * buyers read the full blob and still see it.
 */
export const PUBLIC_FRAG_FIELDS = PUBLIC_FRAG_DATA_FIELDS;

/**
 * Per-frag packing profile. Frags travel one per bag in very little water, so the
 * fish defaults (8 cm body, ~13 oz, "ships alone" for unknown temperament) would
 * overstate a box by several times. `perUnit` tells the cart resolvers to scale
 * it by the quantity bought (packingEngine.scalePackingProfile).
 */
export const FRAG_PACKING_PROFILE = Object.freeze({
  perUnit: true,
  bagCount: 1,
  packedWeightOz: 4,
  volumeIn3: 24,
  requiresThermalPack: true,
  maxPerBag: 1,
  separationRequired: false,
  livestock: 1,
});

export function isFragListing(listing) {
  return !!listing && typeof listing === "object" && listing.listingKind === FRAG_LISTING_KIND;
}

/** True for a catalog record a frag can be listed against (corals, incl. anemones). */
export function isFraggableSpecies(record) {
  return !!record && record.type === "coral" && !!record.scientificName;
}

function oneOf(value, allowed) {
  const v = String(value ?? "").trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}

function cleanSize(value, unit) {
  const n = Number(value);
  if (!unit || !Number.isFinite(n) || n <= 0 || n > SIZE_MAX) return null;
  return COUNT_UNITS.has(unit) ? Math.max(1, Math.round(n)) : Math.round(n * 10) / 10;
}

/** An https URL of sane length, else null. Base64 and http never publish. */
export function cleanHttpsUrl(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || s.length > URL_MAX || !/^https:\/\/[^\s]+$/i.test(s)) return null;
  return s;
}

function cleanText(value, max) {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
}

/**
 * Normalize a frag object. Unknown keys are dropped; invalid values become null
 * rather than being guessed at.
 */
export function cleanFrag(input) {
  const src = input && typeof input === "object" ? input : {};
  const sizeUnit = oneOf(src.sizeUnit, FRAG_SIZE_UNITS);
  return {
    sizeValue: cleanSize(src.sizeValue, sizeUnit),
    sizeUnit,
    mount: oneOf(src.mount, FRAG_MOUNTS),
    wysiwyg: src.wysiwyg === true,
    origin: oneOf(src.origin, FRAG_ORIGINS),
    grownUnder: cleanText(src.grownUnder, GROWN_UNDER_MAX),
    motherPhotoUrl: cleanHttpsUrl(src.motherPhotoUrl),
  };
}

/** The cleaned frag of a listing, or null when the listing is not a frag. */
export function fragFromListing(listing) {
  if (!isFragListing(listing)) return null;
  return cleanFrag(listing.frag);
}

/** JS mirror of the view's nested projection: public subkeys only, absent when null. */
export function toPublicFrag(frag) {
  if (!frag || typeof frag !== "object") return null;
  const cleaned = cleanFrag(frag);
  const out = {};
  for (const key of PUBLIC_FRAG_FIELDS) {
    if (cleaned[key] != null) out[key] = cleaned[key];
  }
  return out;
}

/** "3 polyps", "1 head", "2.5 cm", "1 in"; "" when the size is unknown. */
export function fragSizeLabel(frag) {
  const f = cleanFrag(frag);
  if (f.sizeValue == null || !f.sizeUnit) return "";
  if (COUNT_UNITS.has(f.sizeUnit)) {
    const singular = f.sizeUnit === "polyps" ? "polyp" : "head";
    return `${f.sizeValue} ${f.sizeValue === 1 ? singular : f.sizeUnit}`;
  }
  return `${f.sizeValue} ${f.sizeUnit}`;
}

/** What one unit of stock is called on price and quantity labels. */
export function listingUnitLabel(listing) {
  if (isFragListing(listing)) return "frag";
  return listing?.isBatch ? "fish" : "";
}

/** Care fields in the listing's units (°F, gallons), prefilled from the catalog record. */
export function fragCareFromSpecies(record) {
  if (!record?.scientificName) return null;
  const lookup = new Map([[record.scientificName.toLowerCase(), record.tankMetrics || {}]]);
  return deriveCareFields(record.scientificName, lookup);
}

/** Species-level reef care (light/flow/placement…) for display; null when absent. */
export function coralCareFromSpecies(record) {
  const m = record?.marine;
  if (!m || typeof m !== "object") return null;
  const pick = (k) => (typeof m[k] === "string" && m[k].trim() ? m[k].trim() : null);
  const care = {
    coralType: pick("coralType"),
    light: pick("light"),
    flow: pick("flow"),
    placement: pick("placement"),
    aggression: pick("aggression"),
    feeding: pick("feeding"),
  };
  return Object.values(care).some(Boolean) ? care : null;
}

/**
 * Validate the seller's form. Returns an error message, or null when it can list.
 */
export function validateFragForm({ species, priceUsd, quantity, frag } = {}) {
  if (!isFraggableSpecies(species)) return "Pick the coral you're fragging.";
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price <= 0) return "Enter a price per frag.";
  if (price > 100000) return "That price looks off. Check the amount.";
  const f = cleanFrag(frag);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return "Enter how many frags you have.";
  if (qty > 500) return "Up to 500 frags per listing.";
  if (f.wysiwyg && qty !== 1) return "A WYSIWYG listing is one exact frag, so quantity must be 1.";
  if (f.sizeValue == null || !f.sizeUnit) return "Add the frag size.";
  if (!f.mount) return "Pick how the frag is mounted.";
  if (!f.origin) return "Pick where the colony came from.";
  return null;
}

/**
 * Build the listing object the modal saves and syncs. Shape matches a fry batch
 * (BatchListingWizard) so stock, checkout and routing work unchanged.
 *
 * @param {Object} args
 * @param {Object} args.species - the catalog record (type "coral")
 * @param {Object} args.frag - raw frag fields from the form
 * @param {string|number} args.priceUsd
 * @param {number} args.quantity
 * @param {string} args.seller - wallet/account address
 * @param {boolean} [args.isShipping=true]
 * @param {boolean} [args.doaGuarantee=true]
 * @param {string} [args.description]
 * @param {string|null} [args.photoUrl] - hosted https URL of this frag
 * @param {Object} [args.care] - seller-edited care fields (°F, gallons, careLevel)
 * @param {number} [args.now=Date.now()]
 */
export function buildFragListing({
  species,
  frag,
  priceUsd,
  quantity,
  seller,
  isShipping = true,
  doaGuarantee = true,
  description = "",
  photoUrl = null,
  care = {},
  now = Date.now(),
}) {
  const cleaned = cleanFrag(frag);
  const listingId = Number(now);
  const price = Number(priceUsd).toFixed(2);
  const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const hostedPhoto = cleanHttpsUrl(photoUrl);

  const listing = {
    id: listingId,
    listingId,
    // Frags have no spawn event; 0 keeps the batch shape for readers that coerce it.
    spawnId: 0,
    listingKind: FRAG_LISTING_KIND,
    frag: cleaned,
    quantity: cleaned.wysiwyg ? 1 : Number(quantity),
    price,
    priceUsd: price,
    priceCentsUSD: Math.round(Number(priceUsd) * 100),
    rawPrice: price,
    shippingFee: "0.00",
    shippingFeeCents: 0,
    isShipping: !!isShipping,
    seller: String(seller || "").toLowerCase(),
    speciesId: Number(species.specCode ?? species.speciesId ?? 0),
    commonName: `${species.commonName || species.scientificName} frag`,
    scientificName: species.scientificName || "",
    sireId: 0,
    damId: 0,
    isBatch: true,
    active: true,
    description: String(description || "").slice(0, 500),
    careLevel: Number(care.careLevel ?? 0) || 0,
    minTemp: num(care.minTemp),
    maxTemp: num(care.maxTemp),
    minPh: num(care.minPh),
    maxPh: num(care.maxPh),
    tankSizeMin: num(care.tankSizeMin),
    healthStatus: "healthy",
    doaGuarantee: !!doaGuarantee,
    packingProfile: { ...FRAG_PACKING_PROFILE },
    createdAt: Math.floor(Number(now) / 1000),
  };
  if (hostedPhoto) listing.photoUrl = hostedPhoto;
  return listing;
}
