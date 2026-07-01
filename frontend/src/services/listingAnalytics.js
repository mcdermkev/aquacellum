/**
 * listingAnalytics.js — Lightweight listing view/interest tracking.
 *
 * Tracks views per listing in localStorage (simple counter).
 * For cross-device analytics, writes periodic roll-ups to Supabase.
 *
 * Sellers see view counts on their own listings in the marketplace board.
 */

const VIEWS_KEY = "aquadex_listing_views";
const VIEWED_KEY = "aquadex_listings_viewed_this_session";

/**
 * Get the views storage object.
 */
function getViewsStore() {
  try {
    return JSON.parse(localStorage.getItem(VIEWS_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * Record a view for a listing (deduped per session).
 * @param {string|number} listingId
 */
export function recordListingView(listingId) {
  const key = String(listingId);

  // Dedupe: only count once per session per listing
  let sessionViewed;
  try {
    sessionViewed = JSON.parse(sessionStorage.getItem(VIEWED_KEY) || "[]");
  } catch {
    sessionViewed = [];
  }
  if (sessionViewed.includes(key)) return;

  sessionViewed.push(key);
  sessionStorage.setItem(VIEWED_KEY, JSON.stringify(sessionViewed));

  // Increment local view counter
  const store = getViewsStore();
  store[key] = (store[key] || 0) + 1;
  localStorage.setItem(VIEWS_KEY, JSON.stringify(store));
}

/**
 * Get view count for a listing.
 * @param {string|number} listingId
 * @returns {number}
 */
export function getListingViews(listingId) {
  const store = getViewsStore();
  return store[String(listingId)] || 0;
}

/**
 * Get views for multiple listings.
 * @param {Array<string|number>} listingIds
 * @returns {Object} { listingId: viewCount }
 */
export function getBulkListingViews(listingIds) {
  const store = getViewsStore();
  const result = {};
  for (const id of listingIds) {
    result[String(id)] = store[String(id)] || 0;
  }
  return result;
}

/**
 * Get total views across all seller's listings.
 * @param {Array<Object>} sellerListings - listings owned by seller
 * @returns {number}
 */
export function getTotalSellerViews(sellerListings) {
  const store = getViewsStore();
  let total = 0;
  for (const listing of sellerListings) {
    const key = String(listing.id || listing.tokenId || listing.listingId);
    total += store[key] || 0;
  }
  return total;
}
