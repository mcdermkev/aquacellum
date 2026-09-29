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
  PUBLIC_FRAG_DATA_FIELDS,
  WITHHELD_LISTING_DATA_FIELDS,
  toPublicListing,
  toPublicListings,
} from "../services/publicListingProjection.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const VIEW_DEFINITION = /create\s+or\s+replace\s+view\s+public\.aquadex_listings_public\b/i;

/**
 * The CURRENT view definition is the LAST migration in the canonical apply
 * order (supabase/migration-order.json) that (re)creates the view. Applied
 * migrations are immutable, so the view evolves by superseding files; pinning
 * one filename here would silently keep testing a stale definition.
 */
function currentViewMigration() {
  const { order } = JSON.parse(
    readFileSync(`${REPO_ROOT}supabase/migration-order.json`, "utf8")
  );
  const defining = order.filter((rel) =>
    VIEW_DEFINITION.test(readFileSync(`${REPO_ROOT}${rel}`, "utf8"))
  );
  if (defining.length === 0) throw new Error("no migration defines aquadex_listings_public");
  return defining[defining.length - 1];
}

const MIGRATION_FILE = currentViewMigration();
const MIGRATION_SQL = readFileSync(`${REPO_ROOT}${MIGRATION_FILE}`, "utf8");

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
  // Three legal source forms:
  //   'key', l.data_obj -> 'key'          (from the listing blob)
  //   'key', to_jsonb(l.some_column)       (from a real base-table column)
  //   'key', case when jsonb_typeof(l.data_obj -> 'key') = 'object' then …
  //                                        (a nested object rebuilt from its own
  //                                         allowlist — see sqlNestedAllowlist)
  const re =
    /'([A-Za-z_][A-Za-z0-9_]*)',\s*(?:l\.data_obj\s*->\s*'([A-Za-z_][A-Za-z0-9_]*)'|to_jsonb\(\s*l\.([a-z_][a-z0-9_]*)\s*\)|case\s+when\s+jsonb_typeof\(\s*l\.data_obj\s*->\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)\s*=\s*'object')/g;
  const keys = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const [, key, fromBlob, fromColumn, fromNested] = m;
    // The emitted key must name the same field as its source; a mismatch would
    // silently rename data under the public consumers. Columns are snake_case,
    // so they must be exactly the camelCase of the emitted key.
    const source = fromBlob ?? fromNested ?? fromColumn.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    expect(source).toBe(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Keys of a nested object's allowlist (`'sub', case when … '{parent,sub}' … end`).
 * Every `{parent,x}` path on a subkey's line must name that same subkey, so a
 * value can't be wired to the wrong output key.
 */
function sqlNestedAllowlist(sql, parent) {
  const keys = [];
  const re = new RegExp(`^\\s*'([A-Za-z_][A-Za-z0-9_]*)',\\s*case\\s+when\\b.*\\{${parent},.*$`, "gm");
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [line, key] = m;
    const paths = [...line.matchAll(new RegExp(`\\{${parent},([A-Za-z_][A-Za-z0-9_]*)\\}`, "g"))].map((p) => p[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p, line.trim()).toBe(key);
    keys.push(key);
  }
  return keys;
}

// A raw listing carrying every allowlisted field plus every withheld one.
function rawListing() {
  const l = {};
  for (const k of PUBLIC_LISTING_DATA_FIELDS) l[k] = `pub:${k}`;
  for (const k of WITHHELD_LISTING_DATA_FIELDS) l[k] = `SECRET:${k}`;
  l.frag = {
    sizeValue: 3,
    sizeUnit: "polyps",
    mount: "plug",
    wysiwyg: true,
    origin: "aquacultured",
    motherPhotoUrl: "https://cdn.example/mother.jpg",
    grownUnder: "SECRET:grownUnder",
    someFutureFragField: "SECRET:future",
  };
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

  it("projects a frag down to its public subkeys only", () => {
    const out = toPublicListing(rawListing());
    expect(Object.keys(out.frag)).toEqual([...PUBLIC_FRAG_DATA_FIELDS]);
    expect(out.frag).not.toHaveProperty("grownUnder");
    expect(out.frag).not.toHaveProperty("someFutureFragField");
  });

  it("drops invalid frag values the same way the view does", () => {
    const out = toPublicListing({
      listingKind: "coral_frag",
      frag: {
        sizeValue: "3",
        sizeUnit: "handfuls",
        mount: "plug",
        wysiwyg: "yes",
        origin: "wild",
        motherPhotoUrl: "http://insecure.example/m.jpg",
      },
    });
    expect(out).toEqual({ listingKind: "coral_frag", frag: { mount: "plug", origin: "wild" } });
    expect(toPublicListing({ frag: { motherPhotoUrl: "data:image/jpeg;base64,AAAA" } }).frag).toEqual({});
    expect(toPublicListing({ frag: "not an object" })).toEqual({});
    expect(toPublicListing({ frag: [1, 2] })).toEqual({});
  });

  it("keeps seller identity public on purpose (already public on-chain)", () => {
    // Documented deviation from the original T14 sketch: the wallet is readable
    // from AquadexMarketplace.listings(tokenId) by any RPC caller, and public
    // storefront/breeder-count surfaces join on it.
    expect(PUBLIC_LISTING_DATA_FIELDS).toContain("seller");
  });
});

describe("current view definition", () => {
  it("resolves to the coral frag migration, not a superseded definition", () => {
    expect(MIGRATION_FILE).toBe(
      "frontend/supabase/migrations/20261001_public_view_frag.sql"
    );
  });

  it("keeps the original column order as a prefix (create or replace view can only append)", () => {
    // Postgres rejects a replace that renames/reorders existing view columns,
    // so the migration would fail on apply rather than in review.
    const select = MIGRATION_CODE.slice(
      MIGRATION_CODE.search(/^select\s*$/im),
      MIGRATION_CODE.search(/^from normalized l/im)
    );
    const columns = [...select.matchAll(/^\s{2}(?:\)\s+as\s+(\w+)|[\w.]+\s+as\s+(\w+)|l\.(\w+)|jsonb_build_object\()/gim)]
      .map((m) => m[1] || m[2] || m[3])
      .filter(Boolean);
    expect(columns.slice(0, 11)).toEqual([
      "id",
      "seller_address",
      "species_id",
      "common_name",
      "price",
      "is_batch",
      "is_active",
      "created_at",
      "updated_at",
      "seller_display_name",
      "data",
    ]);
    expect(columns.slice(11)).toEqual(["quantity_remaining"]);
  });
});

describe("SQL view allowlist matches the JS allowlist", () => {
  it("projects the same field set, in the same order", () => {
    expect(sqlAllowlist(MIGRATION_SQL)).toEqual([...PUBLIC_LISTING_DATA_FIELDS]);
  });

  it("rebuilds the nested frag object from the same subkey allowlist, in order", () => {
    expect(sqlNestedAllowlist(MIGRATION_SQL, "frag")).toEqual([...PUBLIC_FRAG_DATA_FIELDS]);
    // Seller free text on the frag stays behind sign-in, like `description`.
    expect(MIGRATION_CODE).not.toContain("grownUnder");
    // The nested object is never passed through whole.
    expect(MIGRATION_CODE).not.toMatch(/'frag',\s*l\.data_obj\s*->\s*'frag'/);
  });

  it("only publishes an https mother-colony photo", () => {
    expect(MIGRATION_CODE).toMatch(/motherPhotoUrl[^\n]*~\*\s*'\^https:\/\//);
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
