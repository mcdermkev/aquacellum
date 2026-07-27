/**
 * public-listings.js — the anonymous read path for marketplace listings.
 *
 * Fish Finder Rework, Task 14 (Tier A). The static marketing pages
 * (marketplace.html, species.html, store.html) browse listings while logged
 * out, using the public `anon` key. They used to read the `aquadex_listings`
 * table directly, which returns the FULL `data` blob — every field any listing
 * wizard ever wrote, published by default with no review step.
 *
 * They now read `aquadex_listings_public`, a view that rebuilds `data` from an
 * explicit allowlist (see supabase/migrations/20260728_aquadex_listings_public_view.sql
 * and its JS mirror src/services/publicListingProjection.js).
 *
 * ## Why there is a fallback
 *
 * The view is a database migration and these pages are static assets; the two
 * deploy independently. Rather than couple the deploy order, this helper tries
 * the view first and falls back to the base table if the view does not exist
 * yet. Once the RLS lockdown lands, the fallback simply returns nothing for
 * anonymous callers, so it cannot become a permanent bypass — and the console
 * warning makes an un-migrated environment obvious instead of silent.
 *
 * The view keeps the base table's exact column names (id, seller_address,
 * species_id, common_name, price, is_batch, is_active, created_at, updated_at,
 * data), so callers parse the response identically either way.
 *
 * Exposed as `window.AquadexPublicListings`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest guard test
  }
  root.AquadexPublicListings = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var PUBLIC_VIEW = "aquadex_listings_public";
  var BASE_TABLE = "aquadex_listings";

  /** Whether we've already fallen back, so the warning is logged once. */
  var warned = false;

  /**
   * Fetch listing rows from the public projection.
   *
   * @param {Object} opts
   * @param {string} opts.supabaseUrl - project URL
   * @param {string} opts.anonKey     - public anon key
   * @param {string} opts.query       - PostgREST query string WITHOUT a leading
   *                                    "?" (e.g. "is_active=eq.true&select=data&limit=50")
   * @returns {Promise<Array>} rows, or [] on any failure (never throws)
   */
  function fetchRows(opts) {
    var supabaseUrl = (opts && opts.supabaseUrl) || "";
    var anonKey = (opts && opts.anonKey) || "";
    var query = (opts && opts.query) || "";
    var headers = {
      apikey: anonKey,
      Authorization: "Bearer " + anonKey,
      "Content-Type": "application/json",
    };

    function get(relation) {
      return fetch(supabaseUrl + "/rest/v1/" + relation + "?" + query, { headers: headers });
    }

    return get(PUBLIC_VIEW)
      .then(function (res) {
        if (res.ok) return res.json();
        // 404 (relation missing) / 42P01 — the migration hasn't been applied in
        // this environment yet. Any other status is also treated as "try the
        // base table" because the base table is still the only other option.
        if (!warned) {
          warned = true;
          console.warn(
            "[AquadexPublicListings] " +
              PUBLIC_VIEW +
              " unavailable (HTTP " +
              res.status +
              "); falling back to " +
              BASE_TABLE +
              ". Apply supabase/migrations/20260728_aquadex_listings_public_view.sql."
          );
        }
        return get(BASE_TABLE).then(function (r2) {
          return r2.ok ? r2.json() : [];
        });
      })
      .then(function (rows) {
        return Array.isArray(rows) ? rows : [];
      })
      .catch(function (e) {
        console.warn("[AquadexPublicListings] listing fetch failed:", e && e.message);
        return [];
      });
  }

  /**
   * Parse a row's `data` column into a listing object.
   * The column is jsonb but the writer stores a JSON string, so both shapes
   * occur in the wild.
   * @param {Object} row
   * @returns {Object|null}
   */
  function parseRow(row) {
    if (!row) return null;
    try {
      return typeof row.data === "string" ? JSON.parse(row.data) : row.data || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch and parse in one step — the common case.
   * @param {Object} opts - same as fetchRows
   * @returns {Promise<Object[]>} listing objects
   */
  function fetchListings(opts) {
    return fetchRows(opts).then(function (rows) {
      return rows.map(parseRow).filter(Boolean);
    });
  }

  return {
    PUBLIC_VIEW: PUBLIC_VIEW,
    BASE_TABLE: BASE_TABLE,
    fetchRows: fetchRows,
    fetchListings: fetchListings,
    parseRow: parseRow,
  };
});
