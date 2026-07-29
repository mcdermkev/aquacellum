/**
 * Fish Finder Rework T14 — the public listing field boundary.
 *
 * Two things are pinned here:
 *   1. `toPublicListing` behaves as a strict allowlist (fail-closed).
 *   2. The SQL view's allowlist and the JS allowlist are IDENTICAL. The view is
 *      what actually protects the data, so a silent divergence between the two
 *      would mean the code claims a boundary the database doesn't enforce (or
 *      vice versa). This test parses the migration to make that impossible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  PUBLIC_LISTING_DATA_FIELDS,
  WITHHELD_LISTING_DATA_FIELDS,
  toPublicListing,
  toPublicListings,
} from "../services/publicListingProjection.js";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260728_aquadex_listings_public_view.sql",
    import.meta.url
  )
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");

/** The migration with `--` comment lines removed, for assertions about the
 *  actual statements (the prose discusses the patterns it rejects). */
const MIGRATION_CODE = MIGRATION_SQL.replace(/^\s*--.*$/gm, "").replace(
  /\s--.*$/gm,
  ""
);

/**
 * Pull the allowlisted keys out of the view's jsonb_build_object(...) block.
 * Matches only real projection lines — `'key', l.data_obj -> 'key'` — so the
 * surrounding prose/comments can't produce false positives.
 */
function sqlAllowlist(sql) {
  const body = sql.slice(sql.indexOf("jsonb_build_object("));
  const re = /'([A-Za-z_][A-Za-z0-9_]*)',\s*l\.data_obj\s*->\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;
  const keys = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    // The emitted key and the source key must be the same field; a mismatch
    // would silently rename data under the public consumers.
    expect(m[2]).toBe(m[1]);
    keys.push(m[1]);
  }
  return keys;
}

// A raw listing carrying every allowlisted field plus every withheld one.
function rawListing() {
  const l = {};
  for (const k of PUBLIC_LISTING_DATA_FIELDS) l[k] = `pub:${k}`;
  for (const k of WITHHELD_LISTING_DATA_FIELDS) l[k] = `SECRET:${k}`;
  l.someFutureFieldNobodyReviewed = "SECRET:future";
  return l;
}

describe("toPublicListing — strict allowlist (fail-closed)", () => {
  it("emits exactly the allowlisted fields and nothing else", () => {
    const out = toPublicListing(rawListing());
    expect(Object.keys(out).sort()).toEqual([...PUBLIC_LISTING_DATA_FIELDS].sort());
  });

  it("drops every deliberately-withheld field", () => {
    const out = toPublicListing(rawListing());
    for (const k of WITHHELD_LISTING_DATA_FIELDS) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("drops unknown//future fields by default rather than passing them through", () => {
    // This is the whole point of the task: the previous behavior published the
    // raw blob, so any newly-added listing field became public automatically.
    const out = toPublicListing(rawListing());
    expect(out).not.toHaveProperty("someFutureFieldNobodyReviewed");
  });

  it("omits absent keys instead of inventing nulls", () => {
    const out = toPublicListing({ price: "12.00" });
    expect(out).toEqual({ price: "12.00" });
    expect(out).not.toHaveProperty("commonName");
  });

  it("preserves falsy values that are genuinely present", () => {
    const out = toPublicListing({ quantity: 0, isShipping: false, photoUrl: "" });
    expect(out).toEqual({ quantity: 0, isShipping: false, photoUrl: "" });
  });

  it("never leaks the seller's packing profile", () => {
    const out = toPublicListing({ seller: "0xabc", packingProfile: { bagsPerBox: 4 } });
    expect(out).toEqual({ seller: "0xabc" });
  });

  it("handles null/non-object input without throwing", () => {
    expect(toPublicListing(null)).toEqual({});
    expect(toPublicListing(undefined)).toEqual({});
    expect(toPublicListing("nope")).toEqual({});
    expect(toPublicListings(null)).toEqual([]);
    expect(toPublicListings([null, { price: "1.00" }, 7])).toEqual([{ price: "1.00" }]);
  });

  it("suppresses the legacy fabricated location fields still present in live rows", () => {
    // Decision D3 removed the code that wrote these but not the stored data, so
    // production rows still carry a `fuzzedLocation` pinned to the hardcoded
    // downtown-SF default plus a matching `zoneHash`. Verified live while
    // checking the T14 view. This is the concrete case the allowlist exists for.
    const out = toPublicListing({
      commonName: "Neon Tetra",
      fuzzedLocation: { lat: 37.7749, lng: -122.4194 },
      zoneHash: "0xdeadbeef",
    });
    expect(out).toEqual({ commonName: "Neon Tetra" });
  });

  it("keeps seller identity public on purpose (already public on-chain)", () => {
    // Documented deviation from the original T14 sketch: the wallet is readable
    // from AquadexMarketplace.listings(tokenId) by any RPC caller, and public
    // storefront/breeder-count surfaces join on it.
    expect(PUBLIC_LISTING_DATA_FIELDS).toContain("seller");
  });
});

describe("SQL view allowlist matches the JS allowlist", () => {
  it("projects the same field set, in the same order", () => {
    expect(sqlAllowlist(MIGRATION_SQL)).toEqual([...PUBLIC_LISTING_DATA_FIELDS]);
  });

  it("does not project any withheld field", () => {
    const keys = new Set(sqlAllowlist(MIGRATION_SQL));
    for (const k of WITHHELD_LISTING_DATA_FIELDS) {
      expect(keys.has(k)).toBe(false);
    }
  });

  it("builds the blob additively, never by subtracting known-bad keys", () => {
    // A subtractive projection (`data - 'description' - ...`) would be
    // fail-open: a new field leaks until someone remembers to subtract it.
    expect(MIGRATION_CODE).toContain("jsonb_build_object(");
    expect(MIGRATION_CODE).not.toMatch(/data(_obj)?\s*-\s*'/);
  });

  it("keeps column names compatible with the base table so readers just swap the name", () => {
    for (const col of [
      "l.id",
      "l.seller_address",
      "l.species_id",
      "l.common_name",
      "l.price",
      "l.is_batch",
      "l.is_active",
      "l.created_at",
      "l.updated_at",
    ]) {
      expect(MIGRATION_SQL).toContain(col);
    }
    expect(MIGRATION_SQL).toContain(") as data");
  });

  it("reads the base table with owner rights so it survives the anon lockdown", () => {
    expect(MIGRATION_SQL).toContain("security_invoker = false");
  });

  it("grants read-only access to the browser roles", () => {
    expect(MIGRATION_CODE).toContain("grant select on public.aquadex_listings_public to anon, authenticated");
    expect(MIGRATION_CODE).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });

  it("tolerates a `data` blob stored as a JSON string scalar", () => {
    // cloudSync writes JSON.stringify(listing); depending on the insert cast a
    // row's jsonb can hold a string scalar, against which `->` yields NULL for
    // every field and the public cards would render empty.
    expect(MIGRATION_SQL).toContain("jsonb_typeof");
    expect(MIGRATION_SQL).toContain("#>> '{}'");
  });
});
